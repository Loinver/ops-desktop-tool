const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const packageJson = require(path.join(root, 'package.json'))
const productName = packageJson.build?.productName || packageJson.productName || packageJson.name
const installerTimeoutMs = 300_000
const uninstallTimeoutMs = 120_000
const installationReadyTimeoutMs = 180_000
const removalTimeoutMs = 60_000
const registrationRemovalTimeoutMs = 120_000
const processTerminationTimeoutMs = 10_000
const allowInstallArgument = '--allow-install'
const registryRoots = ['HKCU', 'HKLM']
const registryViews = ['64', '32']
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
  // NSIS requires /D to be its final, unquoted argument. Use an isolated directory owned by this run.
  return ['/S', `/D=${installationDirectory}`]
}

function windowsInstallerGuid() {
  const guid = String(packageJson.build?.nsis?.guid || '').trim()
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(guid)) {
    throw new Error('build.nsis.guid must be an explicit Windows installer GUID')
  }
  return guid
}

function windowsInstallerRegistryKeys() {
  const guid = windowsInstallerGuid()
  const keyPaths = [
    `Software\\${guid}`,
    `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`
  ]
  return registryRoots.flatMap((rootKey) =>
    keyPaths.flatMap((keyPath) =>
      registryViews.map((view) => ({ key: `${rootKey}\\${keyPath}`, rootKey, view }))
    )
  )
}

function parseRegistryValue(output, valueName) {
  const escapedName = String(valueName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(output || '').match(
    new RegExp(`^\\s*${escapedName}\\s+REG_[A-Z0-9_]+\\s+(.+?)\\s*$`, 'im')
  )
  return match ? match[1].trim() : ''
}

function queryWindowsRegistryKey({ key, view }, { spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl('reg.exe', ['query', key, `/reg:${view}`], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.error) {
    throw new Error(
      `Failed to query Windows installer registry key ${key}: ${result.error.message}`
    )
  }
  if (result.status === 1) return { exists: false, output: '' }
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim()
    throw new Error(
      `Windows registry query failed for ${key} (view=${view}, code=${result.status})${
        detail ? `: ${detail}` : ''
      }`
    )
  }
  return { exists: true, output: `${result.stdout || ''}${result.stderr || ''}`.trim() }
}

function findExistingWindowsInstallerRegistrations({
  platform = process.platform,
  queryKey = queryWindowsRegistryKey
} = {}) {
  if (platform !== 'win32') return []

  return windowsInstallerRegistryKeys().flatMap((definition) => {
    const result = queryKey(definition)
    if (!result?.exists) return []
    return [
      {
        ...definition,
        installLocation: parseRegistryValue(result.output, 'InstallLocation'),
        uninstallString: parseRegistryValue(result.output, 'UninstallString')
      }
    ]
  })
}

function processHasExited(child) {
  return child.exitCode != null || child.signalCode != null
}

function waitForProcessExit(child, timeoutMs = processTerminationTimeoutMs) {
  if (processHasExited(child)) return Promise.resolve(true)

  return new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (exited) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener?.('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    child.once('exit', onExit)
    timer = setTimeout(() => finish(processHasExited(child)), Math.max(0, timeoutMs))
    // Avoid missing an exit that happened between the initial check and listener registration.
    if (processHasExited(child)) finish(true)
  })
}

async function terminateProcessTree(
  child,
  { platform = process.platform, spawnImpl = spawn, timeoutMs = processTerminationTimeoutMs } = {}
) {
  if (processHasExited(child)) return false

  const deadline = Date.now() + Math.max(0, timeoutMs)
  const waitForConfirmedExit = async () => {
    const remainingMs = Math.max(0, deadline - Date.now())
    if (await waitForProcessExit(child, remainingMs)) return true
    throw new Error(`Process ${child.pid || 'unknown'} did not exit after termination`)
  }

  if (!Number.isInteger(child.pid) || child.pid < 1) {
    child.kill()
    return waitForConfirmedExit()
  }

  if (platform !== 'win32') {
    child.kill('SIGKILL')
    return waitForConfirmedExit()
  }

  const result = await new Promise((resolve) => {
    let settled = false
    let timer = null
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const killer = spawnImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      cwd: root,
      stdio: 'ignore',
      windowsHide: true
    })
    timer = setTimeout(
      () => {
        killer.kill()
        killer.unref?.()
        finish({ timedOut: true })
      },
      Math.max(0, deadline - Date.now())
    )
    killer.once('error', (error) => finish({ error }))
    killer.once('close', (code, signal) => finish({ code, signal }))
  })

  if (processHasExited(child)) return true
  if (result.error) {
    throw new Error(`taskkill could not start: ${result.error.message}`, { cause: result.error })
  }
  if (result.timedOut) throw new Error(`taskkill timed out after ${timeoutMs}ms`)
  if (result.code !== 0) {
    throw new Error(
      `taskkill failed (code=${result.code}, signal=${result.signal || 'none'}) for pid ${child.pid}`
    )
  }
  return waitForConfirmedExit()
}

