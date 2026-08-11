const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { ipcMain, app, safeStorage } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { formatSize, formatTime, formatPermissions, getFileTypeIcon } = require('../utils/format')
const { readJsonFile, writeJsonFile } = require('../utils/json-store')
const { encryptSecret, maskSecret, readSecretField } = require('../utils/secure-secret')
const { assertLocalPath, normalizeRemotePath } = require('../utils/path-security')
const {
  createReleaseIgnoreMatcher,
  normalizeRuleLines,
  scanLocalEntries
} = require('../utils/release-ignore')
const {
  listReleaseProfiles,
  getActiveReleaseProfile,
  saveReleaseProfile,
  activateReleaseProfile,
  deleteReleaseProfile,
  loadReleaseHistory,
  appendReleaseHistory,
  markReleaseRolledBack,
  normalizeHostFingerprint
} = require('../utils/release-store')
const { addOpsEvent, runHttpHealthCheck } = require('../utils/ops-automation')

// SFTP 配置 - 可从配置文件或环境变量读取
let sftpConfig = null
let sftpClient = null
let sftpConfigSource = null
let crcTable = null

// ZIP 部署会复用同一条 SFTP/SSH 连接，并且会在远端创建临时目录、备份后再替换。
// 因此必须串行执行，避免两个 IPC 请求互相覆盖临时文件或交错替换目录。
function createSerialQueue() {
  let tail = Promise.resolve()

  return (operation) => {
    const result = tail.then(operation)
    // 失败的任务不能阻塞后续任务；调用方仍会从 result 收到原始错误。
    tail = result.catch(() => undefined)
    return result
  }
}

const runZipDeploymentSerially = createSerialQueue()

function recordReleaseEvent(input = {}) {
  try {
    addOpsEvent(app.getPath('userData'), {
      category: 'release',
      ...input
    })
  } catch (error) {
    // 事件中心不可用不能影响真实发布、回滚结果。
    console.error('记录发布运维事件失败:', error)
  }
}
// 发布任务会复用活动环境的连接与配置；在任务入队到完成的整个期间锁住环境变更。
let zipDeploymentPendingCount = 0

function assertNoZipDeploymentInProgress() {
  if (zipDeploymentPendingCount > 0) {
    throw new Error('发布任务执行中，暂不能切换或修改发布环境')
  }
}

function assertDeploymentProfile(profile, expectedProfileId) {
  const currentProfileId = String(profile?.id || '')
  if (!expectedProfileId || currentProfileId !== expectedProfileId) {
    throw new Error('发布环境已切换，已取消执行队列中的发布任务')
  }
}

function getCrcTable() {
  if (crcTable) return crcTable

  crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    crcTable[i] = c >>> 0
  }
  return crcTable
}

function updateCrc32(crc, buffer) {
  const table = getCrcTable()
  let next = crc >>> 0
  for (let i = 0; i < buffer.length; i++) {
    next = table[(next ^ buffer[i]) & 0xff] ^ (next >>> 8)
  }
  return next >>> 0
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear())
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0)
  return buffer
}

function normalizeZipPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
}

function isIgnoredLocalFile(name) {
  return name === '.DS_Store' || name === 'Thumbs.db'
}

function assertSafeArchiveName(name) {
  const normalized = normalizeZipPath(name)
  if (!normalized || normalized === '.' || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`无效的压缩包路径: ${name}`)
  }
  return normalized
}

function collectZipEntries(localPath, archivePath, entries, ignored = () => false) {
  const stat = fs.statSync(localPath)
  const normalizedArchivePath = assertSafeArchiveName(archivePath)
  if (ignored(normalizedArchivePath, stat.isDirectory())) return

  if (stat.isDirectory()) {
    const dirPath = normalizedArchivePath.endsWith('/')
      ? normalizedArchivePath
      : `${normalizedArchivePath}/`
    entries.push({ type: 'directory', localPath, archivePath: dirPath, stat })

    const children = fs.readdirSync(localPath, { withFileTypes: true })
    for (const child of children) {
      if (isIgnoredLocalFile(child.name)) continue
      collectZipEntries(
        path.join(localPath, child.name),
        path.posix.join(normalizedArchivePath, child.name),
        entries,
        ignored
      )
    }
    return
  }

  if (stat.isFile()) {
    entries.push({ type: 'file', localPath, archivePath: normalizedArchivePath, stat })
  }
}

const ZIP_UTF8_FLAG = 0x0800
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008
const ZIP32_MAX_VALUE = 0xffffffff
const ZIP32_MAX_ENTRIES = 0xffff

function buildLocalFileHeader(entry, crc, size, { usesDataDescriptor = false } = {}) {
  const nameBuffer = Buffer.from(entry.archivePath)
  const { dosTime, dosDate } = toDosDateTime(entry.stat.mtime)
  const flags = ZIP_UTF8_FLAG | (usesDataDescriptor ? ZIP_DATA_DESCRIPTOR_FLAG : 0)

  return Buffer.concat([
    writeUInt32(0x04034b50),
    writeUInt16(20),
    writeUInt16(flags),
    writeUInt16(0),
    writeUInt16(dosTime),
    writeUInt16(dosDate),
    writeUInt32(usesDataDescriptor ? 0 : crc),
    writeUInt32(usesDataDescriptor ? 0 : size),
    writeUInt32(usesDataDescriptor ? 0 : size),
    writeUInt16(nameBuffer.length),
    writeUInt16(0),
    nameBuffer
  ])
}

function buildDataDescriptor(crc, size) {
  return Buffer.concat([
    writeUInt32(0x08074b50),
    writeUInt32(crc),
    writeUInt32(size),
    writeUInt32(size)
  ])
}

function buildCentralDirectoryHeader(
  entry,
  crc,
  size,
  offset,
  { usesDataDescriptor = false } = {}
) {
  const nameBuffer = Buffer.from(entry.archivePath)
  const { dosTime, dosDate } = toDosDateTime(entry.stat.mtime)
  const externalAttrs = entry.type === 'directory' ? 0x10 : 0

  return Buffer.concat([
    writeUInt32(0x02014b50),
    writeUInt16(20),
    writeUInt16(20),
    writeUInt16(ZIP_UTF8_FLAG | (usesDataDescriptor ? ZIP_DATA_DESCRIPTOR_FLAG : 0)),
    writeUInt16(0),
    writeUInt16(dosTime),
    writeUInt16(dosDate),
    writeUInt32(crc),
    writeUInt32(size),
    writeUInt32(size),
    writeUInt16(nameBuffer.length),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt32(externalAttrs),
    writeUInt32(offset),
    nameBuffer
  ])
}

function buildEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  return Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entryCount),
    writeUInt16(entryCount),
    writeUInt32(centralSize),
    writeUInt32(centralOffset),
    writeUInt16(0)
  ])
}

async function writeBuffer(output, buffer) {
  let position = 0
  while (position < buffer.length) {
    const { bytesWritten } = await output.write(buffer, position, buffer.length - position)
    if (!bytesWritten) throw new Error('写入压缩包失败')
    position += bytesWritten
  }
}

async function appendFileToZip(output, entry) {
  let size = 0
  let checksum = 0xffffffff

  for await (const chunk of fs.createReadStream(entry.localPath)) {
    size += chunk.length
    if (size > ZIP32_MAX_VALUE) {
      throw new Error(`文件过大，暂不支持打包超过 4GB 的文件: ${entry.localPath}`)
    }
    checksum = updateCrc32(checksum, chunk)
    await writeBuffer(output, chunk)
  }

  return {
    size,
    checksum: (checksum ^ 0xffffffff) >>> 0
  }
}

