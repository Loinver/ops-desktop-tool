const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const timeoutMs = 45_000

function findAppBundle(directory, depth = 0) {
  if (depth > 4 || !fs.existsSync(directory)) return ''
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const fullPath = path.join(directory, entry.name)
    if (entry.name.endsWith('.app')) return fullPath
    const nested = findAppBundle(fullPath, depth + 1)
    if (nested) return nested
  }
  return ''
}

if (process.platform !== 'darwin') {
  console.error('macOS packaged app smoke test must run on macOS')
  process.exit(1)
}

const appPath = findAppBundle(releaseDir)
if (!appPath) {
  console.error(`Packaged macOS app was not found under ${releaseDir}`)
  process.exit(1)
}

const executableName = path.basename(appPath, '.app')
const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName)
if (!fs.existsSync(executablePath)) {
  console.error(`Packaged macOS executable was not found: ${executablePath}`)
  process.exit(1)
}

const smokeUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-desktop-smoke-'))
console.log(`Launching packaged app smoke test: ${appPath}`)
const child = spawn(executablePath, ['--smoke-test', `--user-data-dir=${smokeUserDataPath}`], {
  cwd: root,
  env: {
    ...process.env,
    OPS_DESKTOP_SMOKE_TEST: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.on('data', (chunk) => {
  output += chunk.toString()
})
child.stderr.on('data', (chunk) => {
  output += chunk.toString()
})

const timer = setTimeout(() => {
  child.kill('SIGKILL')
  console.error(`Packaged app did not finish its smoke test within ${timeoutMs}ms`)
  if (output.trim()) console.error(output.trim())
  process.exit(1)
}, timeoutMs)

timer.unref()
child.once('error', (error) => {
  clearTimeout(timer)
  console.error(`Failed to launch packaged app: ${error.message}`)
  process.exit(1)
})
child.once('exit', (code, signal) => {
  clearTimeout(timer)
  fs.rmSync(smokeUserDataPath, { recursive: true, force: true })
  if (code !== 0) {
    console.error(`Packaged app smoke test failed (code=${code}, signal=${signal || 'none'})`)
    if (output.trim()) console.error(output.trim())
    process.exit(1)
  }
  console.log('Packaged app loaded its renderer and exited successfully')
})
