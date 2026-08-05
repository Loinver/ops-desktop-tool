const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const packageJson = require(path.join(root, 'package.json'))
const productName = packageJson.build?.productName || packageJson.productName || packageJson.name
const timeoutMs = 45_000

function requestedArchitecture() {
  const argument = process.argv.find((value) => value.startsWith('--arch='))
  return argument ? argument.slice('--arch='.length).toLowerCase() : 'x64'
}

function unpackedDirectoryName(architecture) {
  if (!architecture || architecture === 'x64') return 'win-unpacked'
  return `win-${architecture}-unpacked`
}

function packagedExecutablePath(architecture) {
  return path.join(releaseDir, unpackedDirectoryName(architecture), `${productName}.exe`)
}

async function run() {
  if (process.platform !== 'win32') {
    throw new Error('Windows packaged app smoke test must run on Windows')
  }

  const architecture = requestedArchitecture()
  const executablePath = packagedExecutablePath(architecture)
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged Windows executable was not found: ${executablePath}`)
  }

  const smokeUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-desktop-smoke-'))
  let output = ''
  let timedOut = false

  try {
    console.log(`Launching packaged app smoke test: ${executablePath}`)
    const child = spawn(executablePath, ['--smoke-test', `--user-data-dir=${smokeUserDataPath}`], {
      cwd: root,
      env: {
        ...process.env,
        OPS_DESKTOP_SMOKE_TEST: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false
    })

    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })

    const result = await new Promise((resolve) => {
      let settled = false
      let timer = null
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, timeoutMs)

      child.once('error', (error) => finish({ error }))
      child.once('exit', (code, signal) => finish({ code, signal }))
    })

    if (result.error) throw new Error(`Failed to launch packaged app: ${result.error.message}`)
    if (timedOut) {
      throw new Error(`Packaged app did not finish its smoke test within ${timeoutMs}ms`)
    }
    if (result.code !== 0) {
      throw new Error(
        `Packaged app smoke test failed (code=${result.code}, signal=${result.signal || 'none'})`
      )
    }

    console.log('Packaged app loaded its renderer and exited successfully')
  } catch (error) {
    if (output.trim()) console.error(output.trim())
    throw error
  } finally {
    try {
      fs.rmSync(smokeUserDataPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      })
    } catch (error) {
      console.warn(`Failed to remove smoke-test data directory: ${error.message}`)
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { packagedExecutablePath, requestedArchitecture, run, unpackedDirectoryName }
