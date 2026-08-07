const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { app, BrowserWindow, ipcMain, Notification, safeStorage, shell } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const {
  findExpectedChecksum,
  isNewerVersion,
  normalizeVersion,
  parseSha256Sums,
  sanitizeAssetName,
  selectReleaseAsset,
  safeReleaseUrl,
  toPublicReleaseInfo
} = require('../utils/app-update')
const {
  readGitHubToken,
  recordUpdateCheck,
  saveUpdateSettings,
  toPublicUpdateSettings
} = require('../utils/app-update-store')

const GITHUB_OWNER = 'Loinver'
const GITHUB_REPOSITORY = 'ops-desktop-tool'
const GITHUB_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/latest`
const UPDATE_DIRECTORY = 'updates'
const AUTO_CHECK_DELAY_MS = 12_000
const REQUEST_TIMEOUT_MS = 30_000
const MAX_JSON_BYTES = 5 * 1024 * 1024
const MAX_CHECKSUM_BYTES = 2 * 1024 * 1024
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024 * 1024
const SUPPORTED_DOWNLOAD_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com'
])

let runtime = null
let autoCheckTimer = null
let releaseContext = null
let downloadedFilePath = ''
let lastNotifiedVersion = ''
let activeCheck = null
let activeDownload = null
let activeDownloadGeneration = null
let activeInstall = null
let operationGeneration = 0
let state = createInitialState()

function invalidateUpdateOperations() {
  operationGeneration += 1
  releaseContext = null
  const previousDownload = downloadedFilePath
  downloadedFilePath = ''
  if (previousDownload) {
    try {
      fs.rmSync(previousDownload, { force: true })
    } catch {}
  }
  return operationGeneration
}

function isCurrentOperation(generation) {
  return generation === operationGeneration
}

function createStaleOperationError() {
  const error = new Error('更新操作已被新的请求替代')
  error.code = 'APP_UPDATE_STALE'
  return error
}

function createInitialState() {
  return {
    phase: 'idle',
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    repository: {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPOSITORY,
      private: true
    },
    installMode:
      process.platform === 'win32'
        ? 'automatic'
        : process.platform === 'darwin'
          ? 'manual'
          : 'unsupported',
    settings: {
      autoCheck: true,
      autoDownload: true,
      tokenConfigured: false,
      maskedToken: '',
      credentialError: '',
      lastCheckedAt: ''
    },
    release: null,
    download: null,
    message: '尚未检查更新',
    error: ''
  }
}

function isSupportedRuntime() {
  return ['darwin', 'win32'].includes(process.platform) && ['x64', 'arm64'].includes(process.arch)
}

function getUserDataPath() {
  return runtime?.userDataPath || app.getPath('userData')
}

function publicSettings() {
  return toPublicUpdateSettings({ userDataPath: getUserDataPath(), safeStorage })
}

function snapshotState() {
  return {
    ...state,
    settings: { ...state.settings },
    repository: { ...state.repository },
    release: state.release
      ? {
          ...state.release,
          asset: state.release.asset ? { ...state.release.asset } : null
        }
      : null,
    download: state.download ? { ...state.download } : null
  }
}

function broadcastState() {
  const snapshot = snapshotState()
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    window.webContents.send(IPC_CHANNELS.APP_UPDATE_STATE_CHANGED, snapshot)
  }
  return snapshot
}

function setState(patch, { broadcast = true } = {}) {
  state = {
    ...state,
    ...patch,
    settings: patch.settings ? { ...patch.settings } : state.settings
  }
  return broadcast ? broadcastState() : snapshotState()
}

function getAppUpdateState() {
  return setState({ settings: publicSettings() }, { broadcast: false })
}

function isAllowedDownloadUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  return (
    SUPPORTED_DOWNLOAD_HOSTS.has(url.hostname) || url.hostname.endsWith('.githubusercontent.com')
  )
}

function requestHeaders(url, token, accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': `Ops-Desktop/${app.getVersion()}`,
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (token && new URL(url).hostname === 'api.github.com') {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function createGitHubRequestError(statusCode, responseBody = '') {
  let apiMessage = ''
  try {
    apiMessage = JSON.parse(responseBody)?.message || ''
  } catch {}

  if (statusCode === 401) return new Error('GitHub Token 无效或已过期，请重新保存')
  if (statusCode === 403) {
    return new Error('GitHub 拒绝了更新请求，请检查 Token 权限或 API 限额')
  }
  if (statusCode === 404) {
    return new Error('未找到私有仓库或 Release，请确认 Token 已授权该仓库的 Contents 读取权限')
  }
  return new Error(
    `GitHub 更新请求失败（HTTP ${statusCode}${apiMessage ? `：${apiMessage}` : ''}）`
  )
}

function requestBuffer(rawUrl, { token = '', accept, maxBytes, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    if (!isAllowedDownloadUrl(rawUrl)) {
      reject(new Error('GitHub 返回了不受信任的下载地址'))
      return
    }

    const request = https.get(
      rawUrl,
      { headers: requestHeaders(rawUrl, token, accept) },
      (response) => {
        const statusCode = response.statusCode || 0
        if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
          response.resume()
          if (redirects <= 0) {
            reject(new Error('GitHub 下载重定向次数过多'))
            return
          }
          const redirected = new URL(response.headers.location, rawUrl).toString()
          requestBuffer(redirected, { token, accept, maxBytes, redirects: redirects - 1 }).then(
            resolve,
            reject
          )
          return
        }

        const chunks = []
        let total = 0
        response.on('data', (chunk) => {
          total += chunk.length
          if (total > maxBytes) {
            request.destroy(new Error('GitHub 响应内容超过允许大小'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          const body = Buffer.concat(chunks)
          if (statusCode < 200 || statusCode >= 300) {
            reject(createGitHubRequestError(statusCode, body.toString('utf8').slice(0, 2000)))
            return
          }
          resolve(body)
        })
      }
    )
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('连接 GitHub 超时')))
    request.on('error', reject)
  })
}

async function fetchLatestRelease(token) {
  const body = await requestBuffer(GITHUB_RELEASE_API, {
    token,
    accept: 'application/vnd.github+json',
    maxBytes: MAX_JSON_BYTES
  })
  let release
  try {
    release = JSON.parse(body.toString('utf8'))
  } catch {
    throw new Error('GitHub Release 响应格式无效')
  }
  if (!release || release.draft || release.prerelease || !release.tag_name) {
    throw new Error('GitHub 上没有可用的正式 Release')
  }
  return release
}

function toNoUpdateReleaseInfo(release) {
  const latestVersion = normalizeVersion(release.tag_name)
  return {
    latestVersion,
    tag: String(release.tag_name || ''),
    name: String(release.name || release.tag_name || '').slice(0, 200),
    publishedAt: String(release.published_at || ''),
    releaseUrl: safeReleaseUrl(release.html_url),
    notes: String(release.body || '').slice(0, 20_000),
    asset: null,
    checksumAvailable: Array.isArray(release.assets)
      ? release.assets.some((asset) => asset?.name === 'SHA256SUMS.txt')
      : false,
    updateAvailable: false,
    installMode:
      process.platform === 'win32'
        ? 'automatic'
        : process.platform === 'darwin'
          ? 'manual'
          : 'unsupported',
    platform: process.platform,
    arch: process.arch,
    currentVersion: app.getVersion()
  }
}

function showUpdateNotification(releaseInfo) {
  if (
    (typeof Notification.isSupported === 'function' && !Notification.isSupported()) ||
    lastNotifiedVersion === releaseInfo.latestVersion
  ) {
    return
  }
  lastNotifiedVersion = releaseInfo.latestVersion
  try {
    const notification = new Notification({
      title: `Ops Desktop ${releaseInfo.latestVersion} 可更新`,
      body:
        process.platform === 'win32'
          ? '更新包可在后台下载，完成后可重启安装。'
          : '更新包可在后台下载，完成后需要手动打开安装。'
    })
    notification.on('click', () => runtime?.openUpdatePage?.())
    notification.show()
  } catch (error) {
    runtime?.logger?.warn('显示应用更新通知失败', { message: error?.message })
  }
}

async function checkForAppUpdate({ manual = true } = {}) {
  if (activeCheck) return activeCheck

  const generation = invalidateUpdateOperations()
  const setCurrentState = (patch) =>
    isCurrentOperation(generation) ? setState(patch) : snapshotState()

  activeCheck = (async () => {
    if (!isSupportedRuntime()) {
      return setCurrentState({
        phase: 'unsupported',
        settings: publicSettings(),
        message: `暂不支持 ${process.platform}/${process.arch} 自动更新`,
        error: ''
      })
    }

    let token
    try {
      token = readGitHubToken({ userDataPath: getUserDataPath(), safeStorage })
    } catch (error) {
      return setCurrentState({
        phase: 'needs-auth',
        settings: publicSettings(),
        message: '无法读取 GitHub Token',
        error: error?.message || '读取 GitHub Token 失败'
      })
    }

    if (!token) {
      return setCurrentState({
        phase: 'needs-auth',
        settings: publicSettings(),
        message: '请先配置私有仓库的 GitHub Token',
        error: manual ? '当前仓库为私有仓库，检查更新需要 Contents 只读 Token' : ''
      })
    }

    if (!isCurrentOperation(generation)) return snapshotState()
    setState({
      phase: 'checking',
      settings: publicSettings(),
      message: '正在检查 GitHub Release…',
      error: ''
    })

    try {
      const release = await fetchLatestRelease(token)
      if (!isCurrentOperation(generation)) return snapshotState()

      const checkedAt = new Date().toISOString()
      recordUpdateCheck(getUserDataPath(), checkedAt)
      const latestVersion = normalizeVersion(release.tag_name)
      const updateAvailable = isNewerVersion(latestVersion, app.getVersion())

      if (!updateAvailable) {
        return setCurrentState({
          phase: 'up-to-date',
          settings: publicSettings(),
          release: toNoUpdateReleaseInfo(release),
          download: null,
          message: `当前已是最新版本 ${app.getVersion()}`,
          error: ''
        })
      }

      const selection = selectReleaseAsset(release, {
        platform: process.platform,
        arch: process.arch,
        version: latestVersion
      })
      const releaseInfo = toPublicReleaseInfo(release, selection, {
        currentVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      })
      if (!isCurrentOperation(generation)) return snapshotState()

      releaseContext = Object.freeze({
        release,
        ...selection,
        releaseInfo,
        generation
      })
      const nextState = setState({
        phase: 'available',
        settings: publicSettings(),
        release: releaseInfo,
        download: null,
        message: `发现新版本 ${releaseInfo.latestVersion}`,
        error: ''
      })
      showUpdateNotification(releaseInfo)

      const settings = publicSettings()
      if (settings.autoDownload && app.isPackaged) {
        setImmediate(() => {
          if (!isCurrentOperation(generation)) return
          downloadAppUpdate({ expectedGeneration: generation }).catch((error) => {
            runtime?.logger?.warn('自动下载应用更新失败', { message: error?.message })
          })
        })
      }
      return nextState
    } catch (error) {
      if (!isCurrentOperation(generation)) return snapshotState()
      runtime?.logger?.warn('检查应用更新失败', { message: error?.message })
      return setState({
        phase: 'error',
        settings: publicSettings(),
        message: '检查更新失败',
        error: error?.message || '检查更新失败'
      })
    }
  })().finally(() => {
    activeCheck = null
  })

  return activeCheck
}

function downloadAsset(
  rawUrl,
  destination,
  { token, onProgress, maxBytes = MAX_INSTALLER_BYTES } = {}
) {
  const partPath = `${destination}.part`
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  try {
    fs.rmSync(partPath, { force: true })
  } catch {}

  const run = (url, redirects) =>
    new Promise((resolve, reject) => {
      if (!isAllowedDownloadUrl(url)) {
        reject(new Error('GitHub 返回了不受信任的下载地址'))
        return
      }
      const request = https.get(
        url,
        { headers: requestHeaders(url, token, 'application/octet-stream') },
        (response) => {
          const statusCode = response.statusCode || 0
          if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
            response.resume()
            if (redirects <= 0) {
              reject(new Error('GitHub 下载重定向次数过多'))
              return
            }
            const redirected = new URL(response.headers.location, url).toString()
            run(redirected, redirects - 1).then(resolve, reject)
            return
          }
          if (statusCode < 200 || statusCode >= 300) {
            const chunks = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('end', () => {
              reject(
                createGitHubRequestError(
                  statusCode,
                  Buffer.concat(chunks).toString('utf8').slice(0, 2000)
                )
              )
            })
            return
          }

          const total = Number(response.headers['content-length']) || 0
          if (total > maxBytes) {
            response.resume()
            reject(new Error(`更新包超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 下载上限`))
            return
          }

          const hash = crypto.createHash('sha256')
          const output = fs.createWriteStream(partPath, { flags: 'wx', mode: 0o600 })
          let transferred = 0
          let lastProgressAt = 0

          const fail = (error) => {
            response.destroy()
            output.destroy()
            try {
              fs.rmSync(partPath, { force: true })
            } catch {}
            reject(error)
          }

          response.on('data', (chunk) => {
            transferred += chunk.length
            if (transferred > maxBytes) {
              fail(new Error(`更新包超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 下载上限`))
              return
            }
            hash.update(chunk)
            const now = Date.now()
            if (now - lastProgressAt >= 250 || (total && transferred >= total)) {
              lastProgressAt = now
              onProgress?.({ transferred, total })
            }
          })
          response.on('error', fail)
          output.on('error', fail)
          output.on('finish', () => {
            try {
              fs.renameSync(partPath, destination)
              resolve({
                sha256: hash.digest('hex'),
                bytes: transferred,
                total: total || transferred
              })
            } catch (error) {
              fail(error)
            }
          })
          response.pipe(output)
        }
      )
      request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('下载更新包超时')))
      request.on('error', (error) => {
        try {
          fs.rmSync(partPath, { force: true })
        } catch {}
        reject(error)
      })
    })

  return run(rawUrl, 5)
}

async function downloadAppUpdate({ expectedGeneration = null } = {}) {
  if (activeDownload) {
    if (expectedGeneration !== null && expectedGeneration !== activeDownloadGeneration) {
      return activeDownload.then(() => downloadAppUpdate({ expectedGeneration }))
    }
    return activeDownload
  }

  activeDownloadGeneration = expectedGeneration
  activeDownload = (async () => {
    if (!app.isPackaged) throw new Error('开发模式不会下载或安装正式更新包')
    if (expectedGeneration !== null && !isCurrentOperation(expectedGeneration)) {
      return snapshotState()
    }

    let context = releaseContext
    if (!context?.asset || !context?.checksumAsset) {
      await checkForAppUpdate({ manual: true })
      if (expectedGeneration !== null && !isCurrentOperation(expectedGeneration)) {
        return snapshotState()
      }
      context = releaseContext
    }
    if (!context?.asset || !context?.checksumAsset) {
      throw new Error('当前没有可下载的新版本')
    }

    const generation = context.generation
    activeDownloadGeneration = generation
    if (
      !isCurrentOperation(generation) ||
      (expectedGeneration !== null && expectedGeneration !== generation)
    ) {
      return snapshotState()
    }

    const token = readGitHubToken({ userDataPath: getUserDataPath(), safeStorage })
    if (!token) throw new Error('GitHub Token 未配置')

    const declaredSize = Number(context.asset.size) || 0
    if (declaredSize > MAX_INSTALLER_BYTES) {
      throw new Error('Release 更新包超过允许的下载大小')
    }

    const assetName = sanitizeAssetName(context.asset.name)
    const updateDirectory = path.join(getUserDataPath(), UPDATE_DIRECTORY)
    const destination = path.join(updateDirectory, assetName)

    try {
      const checksumBody = await requestBuffer(context.checksumAsset.url, {
        token,
        accept: 'application/octet-stream',
        maxBytes: MAX_CHECKSUM_BYTES
      })
      if (!isCurrentOperation(generation)) throw createStaleOperationError()

      const checksums = parseSha256Sums(checksumBody.toString('utf8'))
      const expectedSha256 = findExpectedChecksum(checksums, assetName)
      setState({
        phase: 'downloading',
        message: `正在下载 ${assetName}`,
        error: '',
        download: {
          fileName: assetName,
          transferred: 0,
          total: Number(context.asset.size) || 0,
          percent: 0,
          verified: false
        }
      })

      if (fs.existsSync(destination)) fs.rmSync(destination, { force: true })

      const result = await downloadAsset(context.asset.url, destination, {
        token,
        maxBytes: MAX_INSTALLER_BYTES,
        onProgress: ({ transferred, total }) => {
          if (!isCurrentOperation(generation)) return
          const effectiveTotal = total || Number(context.asset.size) || 0
          const percent = effectiveTotal
            ? Math.min(100, Math.round((transferred / effectiveTotal) * 1000) / 10)
            : 0
          setState({
            phase: 'downloading',
            message: `正在下载 ${assetName}（${percent}%）`,
            download: {
              fileName: assetName,
              transferred,
              total: effectiveTotal,
              percent,
              verified: false
            }
          })
        }
      })

      if (!isCurrentOperation(generation)) {
        fs.rmSync(destination, { force: true })
        throw createStaleOperationError()
      }
      if (result.sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
        fs.rmSync(destination, { force: true })
        throw new Error('更新包 SHA-256 校验失败，文件已删除')
      }

      downloadedFilePath = destination
      return setState({
        phase: 'downloaded',
        message:
          process.platform === 'win32'
            ? '更新包已校验，可重启并安装'
            : '更新包已校验，可打开安装包手动更新',
        error: '',
        download: {
          fileName: assetName,
          transferred: result.bytes,
          total: result.total,
          percent: 100,
          verified: true
        }
      })
    } catch (error) {
      if (error?.code === 'APP_UPDATE_STALE' || !isCurrentOperation(generation)) {
        try {
          fs.rmSync(destination, { force: true })
          fs.rmSync(`${destination}.part`, { force: true })
        } catch {}
        return snapshotState()
      }
      runtime?.logger?.warn('下载应用更新失败', { message: error?.message })
      setState({
        phase: 'error',
        message: '下载更新包失败',
        error: error?.message || '下载更新包失败'
      })
      throw error
    }
  })().finally(() => {
    activeDownload = null
    activeDownloadGeneration = null
  })

  return activeDownload
}

async function installDownloadedUpdate() {
  if (activeInstall) throw new Error('安装程序正在启动，请勿重复操作')
  if (!downloadedFilePath || !fs.existsSync(downloadedFilePath)) {
    throw new Error('更新包尚未下载完成')
  }
  if (!state.download?.verified) throw new Error('更新包尚未通过完整性校验')

  if (process.platform === 'darwin') {
    const errorMessage = await shell.openPath(downloadedFilePath)
    if (errorMessage) throw new Error(`打开更新包失败：${errorMessage}`)
    shell.showItemInFolder(downloadedFilePath)
    return setState({
      phase: 'manual-install',
      message: '已打开 DMG，请将 Ops Desktop 拖入“应用程序”完成更新',
      error: ''
    })
  }

  if (process.platform !== 'win32') throw new Error('当前平台不支持安装更新')
  setState({ phase: 'installing', message: '正在启动安装程序…', error: '' })

  let child
  try {
    child = spawn(downloadedFilePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    })
    activeInstall = child

    await new Promise((resolve, reject) => {
      const onSpawn = () => {
        child.off('error', onError)
        resolve()
      }
      const onError = (error) => {
        child.off('spawn', onSpawn)
        reject(error)
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })
  } catch (error) {
    activeInstall = null
    setState({
      phase: 'error',
      message: '启动安装程序失败',
      error: error?.message || '启动安装程序失败'
    })
    throw error
  }

  child.unref()
  let quitTimer = setTimeout(() => app.quit(), 500)
  child.once('error', (error) => {
    if (quitTimer) clearTimeout(quitTimer)
    quitTimer = null
    activeInstall = null
    setState({
      phase: 'error',
      message: '安装程序启动后发生错误',
      error: error?.message || '安装程序启动失败'
    })
  })
  child.once('close', () => {
    if (activeInstall === child) activeInstall = null
  })
  return snapshotState()
}

function saveAppUpdateSettings(input) {
  saveUpdateSettings({
    userDataPath: getUserDataPath(),
    safeStorage,
    input: input && typeof input === 'object' ? input : {}
  })
  invalidateUpdateOperations()
  const next = setState({
    phase: 'idle',
    settings: publicSettings(),
    release: null,
    download: null,
    message: '更新设置已保存',
    error: ''
  })
  scheduleAutomaticUpdateCheck()
  return next
}

function scheduleAutomaticUpdateCheck() {
  if (autoCheckTimer) clearTimeout(autoCheckTimer)
  autoCheckTimer = null
  if (!runtime || !app.isPackaged) return
  const settings = publicSettings()
  if (!settings.autoCheck || !settings.tokenConfigured) return
  autoCheckTimer = setTimeout(() => {
    checkForAppUpdate({ manual: false }).catch((error) => {
      runtime?.logger?.warn('后台检查应用更新失败', { message: error?.message })
    })
  }, AUTO_CHECK_DELAY_MS)
  autoCheckTimer.unref?.()
}

function initializeAppUpdateService({ userDataPath, openUpdatePage, logger } = {}) {
  if (!userDataPath) throw new Error('应用更新服务缺少数据目录')
  runtime = { userDataPath, openUpdatePage, logger }
  invalidateUpdateOperations()
  state = { ...createInitialState(), settings: publicSettings() }
  scheduleAutomaticUpdateCheck()
  return snapshotState()
}

function stopAppUpdateService() {
  if (autoCheckTimer) clearTimeout(autoCheckTimer)
  autoCheckTimer = null
  invalidateUpdateOperations()
  runtime = null
}

function registerAppUpdateHandlers() {
  ipcMain.handle(IPC_CHANNELS.APP_UPDATE_STATE_GET, async () => getAppUpdateState())
  ipcMain.handle(IPC_CHANNELS.APP_UPDATE_SETTINGS_SAVE, async (_event, input) =>
    saveAppUpdateSettings(input)
  )
  ipcMain.handle(IPC_CHANNELS.APP_UPDATE_CHECK, async () => checkForAppUpdate({ manual: true }))
  ipcMain.handle(IPC_CHANNELS.APP_UPDATE_DOWNLOAD, async () => downloadAppUpdate())
  ipcMain.handle(IPC_CHANNELS.APP_UPDATE_INSTALL, async () => installDownloadedUpdate())
}

module.exports = {
  checkForAppUpdate,
  downloadAppUpdate,
  getAppUpdateState,
  initializeAppUpdateService,
  installDownloadedUpdate,
  registerAppUpdateHandlers,
  saveAppUpdateSettings,
  scheduleAutomaticUpdateCheck,
  stopAppUpdateService
}