function assertZip32Value(value, message) {
  if (!Number.isSafeInteger(value) || value < 0 || value > ZIP32_MAX_VALUE) {
    throw new Error(message)
  }
}

async function createZipArchive(sourceEntries, zipPath, ignoreRules = []) {
  const zipEntries = []
  const ignored = createReleaseIgnoreMatcher(ignoreRules)
  for (const source of sourceEntries) {
    if (!source.localPath || !source.archivePath) {
      throw new Error('压缩条目缺少本地路径或压缩包路径')
    }
    if (!fs.existsSync(source.localPath)) {
      throw new Error(`本地路径不存在: ${source.localPath}`)
    }
    collectZipEntries(source.localPath, source.archivePath, zipEntries, ignored)
  }

  if (zipEntries.length > ZIP32_MAX_ENTRIES) {
    throw new Error('压缩条目过多，暂不支持超过 65535 个文件或目录')
  }

  const output = await fs.promises.open(zipPath, 'w')
  const centralHeaders = []
  let offset = 0

  try {
    for (const entry of zipEntries) {
      const entryOffset = offset
      assertZip32Value(entryOffset, '压缩包过大，暂不支持超过 4GB 的 ZIP 文件')
      if (Buffer.byteLength(entry.archivePath) > 0xffff) {
        throw new Error(`压缩包路径过长: ${entry.archivePath}`)
      }

      const usesDataDescriptor = entry.type === 'file'
      const localHeader = buildLocalFileHeader(entry, 0, 0, { usesDataDescriptor })
      await writeBuffer(output, localHeader)
      offset += localHeader.length

      let size = 0
      let checksum = 0
      if (entry.type === 'file') {
        const result = await appendFileToZip(output, entry)
        size = result.size
        checksum = result.checksum
        const descriptor = buildDataDescriptor(checksum, size)
        await writeBuffer(output, descriptor)
        offset += size + descriptor.length
      }

      assertZip32Value(offset, '压缩包过大，暂不支持超过 4GB 的 ZIP 文件')
      centralHeaders.push(
        buildCentralDirectoryHeader(entry, checksum, size, entryOffset, { usesDataDescriptor })
      )
    }

    const centralOffset = offset
    const centralBuffer = Buffer.concat(centralHeaders)
    assertZip32Value(centralOffset, '压缩包过大，暂不支持超过 4GB 的 ZIP 文件')
    assertZip32Value(centralBuffer.length, '压缩包目录过大，暂不支持超过 4GB 的 ZIP 文件')
    await writeBuffer(output, centralBuffer)
    offset += centralBuffer.length
    assertZip32Value(offset, '压缩包过大，暂不支持超过 4GB 的 ZIP 文件')
    await writeBuffer(
      output,
      buildEndOfCentralDirectory(zipEntries.length, centralBuffer.length, centralOffset)
    )
  } finally {
    await output.close()
  }

  return {
    entryCount: zipEntries.length,
    size: (await fs.promises.stat(zipPath)).size
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function getSshConfig() {
  if (!sftpConfig) loadSftpConfig()
  if (!sftpConfig) throw new Error('SFTP 配置未配置，请在设置中配置 SFTP 连接信息')
  if (!sftpConfig.hostFingerprint) {
    throw createHostFingerprintError({
      code: 'SFTP_HOST_FINGERPRINT_REQUIRED',
      expectedFingerprint: ''
    })
  }
  return createSftpConnectionConfig(sftpConfig)
}

function execRemoteCommand(command) {
  const { Client } = require('ssh2')
  const ssh = new Client()
  const { config, getObservedFingerprint } = getSshConfig()

  return new Promise((resolve, reject) => {
    const rejectWithFingerprintError = (error) => {
      const observedFingerprint = getObservedFingerprint()
      if (observedFingerprint && observedFingerprint !== sftpConfig.hostFingerprint) {
        error.code = 'SFTP_HOST_FINGERPRINT_MISMATCH'
        error.expectedFingerprint = sftpConfig.hostFingerprint
        error.observedFingerprint = observedFingerprint
        error.fingerprint = observedFingerprint
        error.message = createHostFingerprintError({
          code: error.code,
          expectedFingerprint: sftpConfig.hostFingerprint,
          observedFingerprint
        }).message
      }
      reject(error)
    }
    let stdout = ''
    let stderr = ''

    ssh.on('ready', () => {
      ssh.exec(command, (err, stream) => {
        if (err) {
          ssh.end()
          reject(err)
          return
        }

        stream.on('close', (code) => {
          ssh.end()
          if (code === 0) {
            resolve({ stdout, stderr })
          } else {
            reject(new Error(stderr || stdout || `远程命令执行失败，退出码: ${code}`))
          }
        })
        stream.on('data', (data) => {
          stdout += data.toString()
        })
        stream.stderr.on('data', (data) => {
          stderr += data.toString()
        })
      })
    })

    ssh.on('error', rejectWithFingerprintError)
    try {
      ssh.connect(config)
    } catch (error) {
      rejectWithFingerprintError(error)
    }
  })
}

/**
 * 生成格式化时间戳，用于压缩包和临时目录命名
 * 格式: 2026-07-27_14-30-00-123
 */
function formatTimestamp() {
  const now = new Date()
  const pad = (n, len) => String(n).padStart(len, '0')
  return (
    [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-') +
    '_' +
    [
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
      pad(now.getMilliseconds(), 3)
    ].join('-')
  )
}

/**
 * 返回压缩包中需要整体替换的第一层条目。
 *
 * 例如 archivePath 为 `app/dist/index.js` 时，部署的最小替换单元是 `app`。
 * 绝不能把 remoteDir 本身作为替换单元：remoteDir 是当前 SFTP 浏览目录，
 * 其中还可能有与本次同步无关的其它项目。
 */
function getArchiveRootNames(entries) {
  const roots = new Set()
  for (const entry of entries) {
    const archivePath = assertSafeArchiveName(entry.archivePath)
    const root = archivePath.split('/')[0]
    if (root) roots.add(root)
  }
  return [...roots]
}

function buildRemoteDeployCommand({
  normalizedRemoteDir,
  remoteStage,
  remoteBackup,
  remoteZipPath,
  archiveRoots
}) {
  const rootTargetPath = (root) => path.posix.join(normalizedRemoteDir, root)
  const rootStagePath = (root) => path.posix.join(remoteStage, root)
  const rootBackupPath = (root) => path.posix.join(remoteBackup, root)
  const backupCommands = archiveRoots.map((root) => {
    const target = rootTargetPath(root)
    const backup = rootBackupPath(root)
    return `if [ -e ${shellQuote(target)} ] || [ -L ${shellQuote(target)} ]; then mkdir -p -- ${shellQuote(remoteBackup)}; mv -- ${shellQuote(target)} ${shellQuote(backup)}; fi`
  })
  const replaceCommands = archiveRoots.map(
    (root) => `mv -- ${shellQuote(rootStagePath(root))} ${shellQuote(rootTargetPath(root))}`
  )
  const restoreCommands = archiveRoots.flatMap((root) => {
    const target = rootTargetPath(root)
    const backup = rootBackupPath(root)
    return [
      `rm -rf -- ${shellQuote(target)}`,
      `if [ -e ${shellQuote(backup)} ] || [ -L ${shellQuote(backup)} ]; then mv -- ${shellQuote(backup)} ${shellQuote(target)}; fi`
    ]
  })

  return [
    'set -e',
    'swap_started=0',
    'deployment_complete=0',
    'restore_deployment() {',
    '  if [ "$swap_started" -eq 1 ]; then',
    ...restoreCommands.map((command) => `    ${command}`),
    '  else',
    // 备份尚未完成时，不删除目标；只把已经移走的条目放回去。
    ...archiveRoots.map((root) => {
      const target = rootTargetPath(root)
      const backup = rootBackupPath(root)
      return `    if [ -e ${shellQuote(backup)} ] || [ -L ${shellQuote(backup)} ]; then mv -- ${shellQuote(backup)} ${shellQuote(target)}; fi`
    }),
    '  fi',
    '}',
    'cleanup_deployment() {',
    '  status=$?',
    '  trap - 0',
    '  if [ "$deployment_complete" -ne 1 ]; then restore_deployment; fi',
    `  if [ "$deployment_complete" -ne 1 ]; then rm -rf -- ${shellQuote(remoteBackup)}; fi`,
    `  rm -rf -- ${shellQuote(remoteStage)} ${shellQuote(remoteZipPath)}`,
    '  exit "$status"',
    '}',
    // `trap ... 0` 是 POSIX sh 支持的 EXIT trap；不能使用 bash 专属的 ERR trap。
    'trap cleanup_deployment 0',
    `rm -rf -- ${shellQuote(remoteStage)} ${shellQuote(remoteBackup)}`,
    `mkdir -p -- ${shellQuote(normalizedRemoteDir)} ${shellQuote(remoteStage)}`,
    `unzip -qo ${shellQuote(remoteZipPath)} -d ${shellQuote(remoteStage)}`,
    ...backupCommands,
    'swap_started=1',
    ...replaceCommands,
    'deployment_complete=1',
    `rm -rf -- ${shellQuote(remoteStage)} ${shellQuote(remoteZipPath)}`,
    'trap - 0'
  ].join('\n')
}

function buildRemoteRollbackCommand({ remoteDir, backupPath, rollbackBackup, archiveRoots }) {
  const commands = ['set -e', `mkdir -p -- ${shellQuote(rollbackBackup)}`]
  for (const root of archiveRoots) {
    const current = path.posix.join(remoteDir, root)
    const previous = path.posix.join(backupPath, root)
    const savedCurrent = path.posix.join(rollbackBackup, root)
    commands.push(
      `if [ -e ${shellQuote(current)} ] || [ -L ${shellQuote(current)} ]; then mv -- ${shellQuote(current)} ${shellQuote(savedCurrent)}; fi`
    )
    commands.push(
      `if [ -e ${shellQuote(previous)} ] || [ -L ${shellQuote(previous)} ]; then mv -- ${shellQuote(previous)} ${shellQuote(current)}; fi`
    )
  }
  return commands.join('\n')
}

async function deployZipToRemote(
  sftp,
  { entries, remoteDir, clearRemotePaths = [], ignoreRules = [], releaseId = crypto.randomUUID() }
) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('没有需要同步的文件')
  }
  if (!remoteDir || typeof remoteDir !== 'string') {
    throw new Error('远程目标目录不能为空')
  }

  const normalizedRemoteDir =
    remoteDir.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'
  const archiveRoots = getArchiveRootNames(entries)
  const appName =
    entries.length === 1
      ? path.basename(
          entries[0].archivePath || entries[0].localPath,
          path.extname(entries[0].archivePath || entries[0].localPath)
        )
      : 'ops-sync'
  const stamp = formatTimestamp()
  const zipName = `${appName}-deploy-${stamp}.zip`
  const localZipPath = path.join(app.getPath('temp'), zipName)
  const remoteTmpRoot = '/tmp'
  const remoteZipPath = path.posix.join(remoteTmpRoot, zipName)
  const remoteStage = path.posix.join(remoteTmpRoot, `${appName}-stage-${stamp}`)
  // 备份存放在目标目录的父级，以便大多数部署可在同一文件系统内原子移动。
  const backupParent =
    normalizedRemoteDir === '/' ? remoteTmpRoot : path.posix.dirname(normalizedRemoteDir)
  const remoteBackup = path.posix.join(backupParent, '.ops-release-backups', releaseId)
  let remoteZipUploaded = false

  try {
    // 第 1 步：本地打包
    const zipResult = await createZipArchive(entries, localZipPath, ignoreRules)

    // 第 2 步：上传 zip 到服务器 /tmp
    await sftp.put(localZipPath, remoteZipPath)
    remoteZipUploaded = true

    // 第 3 步：只替换压缩包第一层的条目，而不是替换整个 remoteDir。
    //
    // 旧实现在这里将 remoteDir 移到备份后，以 staging 目录整体替换它。比如在
    // 在远端应用目录中部署一个文件时，不能将整个远端目录替换为只有本次 ZIP 内容的目录，
    // 因而清空了所有未包含在 zip 中的文件。现在逐个备份、替换 archiveRoots，
    // 保留 remoteDir 下不属于本次同步的内容。
    // clearRemotePaths 是旧渲染层传来的兼容参数；实际清理由 archiveRoots 控制，
    // 以防调用方误传 remoteDir 或其父目录导致整目录被删除。
    void clearRemotePaths
    const remoteCommand = buildRemoteDeployCommand({
      normalizedRemoteDir,
      remoteStage,
      remoteBackup,
      remoteZipPath,
      archiveRoots
    })

    await execRemoteCommand(remoteCommand)

    return {
      zipName,
      remoteDir: normalizedRemoteDir,
      entryCount: zipResult.entryCount,
      zipSize: zipResult.size,
      releaseId,
      backupPath: remoteBackup,
      archiveRoots
    }
  } catch (err) {
    // 不删除 backup：SSH 连接在远程命令执行中断时，保留它比盲目清理更安全；
    // 成功执行的命令或 EXIT trap 会自行清除它。
    try {
      await execRemoteCommand(`rm -rf -- ${shellQuote(remoteStage)} ${shellQuote(remoteZipPath)}`)
    } catch {
      // ignore cleanup failure
    }
    throw err
  } finally {
    if (remoteZipUploaded) {
      try {
        // zip 已在远程命令中删除，这里尝试清理（可能已不存在）
        await sftp.delete(remoteZipPath)
      } catch {
        // ignore cleanup failure
      }
    }

    try {
      if (fs.existsSync(localZipPath)) fs.unlinkSync(localZipPath)
    } catch (err) {
      console.warn('清理本地临时 zip 失败:', err.message)
    }
  }
}

function buildRollbackFailureHistoryRecord({
  activeProfile,
  target,
  releaseId,
  error,
  remoteDir = '',
  archiveRoots = [],
  rollbackBackup = '',
  startedAt,
  finishedAt = Date.now()
}) {
  return {
    profileId: String(activeProfile?.id || ''),
    profileName: String(activeProfile?.name || ''),
    action: 'rollback',
    status: 'failed',
    label: `回滚：${String(target?.label || '发布任务')}`,
    remoteDir: String(remoteDir || target?.remoteDir || ''),
    archiveRoots:
      Array.isArray(archiveRoots) && archiveRoots.length
        ? archiveRoots.map(String)
        : Array.isArray(target?.archiveRoots)
          ? target.archiveRoots.map(String)
          : [],
    // 回滚命令可能已经创建了暂存当前版本的备份；优先保留其路径以便人工排查。
    backupPath: String(rollbackBackup || target?.backupPath || ''),
    sourceReleaseId: String(target?.id || releaseId || ''),
    message: String(error?.message || error || '回滚失败'),
    startedAt,
    finishedAt
  }
}

async function getRemoteFileSize(sftp, remotePath) {
  const remoteType = await sftp.exists(remotePath)
  if (!remoteType) return 0

  const stat = await sftp.stat(remotePath)
  if (stat.isDirectory) return null
  return Number(stat.size) || 0
}

async function uploadFileWithResume(sftp, localPath, remotePath) {
  const localStat = fs.statSync(localPath)
  const localSize = localStat.size
  const remoteSize = await getRemoteFileSize(sftp, remotePath)

  if (remoteSize > 0 && remoteSize < localSize) {
    const stream = fs.createReadStream(localPath, { start: remoteSize })
    await sftp.put(stream, remotePath, {
      writeStreamOptions: { flags: 'a' }
    })
    return {
      skipped: false,
      resumed: true,
      transferred: localSize - remoteSize,
      remoteSize
    }
  }

  await sftp.put(localPath, remotePath)
  return {
    skipped: false,
    resumed: false,
    transferred: localSize,
    remoteSize
  }
}

const DEFAULT_SFTP_CONFIG = {
  host: '',
  port: 22,
  username: '',
  password: '',
  hostFingerprint: ''
}

const DEFAULT_SFTP_PATHS = {
  localDir: '',
  remoteDir: ''
}

function getSftpConfigPath() {
  return path.join(app.getPath('userData'), 'sftp-config.json')
}

function getSftpPathsPath() {
  return path.join(app.getPath('userData'), 'sftp-paths.json')
}

function normalizeRemoteDir(remoteDir) {
  const normalized = String(remoteDir || '/')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`
  return normalizeRemotePath(absolutePath).replace(/\/$/, '') || '/'
}

function sanitizeSftpPaths(paths = {}) {
  const remoteDir = String(paths.remoteDir || '').trim()
  return {
    localDir: String(paths.localDir || '').trim(),
    remoteDir: remoteDir ? normalizeRemoteDir(remoteDir) : ''
  }
}

/**
 * 发布环境与目录必须一起保存。先校验完整路径，再写入 profile，避免连接配置
 * 已落盘但目录无效的半成功状态。
 */
function validateSftpPaths(paths = {}) {
  const nextPaths = sanitizeSftpPaths(paths)
  if (!nextPaths.localDir) throw new Error('请选择本地目录')
  if (!nextPaths.remoteDir) throw new Error('请填写服务器目录')

  const stat = fs.statSync(nextPaths.localDir)
  if (!stat.isDirectory()) throw new Error(`本地路径不是目录: ${nextPaths.localDir}`)
  return nextPaths
}

function getStoredSftpPaths() {
  const activeProfile = getActiveReleaseProfile()
  if (activeProfile) return sanitizeSftpPaths(activeProfile)
  return sanitizeSftpPaths(readJsonFile(getSftpPathsPath(), DEFAULT_SFTP_PATHS))
}

function sanitizeSftpConfig(config = {}) {
  const port = Number.parseInt(config.port, 10)
  return {
    host: String(config.host || '').trim(),
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_SFTP_CONFIG.port,
    username: String(config.username || '').trim(),
    password: String(config.password || ''),
    hostFingerprint: normalizeHostFingerprint(config.hostFingerprint)
  }
}

function createHostFingerprintError({
  code,
  expectedFingerprint = '',
  observedFingerprint = ''
} = {}) {
  let message
  if (code === 'SFTP_HOST_FINGERPRINT_MISMATCH') {
    message = `SSH 主机指纹不匹配，已拒绝连接。配置值：${expectedFingerprint || '未配置'}；观测值：${observedFingerprint || '未获取'}`
  } else {
    message = observedFingerprint
      ? `未配置 SSH 主机指纹，已拒绝自动接受主机密钥。请确认观测指纹：${observedFingerprint}`
      : '未配置 SSH 主机指纹，已拒绝自动接受主机密钥。请先执行连接测试并确认指纹。'
  }
  const error = new Error(message)
  error.code = code || 'SFTP_HOST_FINGERPRINT_REQUIRED'
  error.expectedFingerprint = expectedFingerprint
  error.observedFingerprint = observedFingerprint
  error.fingerprint = observedFingerprint
  return error
}

function createSftpConnectionConfig(config, { onObserved } = {}) {
  const normalized = sanitizeSftpConfig(config)
  let observedFingerprint = ''
  const connectionConfig = { ...normalized }
  delete connectionConfig.hostFingerprint
  connectionConfig.hostHash = 'sha256'
  connectionConfig.hostVerifier = (keyHash) => {
    try {
      observedFingerprint = normalizeHostFingerprint(keyHash)
    } catch {
      observedFingerprint = ''
    }
    if (observedFingerprint && typeof onObserved === 'function') onObserved(observedFingerprint)
    return Boolean(normalized.hostFingerprint) && observedFingerprint === normalized.hostFingerprint
  }
  return {
    config: connectionConfig,
    getObservedFingerprint: () => observedFingerprint
  }
}

function isSftpConfigComplete(config) {
  return Boolean(config?.host && config?.username)
}

function setSftpConfig(config, source) {
  const normalized = sanitizeSftpConfig(config)
  if (!isSftpConfigComplete(normalized)) return null
  sftpConfig = normalized
  sftpConfigSource = source
  return sftpConfig
}

function serializeSftpConfigForStorage(config) {
  const normalized = sanitizeSftpConfig(config)
  return {
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    hostFingerprint: normalized.hostFingerprint,
    passwordEncrypted: encryptSecret(safeStorage, normalized.password)
  }
}

function writeStoredSftpConfig(config) {
  return writeJsonFile(getSftpConfigPath(), serializeSftpConfigForStorage(config))
}

function getStoredSftpConfig() {
  const stored = readJsonFile(getSftpConfigPath(), DEFAULT_SFTP_CONFIG)
  const secret = readSecretField({
    safeStorage,
    record: stored,
    encryptedKey: 'passwordEncrypted',
    legacyKey: 'password'
  })
  const config = sanitizeSftpConfig({ ...stored, password: secret.value })

  if (secret.needsMigration) {
    try {
      if (!writeStoredSftpConfig(config)) throw new Error('写入迁移配置失败')
    } catch (error) {
      console.error('迁移 SFTP 密码失败:', error)
    }
  }

  return config
}

/**
 * 加载 SFTP 配置
 * 优先级：环境变量 > 当前发布 Profile > 用户保存的配置
 */
function loadSftpConfig() {
  // 1. 从环境变量读取（显式运行时覆盖始终优先）
  if (process.env.SFTP_HOST) {
    return setSftpConfig(
      {
        host: process.env.SFTP_HOST,
        port: process.env.SFTP_PORT || DEFAULT_SFTP_CONFIG.port,
        username: process.env.SFTP_USERNAME,
        password: process.env.SFTP_PASSWORD,
        hostFingerprint: process.env.SFTP_HOST_FINGERPRINT
      },
      'environment'
    )
  }

  // 2. 从当前发布 Profile 读取
  const activeProfile = getActiveReleaseProfile({ includePassword: true })
  if (activeProfile?.host && activeProfile?.username) {
    setSftpConfig(activeProfile, 'profile')
    return sftpConfig
  }

  // 3. 从旧版用户配置文件读取
  try {
    const config = getStoredSftpConfig()
    if (isSftpConfigComplete(config)) {
      return setSftpConfig(config, 'saved')
    }
  } catch (err) {
    console.error('加载 SFTP 配置失败:', err)
  }

  sftpConfig = null
  sftpConfigSource = null
  return null
}

function getSftpConfigDetails() {
  const effectiveConfig = loadSftpConfig()
  const savedConfig = getStoredSftpConfig()
  const activeProfile = getActiveReleaseProfile({ includePassword: true })
  const visibleConfig =
    sftpConfigSource === 'profile'
      ? activeProfile
      : sftpConfigSource === 'saved'
        ? savedConfig
        : {
            ...DEFAULT_SFTP_CONFIG,
            host: effectiveConfig?.host || '',
            port: effectiveConfig?.port || 22,
            username: effectiveConfig?.username || '',
            hostFingerprint: effectiveConfig?.hostFingerprint || ''
          }
  const {
    password: _password,
    passwordEncrypted: _passwordEncrypted,
    ...safeConfig
  } = visibleConfig || {}
  return {
    configured: Boolean(effectiveConfig),
    source: sftpConfigSource,
    config: {
      ...safeConfig,
      password: '',
      hasPassword: Boolean(visibleConfig?.password || visibleConfig?.passwordEncrypted),
      passwordMasked: maskSecret(visibleConfig?.password)
    }
  }
}

/**
 * 获取或创建 SFTP 连接
 */
async function getSftpClient({ probeFingerprint = false } = {}) {
  const Client = require('ssh2-sftp-client')

  if (!sftpConfig) loadSftpConfig()
  if (!sftpConfig) throw new Error('SFTP 配置未配置，请在设置中配置 SFTP 连接信息')
  if (!probeFingerprint && !sftpConfig.hostFingerprint) {
    throw createHostFingerprintError({
      code: 'SFTP_HOST_FINGERPRINT_REQUIRED',
      expectedFingerprint: ''
    })
  }

  if (sftpClient && sftpConfig.hostFingerprint) {
    try {
      await sftpClient.list('/')
      return sftpClient
    } catch {
      sftpClient = null
    }
  } else if (sftpClient) {
    await closeSftpConnection()
  }

  const { config, getObservedFingerprint } = createSftpConnectionConfig(sftpConfig)
  const client = new Client()
  try {
    await client.connect(config)
    const observedFingerprint = getObservedFingerprint()
    if (!sftpConfig.hostFingerprint) {
      await client.end().catch(() => undefined)
      throw createHostFingerprintError({
        code: 'SFTP_HOST_FINGERPRINT_REQUIRED',
        observedFingerprint
      })
    }
    sftpClient = client
    return client
  } catch (error) {
    await client.end().catch(() => undefined)
    const observedFingerprint = getObservedFingerprint()
    if (observedFingerprint) {
      error.observedFingerprint = observedFingerprint
      error.fingerprint = observedFingerprint
      if (!sftpConfig.hostFingerprint) {
        error.code = 'SFTP_HOST_FINGERPRINT_REQUIRED'
      } else if (observedFingerprint !== sftpConfig.hostFingerprint) {
        error.code = 'SFTP_HOST_FINGERPRINT_MISMATCH'
        error.expectedFingerprint = sftpConfig.hostFingerprint
        error.message = createHostFingerprintError({
          code: error.code,
          expectedFingerprint: sftpConfig.hostFingerprint,
          observedFingerprint
        }).message
      }
    }
    throw error
  }
}

/**
 * 注册 SFTP 相关的 IPC 处理器
 */
function registerSftpHandlers() {
  ipcMain.handle(IPC_CHANNELS.SFTP_CONFIG_GET, async () => {
    try {
      return { success: true, data: getSftpConfigDetails() }
    } catch (err) {
      console.error('读取 SFTP 配置失败:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SFTP_PATHS_GET, async () => {
    try {
      return { success: true, data: getStoredSftpPaths() }
    } catch (err) {
      console.error('读取发布目录配置失败:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SFTP_PATHS_SAVE, async (_event, paths = {}) => {
    try {
      assertNoZipDeploymentInProgress()
    } catch (err) {
      return { success: false, error: err.message }
    }
    try {
      const nextPaths = validateSftpPaths(paths)
      const activeProfile = getActiveReleaseProfile()
      if (activeProfile) {
        saveReleaseProfile({ ...activeProfile, ...nextPaths })
      } else if (!writeJsonFile(getSftpPathsPath(), nextPaths)) {
        return { success: false, error: '保存发布目录配置失败' }
      }
      return { success: true, data: nextPaths }
    } catch (err) {
      const error =
        err?.code === 'ENOENT'
          ? `本地目录不存在: ${String(paths?.localDir || '').trim()}`
          : err.message
      return { success: false, error }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SFTP_CONFIG_SAVE, async (_event, config = {}) => {
    try {
      assertNoZipDeploymentInProgress()
    } catch (err) {
      return { success: false, error: err.message }
    }
    let nextConfig
    try {
      const currentConfig = getStoredSftpConfig()
      const suppliedPassword = String(config.password || '')
      nextConfig = sanitizeSftpConfig({
        ...currentConfig,
        ...config,
        password: config.clearPassword ? '' : suppliedPassword || currentConfig.password
      })
    } catch (err) {
      return { success: false, error: err?.message || '读取 SFTP 配置失败' }
    }
    if (!isSftpConfigComplete(nextConfig)) {
      return { success: false, error: '请填写服务器地址和用户名' }
    }

    try {
      if (!writeStoredSftpConfig(nextConfig)) {
        return { success: false, error: '保存 SFTP 配置失败' }
      }
      await closeSftpConnection()
      sftpConfig = null
      sftpConfigSource = null
      return {
        success: true,
        data: {
          ...nextConfig,
          password: '',
          hasPassword: Boolean(nextConfig.password),
          passwordMasked: maskSecret(nextConfig.password)
        }
      }
    } catch (err) {
      console.error('保存 SFTP 配置失败:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SFTP_TEST, async () => {
    try {
      await getSftpClient({ probeFingerprint: true })
      return {
        success: true,
        message: `已连接到 ${sftpConfig.host}:${sftpConfig.port}`,
        fingerprint: sftpConfig.hostFingerprint,
        config: {
          host: sftpConfig.host,
          port: sftpConfig.port,
          username: sftpConfig.username,
          hostFingerprint: sftpConfig.hostFingerprint
        }
      }
    } catch (err) {
      console.error('SFTP 连接测试失败:', err)
      const observedFingerprint = err?.observedFingerprint || err?.fingerprint || ''
      const expectedFingerprint = sftpConfig?.hostFingerprint || err?.expectedFingerprint || ''
      const code = !sftpConfig
        ? err?.code || 'SFTP_CONNECTION_FAILED'
        : expectedFingerprint
          ? observedFingerprint && observedFingerprint !== expectedFingerprint
            ? 'SFTP_HOST_FINGERPRINT_MISMATCH'
            : err?.code || 'SFTP_CONNECTION_FAILED'
          : 'SFTP_HOST_FINGERPRINT_REQUIRED'
      const fingerprintError =
        code === 'SFTP_HOST_FINGERPRINT_REQUIRED'
          ? createHostFingerprintError({ code, observedFingerprint })
          : code === 'SFTP_HOST_FINGERPRINT_MISMATCH'
            ? createHostFingerprintError({ code, expectedFingerprint, observedFingerprint })
            : err
      return {
        success: false,
        code,
        error: fingerprintError?.message || err.message,
        fingerprint: observedFingerprint,
        observedFingerprint,
        expectedFingerprint,
        canConfirm: code === 'SFTP_HOST_FINGERPRINT_REQUIRED' && Boolean(observedFingerprint)
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SFTP_LIST, async (_event, dirPath) => {
    try {
      const safeDirPath = normalizeRemotePath(dirPath)

      const sftp = await getSftpClient()
      const list = await sftp.list(safeDirPath)

      // 排序：目录在前，文件在后
      const sorted = list.sort((a, b) => {
        if (a.type === 'd' && b.type !== 'd') return -1
        if (a.type !== 'd' && b.type === 'd') return 1
        return a.name.localeCompare(b.name)
      })

      const items = sorted.map((item) => ({
        name: item.name,
        type: item.type === 'd' ? 'directory' : 'file',
        size: item.size,
        sizeFormatted: formatSize(item.size),
        modifyTime: item.modifyTime,
        modifyTimeFormatted: formatTime(item.modifyTime),
        permissions: item.rights ? formatPermissions(item.rights) : '-',
        owner: item.owner || '-',
        group: item.group || '-',
        icon: getFileTypeIcon(item),
        path: path.posix.join(safeDirPath, item.name).replace(/\/+/g, '/')
      }))

      return {
        success: true,
        data: {
          currentPath: safeDirPath,
          parentPath: path.posix.dirname(safeDirPath) || '/',
          items
        }
      }
    } catch (err) {
      console.error('SFTP 目录列表失败:', err)
      return { success: false, error: err.message }
    }
  })

  /**
   * 上传文件到服务器
   */
  ipcMain.handle(IPC_CHANNELS.SFTP_UPLOAD, async (_event, { localPath, remotePath }) => {
    try {
      const safeLocalPath = assertLocalPath(localPath)
      const safeRemotePath = normalizeRemotePath(remotePath, { allowRoot: false })

      if (!fs.existsSync(safeLocalPath)) {
        return { success: false, error: `本地文件不存在: ${safeLocalPath}` }
      }

      const sftp = await getSftpClient()
      const uploadResult = await uploadFileWithResume(sftp, safeLocalPath, safeRemotePath)

      return {
        success: true,
        message: uploadResult.skipped
          ? `已存在: ${path.basename(safeLocalPath)}`
          : uploadResult.resumed
            ? `已续传: ${path.basename(safeLocalPath)}`
            : `已上传: ${path.basename(safeLocalPath)}`,
        data: uploadResult
      }
    } catch (err) {
      console.error('SFTP 上传失败:', err)
      return { success: false, error: err.message }
    }
  })

  /**
   * 将本地文件/目录打成 zip 后上传到 /tmp，再在服务器目标目录解压并删除 zip
   */
  ipcMain.handle(IPC_CHANNELS.SFTP_DEPLOY_ZIP, async (_event, payload = {}) => {
    const startedAt = Date.now()
    const deploymentProfile = getActiveReleaseProfile()
    const deploymentProfileId = String(deploymentProfile?.id || '')
    const releaseId = crypto.randomUUID()
    zipDeploymentPendingCount += 1
    try {
      const { entries, remoteDir, clearRemotePaths = [], ignoreRules = [], label = '' } = payload
      if (!deploymentProfileId) throw new Error('请先选择发布环境')

      if (!Array.isArray(entries) || entries.length === 0) {
        return { success: false, error: '没有需要同步的文件' }
      }

      const safeRemoteDir = normalizeRemotePath(remoteDir, { allowRoot: false })
      const normalizedEntries = entries.map((entry) => {
        const localPath = assertLocalPath(entry?.localPath)
        if (!fs.existsSync(localPath)) throw new Error(`本地文件不存在: ${localPath}`)
        return {
          localPath,
          archivePath: assertSafeArchiveName(entry?.archivePath || path.basename(localPath))
        }
      })

      // 渲染层会显示 FIFO 队列；主进程仍需在这里兜底串行化，防止多个窗口或未来
      // 新增的调用方同时使用共享的 sftpClient/SSH 连接执行部署。
      const result = await runZipDeploymentSerially(async () => {
        // 队列等待期间也可能有其他窗口修改环境；执行前再次校验，绝不把 A 的任务发到 B。
        assertDeploymentProfile(getActiveReleaseProfile(), deploymentProfileId)
        const sftp = await getSftpClient()
        return deployZipToRemote(sftp, {
          entries: normalizedEntries,
          remoteDir: safeRemoteDir,
          clearRemotePaths,
          ignoreRules: normalizeRuleLines(ignoreRules),
          releaseId
        })
      })

      const healthConfig = deploymentProfile?.healthCheck
      let healthCheck = null
      let autoRollback = null
      if (healthConfig?.enabled) {
        healthCheck = await runHttpHealthCheck({
          type: 'http-health',
          target: healthConfig.url,
          expectedStatus: healthConfig.expectedStatus,
          timeoutMs: healthConfig.timeoutMs
        })
        if (
          !healthCheck.ok &&
          healthConfig.autoRollback &&
          result.backupPath &&
          result.archiveRoots?.length
        ) {
          const rollbackBackup = `${result.backupPath}-auto-${formatTimestamp()}`
          try {
            await execRemoteCommand(
              buildRemoteRollbackCommand({
                remoteDir: result.remoteDir,
                backupPath: result.backupPath,
                rollbackBackup,
                archiveRoots: result.archiveRoots.map(assertSafeArchiveName)
              })
            )
            autoRollback = { ok: true, backupPath: rollbackBackup }
          } catch (error) {
            autoRollback = {
              ok: false,
              message: String(error?.message || '自动回滚失败').slice(0, 500)
            }
          }
        }
      }

      const historyEntry = appendReleaseHistory({
        id: releaseId,
        profileId: deploymentProfileId,
        profileName: deploymentProfile?.name || '',
        status: 'success',
        label: label || normalizedEntries.map((item) => item.archivePath).join('、'),
        remoteDir: result.remoteDir,
        archiveRoots: result.archiveRoots,
        backupPath: result.backupPath,
        entryCount: result.entryCount,
        zipSize: result.zipSize,
        message:
          healthCheck?.ok === false
            ? `发布完成，但健康检查失败：${healthCheck.message}${autoRollback?.ok ? '；已自动回滚' : ''}`
            : healthCheck
              ? `发布成功；健康检查通过：${healthCheck.message}`
              : '发布成功',
        startedAt,
        finishedAt: Date.now()
      })
      if (autoRollback?.ok) {
        markReleaseRolledBack(historyEntry.id)
        appendReleaseHistory({
          profileId: deploymentProfileId,
          profileName: deploymentProfile?.name || '',
          action: 'rollback',
          status: 'success',
          label: `自动回滚：${historyEntry.label}`,
          remoteDir: result.remoteDir,
          archiveRoots: result.archiveRoots,
          backupPath: autoRollback.backupPath,
          sourceReleaseId: historyEntry.id,
          message: `健康检查失败后自动回滚：${healthCheck.message}`,
          startedAt,
          finishedAt: Date.now()
        })
      }
      if (healthCheck?.ok === false) {
        recordReleaseEvent({
          sourceKey: `release:${releaseId}`,
          level: autoRollback?.ok ? 'warning' : 'critical',
          status: autoRollback?.ok ? 'resolved' : 'open',
          title: autoRollback?.ok
            ? `发布健康检查失败，已自动回滚：${historyEntry.label}`
            : `发布健康检查失败：${historyEntry.label}`,
          description: `${healthCheck.message}${autoRollback?.message ? `；自动回滚失败：${autoRollback.message}` : ''}`,
          relatedId: releaseId
        })
        return {
          success: false,
          error: autoRollback?.ok
            ? `发布后的健康检查失败，已自动回滚：${healthCheck.message}`
            : `发布后的健康检查失败：${healthCheck.message}`,
          data: { ...result, healthCheck, autoRollback }
        }
      }
      recordReleaseEvent({
        sourceKey: `release:${releaseId}`,
        level: 'info',
        status: 'resolved',
        title: `发布成功：${historyEntry.label}`,
        description: healthCheck
          ? `健康检查通过：${healthCheck.message}`
          : `已同步 ${normalizedEntries.length} 项到 ${result.remoteDir}`,
        relatedId: releaseId
      })
      return {
        success: true,
        message: `已通过 zip 同步 ${normalizedEntries.length} 项到 ${result.remoteDir}${healthCheck ? `；健康检查：${healthCheck.message}` : ''}`,
        data: { ...result, healthCheck, autoRollback }
      }
    } catch (err) {
      console.error('SFTP zip 部署失败:', err)
      try {
        appendReleaseHistory({
          id: releaseId,
          profileId: deploymentProfileId,
          profileName: deploymentProfile?.name || '',
          status: 'failed',
          label: payload?.label || '发布任务',
          remoteDir: payload?.remoteDir,
          message: err.message,
          startedAt,
          finishedAt: Date.now()
        })
      } catch {}
      recordReleaseEvent({
        sourceKey: `release:${releaseId}`,
        level: 'critical',
        status: 'open',
        title: `发布失败：${payload?.label || '发布任务'}`,
        description: String(err?.message || '未知发布错误').slice(0, 1000),
        relatedId: releaseId
      })
      return { success: false, error: err.message }
    } finally {
      zipDeploymentPendingCount = Math.max(0, zipDeploymentPendingCount - 1)
    }
  })

  /**
   * 删除服务器上的文件或目录
   */
  ipcMain.handle(IPC_CHANNELS.SFTP_DELETE, async (_event, remotePath) => {
    try {
      const safeRemotePath = normalizeRemotePath(remotePath, { allowRoot: false })

      const sftp = await getSftpClient()
      const stats = await sftp.stat(safeRemotePath)

      if (stats.isDirectory) {
        await sftp.rmdir(safeRemotePath, true) // 递归删除目录
      } else {
        await sftp.delete(safeRemotePath)
      }

      return { success: true, message: `已删除: ${path.basename(safeRemotePath)}` }
    } catch (err) {
      console.error('SFTP 删除失败:', err)
      return { success: false, error: err.message }
    }
  })

  /**
   * 比较本地目录和远程目录
   */
  ipcMain.handle(IPC_CHANNELS.SFTP_COMPARE, async (_event, { localDir, remoteDir }) => {
    try {
      const safeLocalDir = assertLocalPath(localDir, '本地目录')
      const safeRemoteDir = normalizeRemotePath(remoteDir)

      // 检查本地目录是否存在
      if (!fs.existsSync(safeLocalDir)) {
        return { success: false, error: `本地目录不存在: ${safeLocalDir}` }
      }

      const sftp = await getSftpClient()

      // 递归获取本地文件列表
      function getLocalFiles(dir, base = '') {
        const files = []
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const relativePath = path.posix.join(base, entry.name)
          if (entry.isDirectory()) {
            files.push(...getLocalFiles(path.join(dir, entry.name), relativePath))
          } else {
            const stat = fs.statSync(path.join(dir, entry.name))
            files.push({
              name: entry.name,
              path: relativePath,
              size: stat.size,
              modifyTime: stat.mtimeMs,
              type: 'file'
            })
          }
        }
        return files
      }

      // 递归获取远程文件列表
      async function getRemoteFiles(dir, base = '') {
        const files = []
        const list = await sftp.list(dir)
        for (const item of list) {
          const relativePath = path.posix.join(base, item.name)
          if (item.type === 'd') {
            files.push(...(await getRemoteFiles(path.posix.join(dir, item.name), relativePath)))
          } else {
            files.push({
              name: item.name,
              path: relativePath,
              size: item.size,
              modifyTime: item.modifyTime,
              type: 'file'
            })
          }
        }
        return files
      }

      const localFiles = getLocalFiles(safeLocalDir)
      const remoteFiles = await getRemoteFiles(safeRemoteDir)

      // 建立映射
      const localMap = new Map(localFiles.map((f) => [f.path, f]))
      const remoteMap = new Map(remoteFiles.map((f) => [f.path, f]))

      const onlyLocal = [] // 仅本地有
      const onlyRemote = [] // 仅远程有
      const modified = [] // 两边都有但内容不同

      // 检查本地文件
      for (const [filePath, localFile] of localMap) {
        const remoteFile = remoteMap.get(filePath)
        if (!remoteFile) {
          onlyLocal.push(localFile)
        } else if (
          localFile.size !== remoteFile.size ||
          localFile.modifyTime > remoteFile.modifyTime
        ) {
          modified.push({ local: localFile, remote: remoteFile })
        }
      }

      // 检查远程独有的文件
      for (const [filePath, remoteFile] of remoteMap) {
        if (!localMap.has(filePath)) {
          onlyRemote.push(remoteFile)
        }
      }

      return {
        success: true,
        data: {
          localDir: safeLocalDir,
          remoteDir: safeRemoteDir,
          onlyLocal,
          onlyRemote,
          modified,
          summary: {
            total: localFiles.length + remoteFiles.length,
            onlyLocal: onlyLocal.length,
            onlyRemote: onlyRemote.length,
            modified: modified.length
          }
        }
      }
    } catch (err) {
      console.error('SFTP 目录比较失败:', err)
      return { success: false, error: err.message }
    }
  })

  /**
   * 获取本地目录文件列表
   */
  ipcMain.handle(IPC_CHANNELS.SFTP_LOCAL_LIST, async (_event, localDir) => {
    try {
      const safeLocalDir = assertLocalPath(localDir, '本地目录')

      if (!fs.existsSync(safeLocalDir)) {
        return { success: false, error: `本地目录不存在: ${safeLocalDir}` }
      }

      const entries = fs.readdirSync(safeLocalDir, { withFileTypes: true })
      const items = entries.map((entry) => {
        const fullPath = path.join(safeLocalDir, entry.name)
        const stat = fs.statSync(fullPath)
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          sizeFormatted: formatSize(stat.size),
          modifyTime: stat.mtimeMs,
          modifyTimeFormatted: formatTime(stat.mtimeMs / 1000),
          path: path.posix.join(safeLocalDir, entry.name).replace(/\\/g, '/')
        }
      })

      // 排序：目录在前，文件在后
      items.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })

      return {
        success: true,
        data: {
          currentPath: safeLocalDir,
          items
        }
      }
    } catch (err) {
      console.error('获取本地目录列表失败:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SFTP_PREFLIGHT, async (_event, payload = {}) => {
    try {
      const entries = Array.isArray(payload.entries)
        ? payload.entries.map((entry) => ({
            localPath: assertLocalPath(entry?.localPath),
            archivePath: assertSafeArchiveName(
              entry?.archivePath || path.basename(entry?.localPath || '')
            )
          }))
        : []
      if (!entries.length) throw new Error('没有需要检查的发布内容')
      const remoteDir = normalizeRemotePath(payload.remoteDir, { allowRoot: false })
      for (const entry of entries)
        if (!fs.existsSync(entry.localPath)) throw new Error(`本地路径不存在: ${entry.localPath}`)
      const summary = scanLocalEntries(entries, normalizeRuleLines(payload.ignoreRules))
      if (!summary.files) throw new Error('忽略规则生效后没有可发布文件')
      const sftp = await getSftpClient()
      let remoteExists = true
      try {
        await sftp.stat(remoteDir)
      } catch {
        remoteExists = false
      }
      return {
        success: true,
        data: {
          checks: [
            {
              key: 'connection',
              label: 'SFTP 连接',
              status: 'passed',
              message: `${sftpConfig.host}:${sftpConfig.port}`
            },
            {
              key: 'local',
              label: '本地内容',
              status: 'passed',
              message: `${summary.files} 个文件，${formatSize(summary.bytes)}`
            },
            {
              key: 'ignore',
              label: '忽略规则',
              status: 'passed',
              message: `已忽略 ${summary.ignored} 项`
            },
            {
              key: 'remote',
              label: '远程目录',
              status: remoteExists ? 'passed' : 'warning',
              message: remoteExists ? remoteDir : `${remoteDir} 将自动创建`
            }
          ],
          summary,
          remoteDir
        }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.SFTP_PROFILES_GET, async () => ({
    success: true,
    data: listReleaseProfiles()
  }))
  ipcMain.handle(IPC_CHANNELS.SFTP_PROFILE_SAVE, async (_event, profile = {}) => {
    try {
      assertNoZipDeploymentInProgress()
      const config = sanitizeSftpConfig(profile)
      if (!isSftpConfigComplete(config)) {
        return { success: false, error: '请填写服务器地址和用户名' }
      }
      // 所有可能失败的路径检查都在 saveReleaseProfile 之前完成，保证保存原子性。
      const paths = validateSftpPaths(profile)
      const saved = saveReleaseProfile({ ...profile, ...paths })
      await closeSftpConnection()
      sftpConfig = null
      sftpConfigSource = null
      return { success: true, data: saved }
    } catch (err) {
      const error =
        err?.code === 'ENOENT'
          ? `本地目录不存在: ${String(profile?.localDir || '').trim()}`
          : err.message
      return { success: false, error }
    }
  })
  ipcMain.handle(IPC_CHANNELS.SFTP_PROFILE_ACTIVATE, async (_event, profileId) => {
    try {
      assertNoZipDeploymentInProgress()
      const profile = activateReleaseProfile(String(profileId || ''))
      await closeSftpConnection()
      sftpConfig = null
      sftpConfigSource = null
      return { success: true, data: profile }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
  ipcMain.handle(IPC_CHANNELS.SFTP_PROFILE_DELETE, async (_event, profileId) => {
    try {
      assertNoZipDeploymentInProgress()
      const data = deleteReleaseProfile(String(profileId || ''))
      await closeSftpConnection()
      sftpConfig = null
      sftpConfigSource = null
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
  ipcMain.handle(IPC_CHANNELS.SFTP_HISTORY_GET, async () => {
    const activeProfile = getActiveReleaseProfile()
    return {
      success: true,
      data: activeProfile ? loadReleaseHistory({ profileId: activeProfile.id }) : []
    }
  })
  ipcMain.handle(IPC_CHANNELS.SFTP_ROLLBACK, async (_event, releaseId) => {
    const startedAt = Date.now()
    let activeProfile = null
    let target = null
    let remoteDir = ''
    let roots = []
    let rollbackBackup = ''

    try {
      activeProfile = getActiveReleaseProfile()
      if (!activeProfile) throw new Error('请先选择发布环境')
      const history = loadReleaseHistory({ profileId: activeProfile.id })
      target = history.find((item) => item.id === releaseId)
      if (!target || target.status !== 'success' || !target.backupPath)
        throw new Error('当前发布环境中没有可回滚的记录')
      remoteDir = normalizeRemotePath(target.remoteDir, { allowRoot: false })
      roots = target.archiveRoots.map(assertSafeArchiveName)
      rollbackBackup = `${target.backupPath}-rollback-${formatTimestamp()}`
      const command = buildRemoteRollbackCommand({
        remoteDir,
        backupPath: target.backupPath,
        rollbackBackup,
        archiveRoots: roots
      })
      await execRemoteCommand(command)
    } catch (err) {
      // 远端回滚未完成时也必须留下当前环境的审计记录，方便定位目标版本和失败原因。
      // 历史记录本身写入失败不能覆盖原始回滚错误。
      if (activeProfile && target) {
        try {
          appendReleaseHistory(
            buildRollbackFailureHistoryRecord({
              activeProfile,
              target,
              releaseId,
              error: err,
              remoteDir,
              archiveRoots: roots,
              rollbackBackup,
              startedAt
            })
          )
        } catch (historyError) {
          console.error('记录回滚失败历史失败:', historyError)
        }
      }
      recordReleaseEvent({
        sourceKey: `release-rollback:${releaseId}:${startedAt}`,
        level: 'critical',
        status: 'open',
        title: `回滚失败：${target?.label || releaseId}`,
        description: String(err?.message || '未知回滚错误').slice(0, 1000),
        relatedId: releaseId
      })
      return { success: false, error: err.message }
    }

    try {
      markReleaseRolledBack(target.id)
      appendReleaseHistory({
        profileId: activeProfile.id,
        profileName: activeProfile.name,
        action: 'rollback',
        status: 'success',
        label: `回滚：${target.label}`,
        remoteDir,
        archiveRoots: roots,
        backupPath: rollbackBackup,
        sourceReleaseId: target.id,
        message: '回滚成功',
        startedAt,
        finishedAt: Date.now()
      })
    } catch (historyError) {
      // 远端已经成功回滚，不能因为本地审计失败而把实际成功结果误报为失败。
      console.error('更新回滚发布历史失败:', historyError)
      recordReleaseEvent({
        sourceKey: `release-rollback:${releaseId}:${startedAt}`,
        level: 'warning',
        status: 'resolved',
        title: `回滚成功但本地审计失败：${target.label}`,
        description: '远端已回滚到发布前版本；本地发布历史更新失败，请核查历史记录。',
        relatedId: releaseId
      })
      return {
        success: true,
        message: '已回滚到发布前版本，但本地发布历史更新失败，请核查历史记录',
        warning: historyError.message
      }
    }

    recordReleaseEvent({
      sourceKey: `release-rollback:${releaseId}:${startedAt}`,
      level: 'info',
      status: 'resolved',
      title: `回滚成功：${target.label}`,
      description: '已回滚到发布前版本',
      relatedId: releaseId
    })
    return { success: true, message: '已回滚到发布前版本' }
  })

  /**
   * 在服务器上创建目录
   */
  ipcMain.handle(IPC_CHANNELS.SFTP_MKDIR, async (_event, remotePath) => {
    try {
      const safeRemotePath = normalizeRemotePath(remotePath, { allowRoot: false })

      const sftp = await getSftpClient()
      await sftp.mkdir(safeRemotePath, true) // recursive mkdir

      return { success: true, message: `已创建: ${safeRemotePath}` }
    } catch (err) {
      console.error('SFTP 创建目录失败:', err)
      return { success: false, error: err.message }
    }
  })
}

/**
 * 关闭 SFTP 连接
 */
async function closeSftpConnection() {
  if (sftpClient) {
    try {
      await sftpClient.end()
    } catch {}
    sftpClient = null
  }
}

module.exports = {
  registerSftpHandlers,
  closeSftpConnection,
  __testables: {
    getArchiveRootNames,
    buildRemoteDeployCommand,
    buildRemoteRollbackCommand,
    createSerialQueue,
    assertDeploymentProfile,
    normalizeRemoteDir,
    sanitizeSftpPaths,
    validateSftpPaths,
    createHostFingerprintError,
    createSftpConnectionConfig,
    createZipArchive,
    buildRollbackFailureHistoryRecord
  }
}
