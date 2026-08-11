const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { after, before, test } = require('node:test')
const { _electron: electron } = require('playwright')

const projectRoot = path.resolve(__dirname, '../..')
const rendererDistPath = path.join(projectRoot, 'dist', 'renderer')
const viteBin = path.join(path.dirname(require.resolve('vite')), 'bin/vite.js')
const electronExecutable = require('electron')
const mainEntry = path.join(projectRoot, 'src/main/main.js')
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
})

let electronApp
let rendererServer
let rendererServerUrl
let testUserDataPath
let rendererPage
const rendererDiagnostics = []
const instrumentedPages = new WeakSet()

function appendOutput(output, chunk, limit = 20_000) {
  return `${output}${chunk}`.slice(-limit)
}

function buildRenderer() {
  return new Promise((resolve, reject) => {
    const viteProcess = spawn(process.execPath, [viteBin, 'build'], {
      cwd: projectRoot,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    viteProcess.stdout.on('data', (chunk) => {
      output = appendOutput(output, chunk)
    })
    viteProcess.stderr.on('data', (chunk) => {
      output = appendOutput(output, chunk)
    })
    viteProcess.once('error', reject)
    viteProcess.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `Vite production build for Electron E2E failed (code: ${code}, signal: ${signal || 'none'}).\n${output}`
        )
      )
    })
  })
}

function resolveRendererAsset(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl || '/', 'http://127.0.0.1').pathname)
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const assetPath = path.resolve(rendererDistPath, relativePath)
  const relation = path.relative(rendererDistPath, assetPath)
  if (relation.startsWith('..') || path.isAbsolute(relation)) return null
  return assetPath
}

async function startRendererServer() {
  const server = http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }

    let assetPath
    try {
      assetPath = resolveRendererAsset(request.url)
    } catch {
      response.writeHead(400).end()
      return
    }
    if (!assetPath) {
      response.writeHead(403).end()
      return
    }

    try {
      const data = await fs.readFile(assetPath)
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': MIME_TYPES[path.extname(assetPath)] || 'application/octet-stream'
      })
      response.end(request.method === 'HEAD' ? undefined : data)
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
        response.writeHead(404).end()
        return
      }
      response.writeHead(500).end()
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve))
    throw new Error('Electron E2E renderer server did not receive a TCP port')
  }

  rendererServer = server
  rendererServerUrl = `http://127.0.0.1:${address.port}`
}

async function stopRendererServer() {
  if (!rendererServer) return
  await new Promise((resolve) => rendererServer.close(resolve))
  rendererServer = null
}

function recordRendererDiagnostic(message) {
  rendererDiagnostics.push(message)
  if (rendererDiagnostics.length > 40) rendererDiagnostics.shift()
}

function attachRendererDiagnostics(page) {
  if (instrumentedPages.has(page)) return
  instrumentedPages.add(page)
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      recordRendererDiagnostic(`[console:${message.type()}] ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    recordRendererDiagnostic(`[pageerror] ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    recordRendererDiagnostic(
      `[requestfailed] ${request.url()} (${request.failure()?.errorText || 'unknown error'})`
    )
  })
}

function attachElectronProcessDiagnostics(app) {
  const electronProcess = app.process()
  for (const [streamName, stream] of [
    ['stdout', electronProcess.stdout],
    ['stderr', electronProcess.stderr]
  ]) {
    stream?.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) recordRendererDiagnostic(`[electron:${streamName}] ${text.slice(0, 1500)}`)
    })
  }
}

function assertNoFatalRendererDiagnostics(diagnosticsStart, context) {
  const failures = rendererDiagnostics
    .slice(diagnosticsStart)
    .filter((message) => message.startsWith('[pageerror]') || message.startsWith('[requestfailed]'))
  assert.deepEqual(failures, [], `${context} emitted renderer failures:\n${failures.join('\n')}`)
}

