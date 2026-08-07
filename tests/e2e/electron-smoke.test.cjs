const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { after, before, test } = require('node:test')
const { _electron: electron } = require('playwright')

const projectRoot = path.resolve(__dirname, '../..')
const viteBin = path.join(path.dirname(require.resolve('vite')), 'bin/vite.js')
const electronExecutable = require('electron')
const mainEntry = path.join(projectRoot, 'src/main/main.js')
const port = 4173

let viteProcess
let electronApp
let testUserDataPath
let rendererPage
const rendererDiagnostics = []

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      response.resume()
      resolve(response.statusCode || 0)
    })
    req.setTimeout(1000, () => req.destroy(new Error(`Timed out requesting ${url}`)))
    req.on('error', reject)
  })
}

async function waitForVite(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const status = await request(url)
      if (status >= 200 && status < 500) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Vite dev server did not become ready: ${lastError?.message || url}`)
}

async function stopProcess(process) {
  if (!process || process.exitCode !== null) return
  process.kill('SIGTERM')
  await Promise.race([once(process, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))])
  if (process.exitCode === null) process.kill('SIGKILL')
}

function recordRendererDiagnostic(message) {
  rendererDiagnostics.push(message)
  if (rendererDiagnostics.length > 40) rendererDiagnostics.shift()
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
  viteProcess = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: projectRoot,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  await waitForVite(`http://127.0.0.1:${port}/`)

  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry, `--user-data-dir=${testUserDataPath}`],
    env: {
      ...process.env,
      OPEN_DEVTOOLS: 'false',
      OPS_DESKTOP_E2E: 'true',
      VITE_DEV_SERVER_URL: `http://127.0.0.1:${port}`
    }
  })
  rendererPage = await electronApp.firstWindow()
  rendererPage.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      recordRendererDiagnostic(`[console:${message.type()}] ${message.text()}`)
    }
  })
  rendererPage.on('pageerror', (error) => {
    recordRendererDiagnostic(`[pageerror] ${error.message}`)
  })
})

after(async () => {
  await electronApp?.close()
  await stopProcess(viteProcess)
  if (testUserDataPath) {
    await fs.rm(testUserDataPath, { recursive: true, force: true })
  }
})

test('starts the desktop shell and renders the operations dashboard', async () => {
  const page = rendererPage || (await electronApp.firstWindow())
  await waitForAppShell(page)
  await assert.doesNotReject(() => page.waitForSelector('.page-title'))

  assert.equal(await page.title(), '运维仪表盘 - Ops Desktop')
  assert.equal(await page.locator('.page-title').textContent(), '运维仪表盘')
  assert.equal(await page.locator('[aria-label="系统发布"]').count(), 1)
})

test('navigates through the sidebar without a renderer error', async () => {
  const page = await electronApp.firstWindow()

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
