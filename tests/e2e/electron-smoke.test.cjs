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
  await Promise.race([
    once(process, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ])
  if (process.exitCode === null) process.kill('SIGKILL')
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
})

after(async () => {
  await electronApp?.close()
  await stopProcess(viteProcess)
  if (testUserDataPath) {
    await fs.rm(testUserDataPath, { recursive: true, force: true })
  }
})

test('starts the desktop shell and renders the operations dashboard', async () => {
  const page = await electronApp.firstWindow()
  await page.waitForSelector('.app-layout')
  await assert.doesNotReject(() => page.waitForSelector('.page-title'))

  assert.equal(await page.title(), '运维仪表盘 - Ops Desktop')
  assert.equal(await page.locator('.page-title').textContent(), '运维仪表盘')
  assert.equal(await page.locator('[aria-label="系统发布"]').count(), 1)
})

test('navigates through the sidebar without a renderer error', async () => {
  const page = await electronApp.firstWindow()

  await page.locator('[aria-label="系统发布"]').click()
  await page.waitForURL(/#\/system-release$/)
  await page.waitForFunction(() => document.querySelector('.page-title')?.textContent === '系统发布')

  // 临时 userData 没有 SFTP 配置时，发布页会在连接检查完成后主动引导配置。
  const settingsDialog = page.locator('.sftp-settings-dialog')
  await settingsDialog.waitFor({ state: 'visible' })
  await settingsDialog.getByRole('button', { name: '取消' }).click()
  await settingsDialog.waitFor({ state: 'hidden' })

  await page.locator('[aria-label="本地数据管理"]').click()
  await page.waitForURL(/#\/data-management$/)
  await page.waitForFunction(() => document.querySelector('.page-title')?.textContent === '本地数据管理')
})