async function waitForAppShell(page) {
  try {
    await page.locator('.app-layout').waitFor({ state: 'visible', timeout: 45_000 })
  } catch (error) {
    let documentState = 'Unable to inspect renderer document'
    try {
      documentState = JSON.stringify(
        await page.evaluate(() => ({
          url: window.location.href,
          readyState: document.readyState,
          appErrorFallback: Boolean(document.querySelector('.app-error-fallback')),
          appText: document.querySelector('#app')?.textContent?.trim().slice(0, 1000) || ''
        }))
      )
    } catch (inspectError) {
      documentState = `Unable to inspect renderer document: ${inspectError.message}`
    }

    throw new Error(
      `Desktop shell did not render. Renderer state: ${documentState}\n` +
        `Renderer diagnostics:\n${rendererDiagnostics.join('\n') || '(none captured)'}`,
      { cause: error }
    )
  }
}

before(async () => {
  testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-desktop-e2e-'))

  // A fresh CI checkout has no Vite optimize-deps cache. Serving the dev server
  // as soon as its index responds can leave Electron waiting on a cold module
  // graph, with #app still empty. Build once and serve prebuilt renderer assets
  // instead, so this smoke test measures the desktop shell rather than Vite warmup.
  await buildRenderer()
  await startRendererServer()

  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry, `--user-data-dir=${testUserDataPath}`],
    env: {
      ...process.env,
      OPEN_DEVTOOLS: 'false',
      OPS_DESKTOP_E2E: 'true',
      VITE_DEV_SERVER_URL: rendererServerUrl
    }
  })
  attachElectronProcessDiagnostics(electronApp)
  electronApp.on('window', attachRendererDiagnostics)
  rendererPage = await electronApp.firstWindow()
  attachRendererDiagnostics(rendererPage)
})

after(async () => {
  let cleanupError
  try {
    await electronApp?.close()
  } catch (error) {
    cleanupError = error
  }

  try {
    await stopRendererServer()
  } catch (error) {
    cleanupError ||= error
  }

  try {
    if (testUserDataPath) {
      await fs.rm(testUserDataPath, { recursive: true, force: true })
    }
  } catch (error) {
    cleanupError ||= error
  }

  if (cleanupError) throw cleanupError
})

test('starts the desktop shell and renders the operations dashboard', async () => {
  const page = rendererPage || (await electronApp.firstWindow())
  const diagnosticsStart = rendererDiagnostics.length
  await waitForAppShell(page)
  await assert.doesNotReject(() => page.waitForSelector('.page-title'))

  assert.equal(await page.title(), '运维仪表盘 - Ops Desktop')
  assert.equal(await page.locator('.page-title').textContent(), '运维仪表盘')
  assert.equal(await page.locator('[aria-label="系统发布"]').count(), 1)
  assertNoFatalRendererDiagnostics(diagnosticsStart, 'Desktop shell startup')
})