function releaseChildProcess(child) {
  child.stdout?.destroy?.()
  child.stderr?.destroy?.()
  child.unref?.()
}

async function runProcess(
  executablePath,
  args,
  {
    label,
    timeoutMs,
    env = process.env,
    windowsVerbatimArguments = false,
    spawnImpl = spawn,
    terminate = terminateProcessTree
  } = {}
) {
  let output = ''
  let timedOut = false
  let terminationError = null
  let terminationPromise = null
  const child = spawnImpl(executablePath, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments
  })

  child.stdout?.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk) => {
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
      terminationPromise = Promise.resolve()
        .then(() => terminate(child))
        .catch((error) => {
          terminationError = error
        })
        .then(() => {
          if (settled) return
          releaseChildProcess(child)
          finish({
            code: child.exitCode,
            signal: child.signalCode || 'timeout'
          })
        })
    }, timeoutMs)
    child.once('error', (error) => finish({ error }))
    // Resolve when the installer process exits. NSIS helper processes can inherit stdout/stderr
    // handles and keep `close` from firing even after the installer itself has finished.
    child.once('exit', (code, signal) => finish({ code, signal }))
  })

  if (timedOut && terminationPromise) await terminationPromise
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`, { cause: result.error })
  }
  if (timedOut) {
    const terminationDetail = terminationError
      ? `; process termination failed: ${terminationError.message}`
      : ''
    throw new Error(
      `${label} timed out after ${timeoutMs}ms (plus up to ${processTerminationTimeoutMs}ms termination grace)${terminationDetail}`
    )
  }
  if (result.code !== 0) {
    const detail = output.trim() ? `\n${output.trim()}` : ''
    throw new Error(
      `${label} failed (code=${result.code}, signal=${result.signal || 'none'})${detail}`
    )
  }
  return output
}

async function waitForPath(
  targetPath,
  timeoutMs = installationReadyTimeoutMs,
  pollIntervalMs = 250
) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (!fs.existsSync(targetPath)) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)))
  }
  return fs.existsSync(targetPath)
}

function fileReadinessSignature(targetPath) {
  try {
    const stat = fs.statSync(targetPath)
    if (!stat.isFile() || stat.size <= 0) return ''
    const descriptor = fs.openSync(targetPath, 'r')
    fs.closeSync(descriptor)
    return `${stat.size}:${stat.mtimeMs}`
  } catch {
    return ''
  }
}

async function waitForFilesReady(
  targetPaths,
  timeoutMs = installationReadyTimeoutMs,
  pollIntervalMs = 250,
  stablePolls = 2
) {
  const paths = [...new Set(targetPaths)]
  if (paths.length === 0) return true

  const requiredStablePolls = Math.max(1, stablePolls)
  const deadline = Date.now() + Math.max(0, timeoutMs)
  let previousSignature = ''
  let stableCount = 0

  while (true) {
    const signatures = paths.map(fileReadinessSignature)
    if (signatures.every(Boolean)) {
      const signature = signatures.join('|')
      stableCount = signature === previousSignature ? stableCount + 1 : 1
      previousSignature = signature
      if (stableCount >= requiredStablePolls) return true
    } else {
      previousSignature = ''
      stableCount = 0
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) return false
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)))
  }
}

async function waitForRemoval(targetPath, timeoutMs = removalTimeoutMs, pollIntervalMs = 250) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (fs.existsSync(targetPath)) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)))
  }
  return !fs.existsSync(targetPath)
}

async function waitForInstallerRegistrationsRemoved(
  timeoutMs = registrationRemovalTimeoutMs,
  pollIntervalMs = 250,
  findRegistrations = findExistingWindowsInstallerRegistrations
) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (true) {
    const registrations = findRegistrations()
    if (registrations.length === 0) return []

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) return registrations
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)))
  }
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
  const installationDirectory = path.win32.dirname(executablePath)
  if (!(await waitForRemoval(installationDirectory))) {
    throw new Error(`Installation directory still exists after uninstall: ${installationDirectory}`)
  }
  return true
}

async function uninstallAndWaitForRegistrationRemoval({
  env = process.env,
  executablePath = installedExecutablePath(env),
  uninstallerPath = installedUninstallerPath(env),
  uninstall = uninstallInstalledApp,
  waitForRegistrationsRemoved = waitForInstallerRegistrationsRemoved
} = {}) {
  const uninstalled = await uninstall({ env, executablePath, uninstallerPath })
  if (!uninstalled) return { uninstalled: false, remainingRegistrations: [] }
  return {
    uninstalled: true,
    remainingRegistrations: await waitForRegistrationsRemoved()
  }
}

function describeExistingRegistration(registration) {
  const location = registration.installLocation || registration.uninstallString
  return `${registration.key} [${registration.view}-bit]${location ? ` -> ${location}` : ''}`
}

function normalizeWindowsPath(value) {
  return path.win32
    .normalize(String(value || '').trim())
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

function assertIsolatedInstallRegistration(installationDirectory, registrations) {
  const expectedLocation = normalizeWindowsPath(installationDirectory)
  const registeredLocations = registrations
    .map(({ installLocation }) => installLocation)
    .filter(Boolean)

  if (registeredLocations.length === 0) {
    throw new Error(
      `Windows installer did not register an InstallLocation for isolated directory: ${installationDirectory}`
    )
  }
  if (
    !registeredLocations.some((location) => normalizeWindowsPath(location) === expectedLocation)
  ) {
    throw new Error(
      `Windows installer did not honor the isolated /D directory (${installationDirectory}); registered locations: ${registeredLocations.join(', ')}`
    )
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

  const defaultInstallationDirectory = installedAppDirectory()
  const existingRegistrations = findExistingWindowsInstallerRegistrations()
  if (fs.existsSync(defaultInstallationDirectory) || existingRegistrations.length > 0) {
    const registryDetail = existingRegistrations.map(describeExistingRegistration).join('; ')
    throw new Error(
      `Refusing to replace an existing Ops Desktop installation: ${defaultInstallationDirectory}${
        registryDetail ? `; registry: ${registryDetail}` : ''
      }`
    )
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
    if (!(await waitForFilesReady([executablePath, uninstallerPath]))) {
      const detectedRegistrations = findExistingWindowsInstallerRegistrations()
      const registryDetail = detectedRegistrations.map(describeExistingRegistration).join('; ')
      throw new Error(
        `Installed Windows files did not become ready in the isolated directory: ${installationDirectory}${
          registryDetail ? `; detected registry: ${registryDetail}` : ''
        }`
      )
    }
    assertIsolatedInstallRegistration(
      installationDirectory,
      findExistingWindowsInstallerRegistrations()
    )

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
    // NSIS runs the real uninstall work from a temporary child process. The original
    // uninstaller can exit after removing the install directory but before that child
    // removes shortcuts and registry keys, so wait for the registered lifecycle to settle.
    const { uninstalled, remainingRegistrations } = await uninstallAndWaitForRegistrationRemoval({
      executablePath,
      uninstallerPath
    })
    if (!uninstalled) {
      throw new Error(`Windows uninstaller was not found after app smoke test: ${uninstallerPath}`)
    }
    installStarted = false
    if (remainingRegistrations.length > 0) {
      throw new Error(
        `Windows uninstaller left installer registry keys behind: ${remainingRegistrations
          .map(describeExistingRegistration)
          .join('; ')}`
      )
    }
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
    if (installStarted) {
      try {
        if (await waitForFilesReady([uninstallerPath], 15_000)) {
          const { remainingRegistrations } = await uninstallAndWaitForRegistrationRemoval({
            executablePath,
            uninstallerPath
          })
          if (remainingRegistrations.length > 0) {
            console.warn(
              `Windows cleanup left installer registry keys behind: ${remainingRegistrations
                .map(describeExistingRegistration)
                .join('; ')}`
            )
          }
        } else {
          const detectedRegistrations = findExistingWindowsInstallerRegistrations()
          const registryDetail = detectedRegistrations.map(describeExistingRegistration).join('; ')
          console.warn(
            `Windows installer did not create a ready uninstaller in the isolated smoke directory: ${uninstallerPath}${
              registryDetail ? `; detected registry: ${registryDetail}` : ''
            }`
          )
        }
      } catch (error) {
        console.warn(`Failed to clean up smoke-test installation: ${error.message}`)
      }
    }
    try {
      // smokeRoot is created by this run and never points at the user's normal installation directory.
      fs.rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
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
  assertIsolatedInstallRegistration,
  findExistingWindowsInstallerRegistrations,
  installedAppDirectory,
  installedExecutablePath,
  installedExecutablePathAt,
  installedUninstallerPath,
  installedUninstallerPathAt,
  installerArguments,
  packagedInstallerPath,
  parseRegistryValue,
  processHasExited,
  queryWindowsRegistryKey,
  renderWindowsArtifactName,
  run,
  runProcess,
  shouldAllowInstallerSmoke,
  terminateProcessTree,
  uninstallAndWaitForRegistrationRemoval,
  uninstallInstalledApp,
  waitForFilesReady,
  waitForInstallerRegistrationsRemoved,
  waitForPath,
  waitForProcessExit,
  waitForRemoval,
  windowsInstallerGuid,
  windowsInstallerRegistryKeys
}
