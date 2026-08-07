const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const packageJson = require(path.join(root, 'package.json'))
const productName = packageJson.build?.productName || packageJson.productName || packageJson.name
const installerTimeoutMs = 120_000
const uninstallTimeoutMs = 60_000
const allowInstallArgument = '--allow-install'
const {
  createCcSwitchFixture,
  createModelAvailabilityFixture,
  modelTestReply,
  requestedArchitecture,
  runPackagedExecutableSmoke
} = require('./windows-packaged-app-smoke.cjs')

function shouldAllowInstallerSmoke(argv = process.argv) {
  return argv.includes(allowInstallArgument)
}

function renderWindowsArtifactName(architecture, extension = 'exe') {
  const template =
    packageJson.build?.win?.artifactName || '${productName}-${version}-windows-${arch}.${ext}'
  return template
    .replaceAll('${productName}', productName)
    .replaceAll('${version}', packageJson.version)
    .replaceAll('${arch}', architecture)
    .replaceAll('${ext}', extension)
}

function packagedInstallerPath(architecture) {
  return path.join(releaseDir, renderWindowsArtifactName(architecture, 'exe'))
}

function installedAppDirectory(env = process.env) {
  const localAppData = String(env.LOCALAPPDATA || '').trim()
  if (!localAppData) throw new Error('LOCALAPPDATA is unavailable')
  return path.win32.join(localAppData, 'Programs', productName)
}

function installedExecutablePath(env = process.env) {
  return path.win32.join(installedAppDirectory(env), `${productName}.exe`)
}

function installedUninstallerPath(env = process.env) {
  return path.win32.join(installedAppDirectory(env), `Uninstall ${productName}.exe`)
}

function installedExecutablePathAt(installationDirectory) {
  return path.win32.join(installationDirectory, `${productName}.exe`)
}

function installedUninstallerPathAt(installationDirectory) {
  return path.win32.join(installationDirectory, `Uninstall ${productName}.exe`)
}

function installerArguments(installationDirectory) {
  if (!path.win32.isAbsolute(installationDirectory)) {
    throw new Error(`Windows installation directory must be absolute: ${installationDirectory}`)
  }
  // NSIS requires /D to be its final argument. It isolates smoke tests from prior user installs.
  return ['/S', `/D=${installationDirectory}`]
}

async function runProcess(
  executablePath,
  args,
  { label, timeoutMs, env = process.env, windowsVerbatimArguments = false } = {}
) {
  let output = ''
  let timedOut = false
  const child = spawn(executablePath, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments
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

  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`, { cause: result.error })
  }
  if (timedOut) throw new Error(`${label} timed out after ${timeoutMs}ms`)
  if (result.code !== 0) {
    const detail = output.trim() ? `\n${output.trim()}` : ''
    throw new Error(
      `${label} failed (code=${result.code}, signal=${result.signal || 'none'})${detail}`
    )
  }
  return output
}

async function waitForRemoval(targetPath, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (fs.existsSync(targetPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return !fs.existsSync(targetPath)
}

async function uninstallInstalledApp({
  env = process.env,
  executablePath = installedExecutablePath(env),
  uninstallerPath = installedUninstallerPath(env)
} = {}) {
  if (!fs.existsSync(uninstallerPath)) return false

  await runProcess(uninstallerPath, ['/S'], {
    label: 'Windows uninstaller',
    timeoutMs: uninstallTimeoutMs,
    env
  })
  if (!(await waitForRemoval(executablePath))) {
    throw new Error(`Installed executable still exists after uninstall: ${executablePath}`)
  }
  return true
}

async function run() {
  if (process.platform !== 'win32') {
    throw new Error('Windows installer smoke test must run on Windows')
  }
  if (!shouldAllowInstallerSmoke()) {
    throw new Error(`Windows installer smoke test requires ${allowInstallArgument}`)
  }

  const architecture = requestedArchitecture()
  const installerPath = packagedInstallerPath(architecture)
  if (!fs.existsSync(installerPath)) {
    throw new Error(`Packaged Windows installer was not found: ${installerPath}`)
  }

  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-desktop-installer-smoke-'))
  const installationDirectory = path.join(smokeRoot, 'installed-app')
  const executablePath = installedExecutablePathAt(installationDirectory)
  const uninstallerPath = installedUninstallerPathAt(installationDirectory)
  let fixture = null
  let modelFixture = null
  let installStarted = false
  try {
    console.log(`Installing packaged app silently: ${installerPath}`)
    installStarted = true
    await runProcess(installerPath, installerArguments(installationDirectory), {
      label: 'Windows installer',
      timeoutMs: installerTimeoutMs,
      // NSIS consumes the unquoted final /D path (including spaces) as its install directory.
      windowsVerbatimArguments: true
    })
    if (!fs.existsSync(executablePath)) {
      throw new Error(`Installed Windows executable was not found: ${executablePath}`)
    }
    if (!fs.existsSync(uninstallerPath)) {
      throw new Error(`Installed Windows uninstaller was not found: ${uninstallerPath}`)
    }

    modelFixture = await createModelAvailabilityFixture()
    fixture = await createCcSwitchFixture(path.join(smokeRoot, 'windows-profile'), {
      baseUrl: modelFixture.baseUrl,
      endpoint: modelFixture.baseUrl,
      modelTest: { reply: modelTestReply }
    })
    await runPackagedExecutableSmoke({
      executablePath,
      smokeRoot: path.join(smokeRoot, 'app-run'),
      fixture
    })
    if (modelFixture.requests.length < 2) {
      throw new Error(
        'Installed app did not complete both model test and monitoring requests to the local fixture'
      )
    }

    fixture.close()
    fixture = null
    await modelFixture.close()
    modelFixture = null
    await uninstallInstalledApp({ executablePath, uninstallerPath })
    installStarted = false
    console.log(
      'Windows installer, installed app CC Switch/model smoke test, and uninstaller all succeeded'
    )
  } finally {
    try {
      fixture?.close()
    } catch (error) {
      console.warn(`Failed to close CC Switch fixture: ${error.message}`)
    }
    try {
      await modelFixture?.close()
    } catch (error) {
      console.warn(`Failed to close model availability fixture: ${error.message}`)
    }
    if (installStarted && fs.existsSync(uninstallerPath)) {
      try {
        await uninstallInstalledApp({ executablePath, uninstallerPath })
      } catch (error) {
        console.warn(`Failed to clean up smoke-test installation: ${error.message}`)
      }
    }
    try {
      fs.rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch (error) {
      console.warn(`Failed to remove installer smoke-test data directory: ${error.message}`)
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = {
  installedAppDirectory,
  installedExecutablePath,
  installedExecutablePathAt,
  installedUninstallerPath,
  installedUninstallerPathAt,
  installerArguments,
  packagedInstallerPath,
  renderWindowsArtifactName,
  run,
  shouldAllowInstallerSmoke,
  uninstallInstalledApp,
  waitForRemoval
}