test('navigates through the sidebar without a renderer error', async () => {
  const page = await electronApp.firstWindow()
  const diagnosticsStart = rendererDiagnostics.length

  await page.locator('[aria-label="系统发布"]').click()
  await page.waitForURL(/#\/system-release$/)
  await page.waitForFunction(
    () => document.querySelector('.page-title')?.textContent === '系统发布'
  )

  // 临时 userData 没有 SFTP 配置时，发布页保留在首次配置引导，不主动打断用户。
  const onboarding = page.locator('.release-onboarding')
  await onboarding.waitFor({ state: 'visible' })
  assert.equal(await onboarding.getByRole('heading').textContent(), '尚未配置发布环境')
  assert.equal(await page.locator('.sftp-settings-dialog').count(), 0)

  await page.locator('[aria-label="本地数据管理"]').click()
  await page.waitForURL(/#\/data-management$/)
  await page.waitForFunction(
    () => document.querySelector('.page-title')?.textContent === '本地数据管理'
  )
  assertNoFatalRendererDiagnostics(diagnosticsStart, 'Sidebar navigation')
})

test('AI 对话、图像生成与备份恢复关键页面可在真实 Electron 中加载', async () => {
  const page = await electronApp.firstWindow()
  const diagnosticsStart = rendererDiagnostics.length
  const routes = [
    { hash: '#/ai-chat', title: 'AI 对话', marker: '.ai-chat-page' },
    { hash: '#/gpt-image', title: '图像生成', marker: '.gpt-image-page' },
    { hash: '#/data-management', title: '本地数据管理', marker: '.data-management-page' }
  ]

  for (const route of routes) {
    await page.evaluate((hash) => {
      window.location.hash = hash
    }, route.hash)
    await page.waitForURL(new RegExp(`${route.hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await page.waitForFunction(
      (title) => document.querySelector('.page-title')?.textContent?.trim() === title,
      route.title
    )
    await page.locator(route.marker).waitFor({ state: 'visible' })
  }

  assertNoFatalRendererDiagnostics(diagnosticsStart, 'AI and backup critical routes')
})

test('通知设置保持紧凑按钮和 checkbox 垂直对齐', async () => {
  const page = await electronApp.firstWindow()
  await page.locator('.notification-trigger').click()
  await page.locator('.notification-header-actions [title="通知设置"]').click()

  const settings = page.locator('.notification-settings')
  await settings.waitFor({ state: 'visible' })
  if (process.platform === 'darwin') {
    await settings.locator('.desktop-integration-settings').waitFor({ state: 'attached' })
  }

  const metrics = await settings.evaluate((container) => {
    const row = container.querySelector('.notification-setting-row')
    const checkbox = row?.querySelector('input[type="checkbox"]')
    const actionButton = container.querySelector('.notification-settings-actions button')
    const systemButton = container.querySelector('.desktop-integration-summary button')
    const rowBox = row?.getBoundingClientRect()
    const checkboxBox = checkbox?.getBoundingClientRect()
    return {
      centerOffset:
        rowBox && checkboxBox
          ? Math.abs(checkboxBox.y + checkboxBox.height / 2 - (rowBox.y + rowBox.height / 2))
          : Number.POSITIVE_INFINITY,
      actionButtonHeight: actionButton?.offsetHeight || 0,
      hasDockBadge: container.textContent.includes('Dock 未读角标'),
      hasNotificationPermission: container.textContent.includes('系统通知权限'),
      loginCheckboxDisabled:
        container.querySelector('.desktop-integration-settings input[type="checkbox"]')?.disabled ??
        false,
      systemButtonHeight: systemButton?.offsetHeight || 0
    }
  })

  assert.ok(metrics.centerOffset <= 1, 'checkbox 应与右侧设置文字保持垂直居中')
  assert.ok(metrics.actionButtonHeight > 0 && metrics.actionButtonHeight <= 34)
  if (process.platform === 'darwin') {
    assert.equal(metrics.hasDockBadge, true)
    assert.equal(metrics.hasNotificationPermission, true)
    assert.equal(metrics.loginCheckboxDisabled, true)
    assert.ok(metrics.systemButtonHeight > 0 && metrics.systemButtonHeight <= 32)
  }
})

test('外观菜单支持跟随系统并保持顶部控件紧凑', async () => {
  const page = await electronApp.firstWindow()
  const trigger = page.locator('.theme-toggle')
  await trigger.click()

  const popover = page.locator('.theme-popover')
  await popover.waitFor({ state: 'visible' })
  const metrics = await popover.evaluate((container) => {
    const trigger = document.querySelector('.theme-toggle')
    const options = [...container.querySelectorAll('.theme-option')]
    return {
      triggerHeight: trigger?.offsetHeight || 0,
      optionHeights: options.map((option) => option.offsetHeight),
      labels: options.map((option) => option.textContent.trim())
    }
  })

  assert.ok(metrics.triggerHeight > 0 && metrics.triggerHeight <= 36)
  assert.ok(metrics.optionHeights.every((height) => height > 0 && height <= 34))
  assert.deepEqual(metrics.labels, ['跟随系统', '浅色', '深色'])

  await popover.getByText('跟随系统', { exact: true }).click()
  const mode = await page.evaluate(() => ({
    attribute: document.documentElement.dataset.themeMode,
    stored: window.localStorage.getItem('ops-desktop.theme')
  }))
  assert.deepEqual(mode, { attribute: 'system', stored: 'system' })
})

test('模型来源提示图标居中且模型可靠性入口保持轻量', async () => {
  const page = await electronApp.firstWindow()
  await page.evaluate(() => {
    window.location.hash = '#/ai-models'
  })
  await page.waitForURL(/#\/ai-models$/)

  const notice = page.locator('.source-notice')
  const sourceLink = page.locator('.source-reliability-link')
  await notice.waitFor({ state: 'visible' })

  const metrics = await notice.evaluate((container) => {
    const icon = container.querySelector('.t-icon')
    const iconBox = icon?.getBoundingClientRect()
    const noticeBox = container.getBoundingClientRect()
    return {
      centerOffset:
        iconBox && noticeBox
          ? Math.abs(iconBox.y + iconBox.height / 2 - (noticeBox.y + noticeBox.height / 2))
          : Number.POSITIVE_INFINITY,
      iconHeight: iconBox?.height || 0,
      iconWidth: iconBox?.width || 0
    }
  })

  assert.ok(metrics.iconWidth >= 18)
  assert.ok(metrics.iconHeight >= 18)
  assert.ok(metrics.centerOffset <= 1, '来源提示图标应在提示区域中垂直居中')
  assert.equal((await sourceLink.textContent()).trim(), '前往配置')
  assert.equal(await sourceLink.getAttribute('title'), '前往模型可靠性')
  assert.equal(await sourceLink.getAttribute('aria-label'), '前往模型可靠性')
  assert.equal(
    await sourceLink.evaluate((button) => button.classList.contains('btn-secondary')),
    false
  )
  assert.ok((await sourceLink.evaluate((button) => button.offsetHeight)) <= 32)

  await sourceLink.click()
  await page.waitForURL(/#\/model-test$/)
})

test(
  'macOS 原生外观菜单可切换系统、浅色和深色模式',
  { skip: process.platform !== 'darwin' },
  async () => {
    const page = await electronApp.firstWindow()

    async function clickAppearance(label) {
      const clicked = await electronApp.evaluate(({ Menu }, itemLabel) => {
        const applicationMenu = Menu.getApplicationMenu()
        const displayMenu = applicationMenu?.items.find((item) => item.label === '显示')
        const appearanceMenu = displayMenu?.submenu?.items.find((item) => item.label === '外观')
        const item = appearanceMenu?.submenu?.items.find((entry) => entry.label === itemLabel)
        item?.click()
        return Boolean(item)
      }, label)
      assert.equal(clicked, true)
    }

    async function checkedAppearanceItems() {
      return electronApp.evaluate(({ Menu }) => {
        const applicationMenu = Menu.getApplicationMenu()
        const displayMenu = applicationMenu?.items.find((item) => item.label === '显示')
        const appearanceMenu = displayMenu?.submenu?.items.find((item) => item.label === '外观')
        return (appearanceMenu?.submenu?.items || [])
          .filter((item) => item.checked)
          .map((item) => item.label)
      })
    }

    async function waitForCheckedAppearance(label, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs
      let checked = []
      while (Date.now() < deadline) {
        checked = await checkedAppearanceItems()
        if (checked.length === 1 && checked[0] === label) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.deepEqual(checked, [label])
    }

    await clickAppearance('深色')
    await page.waitForFunction(() => document.documentElement.dataset.themeMode === 'dark')
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
    await waitForCheckedAppearance('深色')

    await page.locator('.theme-toggle').click()
    await page.locator('.theme-popover').getByText('浅色', { exact: true }).click()
    await page.waitForFunction(() => document.documentElement.dataset.themeMode === 'light')
    await waitForCheckedAppearance('浅色')

    await clickAppearance('跟随系统')
    await page.waitForFunction(() => document.documentElement.dataset.themeMode === 'system')
    await waitForCheckedAppearance('跟随系统')
  }
)
