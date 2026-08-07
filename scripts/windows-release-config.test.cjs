const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const packageJson = require(path.join(root, 'package.json'))
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
const smokeScriptPath = path.join(root, 'scripts', 'windows-packaged-app-smoke.cjs')
const smokeScript = fs.readFileSync(smokeScriptPath, 'utf8')
const installerSmokeScriptPath = path.join(root, 'scripts', 'windows-installer-smoke.cjs')
const installerSmokeScript = fs.readFileSync(installerSmokeScriptPath, 'utf8')
const {
  assertWindowsPackagedSmokeResult,
  createCcSwitchFixture,
  createModelAvailabilityFixture,
  fixtureProvider,
  modelTestReply,
  packagedExecutablePath,
  readPackagedSmokeResult,
  shouldCreateCcSwitchFixture,
  unpackedDirectoryName
} = require(smokeScriptPath)
const {
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
  runProcess,
  shouldAllowInstallerSmoke,
  terminateProcessTree,
  uninstallAndWaitForRegistrationRemoval,
  waitForFilesReady,
  waitForInstallerRegistrationsRemoved,
  waitForPath,
  waitForProcessExit,
  waitForRemoval,
  windowsInstallerGuid,
  windowsInstallerRegistryKeys
} = require(installerSmokeScriptPath)
const { loadProviders } = require('../src/main/utils/ccswitch')

test('Windows 构建生成安装包和可直接启动的解压目录', () => {
  assert.deepEqual(packageJson.build.win.target, ['nsis', 'zip'])
  assert.equal(
    packageJson.build.win.artifactName,
    '${productName}-${version}-windows-${arch}.${ext}'
  )
  assert.match(packageJson.scripts['electron:build:win'], /electron-builder --win/)
  assert.match(packageJson.scripts['electron:build:win:x64'], /electron-builder --win --x64/)
  assert.match(packageJson.scripts['electron:build:win:arm64'], /electron-builder --win --arm64/)
  assert.equal(packageJson.build.nsis.guid, '3559e11b-2b00-5c6a-a3a4-ef9892dcdb41')
  assert.equal(packageJson.build.nsis.oneClick, true)
  assert.equal(packageJson.build.nsis.perMachine, false)
  assert.equal(packageJson.devDependencies['electron-builder'], '^26.15.7')
  assert.equal(fs.existsSync(smokeScriptPath), true)
  assert.equal(fs.existsSync(installerSmokeScriptPath), true)
})

test('Windows CI 在原生 x64 和 ARM64 runner 构建、启动并上传各自安装产物', () => {
  assert.match(workflow, /runs-on: \$\{\{ matrix\.os \}\}/)
  assert.match(workflow, /os: windows-latest/)
  assert.match(workflow, /os: windows-11-arm/)
  assert.match(workflow, /arch: x64/)
  assert.match(workflow, /arch: arm64/)
  assert.match(workflow, /run: pnpm electron:build:win:\$\{\{ matrix\.arch \}\}/)
  assert.match(workflow, /CSC_LINK: \$\{\{ secrets\.WINDOWS_CSC_LINK \}\}/)
  assert.match(workflow, /CSC_KEY_PASSWORD: \$\{\{ secrets\.WINDOWS_CSC_KEY_PASSWORD \}\}/)
  assert.match(workflow, /Get-AuthenticodeSignature -FilePath \$target\.FullName/)
  assert.match(workflow, /skipping Authenticode verification/)
  assert.match(
    workflow,
    /node scripts\/windows-packaged-app-smoke\.cjs --arch=\$\{\{ matrix\.arch \}\} --ccswitch-fixture/
  )
  assert.match(
    workflow,
    /node scripts\/windows-installer-smoke\.cjs --arch=\$\{\{ matrix\.arch \}\} --allow-install/
  )
  assert.match(workflow, /name: ops-desktop-win-\$\{\{ matrix\.arch \}\}/)
  assert.match(workflow, /pattern: ops-desktop-win-\*/)
  assert.match(workflow, /merge-multiple: true/)
  assert.match(workflow, /release\/\*\.exe/)
  assert.match(workflow, /release\/\*\.zip/)
})

test('Windows installer smoke test 使用隔离目录且不会覆盖现有安装', () => {
  assert.equal(renderWindowsArtifactName('x64'), `Ops Desktop-${packageJson.version}-windows-x64.exe`)
  assert.equal(renderWindowsArtifactName('arm64'), `Ops Desktop-${packageJson.version}-windows-arm64.exe`)
  assert.equal(
    packagedInstallerPath('arm64'),
    path.join(root, 'release', `Ops Desktop-${packageJson.version}-windows-arm64.exe`)
  )

  const env = { LOCALAPPDATA: 'C:\\Users\\runner\\AppData\\Local' }
  const defaultInstallationDirectory = path.win32.join(env.LOCALAPPDATA, 'Programs', 'Ops Desktop')
  assert.equal(installedAppDirectory(env), defaultInstallationDirectory)
  assert.equal(
    installedExecutablePath(env),
    path.win32.join(defaultInstallationDirectory, 'Ops Desktop.exe')
  )
  assert.equal(
    installedUninstallerPath(env),
    path.win32.join(defaultInstallationDirectory, 'Uninstall Ops Desktop.exe')
  )
  assert.throws(() => installedAppDirectory({}), /LOCALAPPDATA is unavailable/)

  const installationDirectory = path.win32.join(
    'C:\\Users\\Jane Doe\\AppData\\Local',
    'Temp',
    'ops-desktop-installer-smoke-123',
    'installed-app'
  )
  assert.equal(
    installedExecutablePathAt(installationDirectory),
    path.win32.join(installationDirectory, 'Ops Desktop.exe')
  )
  assert.equal(
    installedUninstallerPathAt(installationDirectory),
    path.win32.join(installationDirectory, 'Uninstall Ops Desktop.exe')
  )
  assert.deepEqual(installerArguments(installationDirectory), ['/S', `/D=${installationDirectory}`])
  assert.throws(() => installerArguments('installed-app'), /must be absolute/)
  assert.equal(shouldAllowInstallerSmoke(['node', 'script', '--allow-install']), true)
  assert.equal(shouldAllowInstallerSmoke(['node', 'script']), false)

  assert.match(installerSmokeScript, /Refusing to replace an existing Ops Desktop installation/)
  assert.match(
    installerSmokeScript,
    /const installationDirectory = path\.join\(smokeRoot, 'installed-app'\)/
  )
  assert.match(installerSmokeScript, /installerArguments\(installationDirectory\)/)
  assert.match(installerSmokeScript, /windowsVerbatimArguments: true/)
  assert.match(installerSmokeScript, /findExistingWindowsInstallerRegistrations\(\)/)
  assert.match(installerSmokeScript, /runProcess\(uninstallerPath, \['\/S'\]/)
  assert.match(installerSmokeScript, /waitForFilesReady\(\[executablePath, uninstallerPath\]\)/)
  assert.match(installerSmokeScript, /assertIsolatedInstallRegistration/)
  assert.match(installerSmokeScript, /waitForRemoval\(installationDirectory\)/)
  assert.match(
    installerSmokeScript,
    /spawnImpl\('taskkill', \['\/PID', String\(child\.pid\), '\/T', '\/F'\]/
  )
  assert.match(installerSmokeScript, /child\.once\('exit'/)
  assert.doesNotMatch(installerSmokeScript, /fs\.rmSync\(defaultInstallationDirectory/)
  assert.doesNotMatch(installerSmokeScript, /fs\.rmSync\(installationDirectory/)
  assert.match(installerSmokeScript, /fs\.rmSync\(smokeRoot/)

  const installerTimeout = installerSmokeScript.match(/const installerTimeoutMs\s*=\s*(\d[\d_]*)/)
  const uninstallTimeout = installerSmokeScript.match(/const uninstallTimeoutMs\s*=\s*(\d[\d_]*)/)
  const readyTimeout = installerSmokeScript.match(
    /const installationReadyTimeoutMs\s*=\s*(\d[\d_]*)/
  )
  assert.ok(installerTimeout)
  assert.ok(uninstallTimeout)
  assert.ok(readyTimeout)
  assert.equal(Number(installerTimeout[1].replaceAll('_', '')), 300_000)
  assert.equal(Number(uninstallTimeout[1].replaceAll('_', '')), 120_000)
  assert.equal(Number(readyTimeout[1].replaceAll('_', '')), 180_000)
  assert.match(installerSmokeScript, /createModelAvailabilityFixture/)
  assert.match(installerSmokeScript, /model test and monitoring requests to the local fixture/)
})

test('Windows installer smoke test 检查固定 GUID 的用户和系统注册表项', () => {
  const guid = '3559e11b-2b00-5c6a-a3a4-ef9892dcdb41'
  assert.equal(windowsInstallerGuid(), guid)

  const keys = windowsInstallerRegistryKeys()
  assert.equal(keys.length, 8)
  assert.ok(keys.some(({ key, view }) => key === `HKCU\\Software\\${guid}` && view === '64'))
  assert.ok(
    keys.some(
      ({ key, view }) =>
        key === `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}` &&
        view === '32'
    )
  )

  const registryOutput = [
    `HKEY_CURRENT_USER\\Software\\${guid}`,
    '    InstallLocation    REG_SZ    C:\\Custom Apps\\Ops Desktop',
    '    UninstallString    REG_SZ    "C:\\Custom Apps\\Ops Desktop\\Uninstall Ops Desktop.exe"'
  ].join('\r\n')
  assert.equal(
    parseRegistryValue(registryOutput, 'InstallLocation'),
    'C:\\Custom Apps\\Ops Desktop'
  )
  assert.equal(
    parseRegistryValue(registryOutput, 'UninstallString'),
    '"C:\\Custom Apps\\Ops Desktop\\Uninstall Ops Desktop.exe"'
  )

  const expectedDefinition = keys.find(
    ({ key, view }) => key === `HKCU\\Software\\${guid}` && view === '64'
  )
  const registrations = findExistingWindowsInstallerRegistrations({
    platform: 'win32',
    queryKey: (definition) =>
      definition.key === expectedDefinition.key && definition.view === expectedDefinition.view
        ? { exists: true, output: registryOutput }
        : { exists: false, output: '' }
  })
  assert.deepEqual(registrations, [
    {
      ...expectedDefinition,
      installLocation: 'C:\\Custom Apps\\Ops Desktop',
      uninstallString: '"C:\\Custom Apps\\Ops Desktop\\Uninstall Ops Desktop.exe"'
    }
  ])
  assert.equal(
    assertIsolatedInstallRegistration('c:\\custom apps\\ops desktop\\', registrations),
    true
  )
  assert.throws(
    () => assertIsolatedInstallRegistration('C:\\Expected\\Ops Desktop', registrations),
    /did not honor the isolated \/D directory/
  )
  assert.throws(
    () => assertIsolatedInstallRegistration('C:\\Expected\\Ops Desktop', []),
    /did not register an InstallLocation/
  )
  assert.deepEqual(
    findExistingWindowsInstallerRegistrations({
      platform: 'darwin',
      queryKey: () => {
        throw new Error('must not query on non-Windows platforms')
      }
    }),
    []
  )
  const queriedDefinitions = []
  assert.deepEqual(
    findExistingWindowsInstallerRegistrations({
      platform: 'win32',
      queryKey: (definition) => {
        queriedDefinitions.push(definition)
        return { exists: false, output: '' }
      }
    }),
    []
  )
  assert.deepEqual(queriedDefinitions, keys)

  let invocation = null
  assert.deepEqual(
    queryWindowsRegistryKey(expectedDefinition, {
      spawnSyncImpl: (command, args, options) => {
        invocation = { command, args, options }
        return { status: 0, stdout: registryOutput, stderr: '' }
      }
    }),
    { exists: true, output: registryOutput }
  )
  assert.equal(invocation.command, 'reg.exe')
  assert.deepEqual(invocation.args, ['query', expectedDefinition.key, '/reg:64'])
  assert.equal(invocation.options.windowsHide, true)
  assert.deepEqual(
    queryWindowsRegistryKey(expectedDefinition, {
      spawnSyncImpl: () => ({ status: 1, stdout: '', stderr: '' })
    }),
    { exists: false, output: '' }
  )
  assert.throws(
    () =>
      queryWindowsRegistryKey(expectedDefinition, {
        spawnSyncImpl: () => ({ error: new Error('reg fixture failed') })
      }),
    /reg fixture failed/
  )
  assert.throws(
    () =>
      queryWindowsRegistryKey(expectedDefinition, {
        spawnSyncImpl: () => ({ status: 2, stdout: '', stderr: 'access denied' })
      }),
    /access denied/
  )
})

test('Windows installer smoke test 的进程与路径等待辅助函数可在本地 Node 运行', async () => {
  const { EventEmitter } = require('node:events')
  const directory = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'windows-installer-wait-')
  )
  const appearingPath = path.join(directory, 'appearing')
  const disappearingPath = path.join(directory, 'disappearing')
  fs.writeFileSync(disappearingPath, '')
  const createTimer = setTimeout(() => fs.writeFileSync(appearingPath, 'ready'), 15)
  const removeTimer = setTimeout(() => fs.rmSync(disappearingPath), 15)

  try {
    assert.equal(await waitForPath(appearingPath, 200, 5), true)
    assert.equal(await waitForFilesReady([appearingPath], 200, 5, 2), true)
    assert.equal(await waitForRemoval(disappearingPath, 200, 5), true)

    let registrationPolls = 0
    assert.deepEqual(
      await waitForInstallerRegistrationsRemoved(200, 5, () => {
        registrationPolls += 1
        return registrationPolls < 3 ? [{ key: 'HKCU\\Software\\fixture' }] : []
      }),
      []
    )
    assert.equal(registrationPolls, 3)
    const remainingRegistrations = [{ key: 'HKCU\\Software\\fixture' }]
    assert.deepEqual(
      await waitForInstallerRegistrationsRemoved(15, 1_000, () => remainingRegistrations),
      remainingRegistrations
    )

    const lifecycleOrder = []
    const lifecycleResult = await uninstallAndWaitForRegistrationRemoval({
      executablePath: 'C:\\fixture\\Ops Desktop.exe',
      uninstallerPath: 'C:\\fixture\\Uninstall Ops Desktop.exe',
      uninstall: async ({ executablePath, uninstallerPath }) => {
        lifecycleOrder.push('uninstall')
        assert.equal(executablePath, 'C:\\fixture\\Ops Desktop.exe')
        assert.equal(uninstallerPath, 'C:\\fixture\\Uninstall Ops Desktop.exe')
        return true
      },
      waitForRegistrationsRemoved: async () => {
        lifecycleOrder.push('registrations')
        return []
      }
    })
    assert.deepEqual(lifecycleOrder, ['uninstall', 'registrations'])
    assert.deepEqual(lifecycleResult, { uninstalled: true, remainingRegistrations: [] })

    let skippedRegistrationWait = true
    assert.deepEqual(
      await uninstallAndWaitForRegistrationRemoval({
        executablePath: 'C:\\fixture\\Ops Desktop.exe',
        uninstallerPath: 'C:\\fixture\\Uninstall Ops Desktop.exe',
        uninstall: async () => false,
        waitForRegistrationsRemoved: async () => {
          skippedRegistrationWait = false
          return []
        }
      }),
      { uninstalled: false, remainingRegistrations: [] }
    )
    assert.equal(skippedRegistrationWait, true)

    const waitStartedAt = Date.now()
    assert.equal(await waitForPath(path.join(directory, 'missing'), 20, 1_000), false)
    const elapsedMs = Date.now() - waitStartedAt
    assert.ok(elapsedMs >= 15, `wait ended too early: ${elapsedMs}ms`)
    assert.ok(elapsedMs < 500, `wait overshot its deadline: ${elapsedMs}ms`)

    assert.equal(processHasExited({ exitCode: 0, signalCode: null }), true)
    assert.equal(processHasExited({ exitCode: null, signalCode: 'SIGTERM' }), true)
    assert.equal(processHasExited({ exitCode: null, signalCode: null }), false)
    assert.equal(processHasExited({}), false)

    const delayedExit = new EventEmitter()
    Object.assign(delayedExit, { exitCode: null, signalCode: null })
    const delayedExitTimer = setTimeout(() => {
      delayedExit.exitCode = 0
      delayedExit.emit('exit', 0, null)
    }, 10)
    assert.equal(await waitForProcessExit(delayedExit, 100), true)
    clearTimeout(delayedExitTimer)

    const target = new EventEmitter()
    Object.assign(target, {
      pid: 4242,
      exitCode: null,
      signalCode: null,
      kill() {
        throw new Error('target kill fallback must not be needed after successful taskkill')
      }
    })
    let taskkillInvocation = null
    const termination = terminateProcessTree(target, {
      platform: 'win32',
      timeoutMs: 100,
      spawnImpl: (command, args, options) => {
        taskkillInvocation = { command, args, options }
        const killer = new EventEmitter()
        killer.kill = () => true
        killer.unref = () => {}
        queueMicrotask(() => {
          killer.emit('close', 0, null)
          target.exitCode = 0
          target.emit('exit', 0, null)
        })
        return killer
      }
    })
    assert.equal(await termination, true)
    assert.equal(taskkillInvocation.command, 'taskkill')
    assert.deepEqual(taskkillInvocation.args, ['/PID', '4242', '/T', '/F'])
    assert.equal(target.exitCode, 0)

    const stuckTarget = new EventEmitter()
    Object.assign(stuckTarget, {
      pid: 4343,
      exitCode: null,
      signalCode: null,
      kill: () => true
    })
    await assert.rejects(
      terminateProcessTree(stuckTarget, {
        platform: 'win32',
        timeoutMs: 20,
        spawnImpl: () => {
          const killer = new EventEmitter()
          killer.kill = () => true
          killer.unref = () => {}
          queueMicrotask(() => killer.emit('close', 0, null))
          return killer
        }
      }),
      /did not exit after termination/
    )

    const failedTaskkillTarget = new EventEmitter()
    Object.assign(failedTaskkillTarget, {
      pid: 4444,
      exitCode: null,
      signalCode: null,
      kill() {
        throw new Error('target kill must not hide taskkill failure')
      }
    })
    await assert.rejects(
      terminateProcessTree(failedTaskkillTarget, {
        platform: 'win32',
        timeoutMs: 100,
        spawnImpl: () => {
          const killer = new EventEmitter()
          killer.kill = () => true
          killer.unref = () => {}
          queueMicrotask(() => killer.emit('close', 5, null))
          return killer
        }
      }),
      /taskkill failed \(code=5, signal=none\) for pid 4444/
    )

    assert.equal(
      await runProcess(process.execPath, ['-e', 'process.exit(0)'], {
        label: 'installer process fixture',
        timeoutMs: 5_000
      }),
      ''
    )
    await assert.rejects(
      runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5_000)'], {
        label: 'installer timeout fixture',
        timeoutMs: 20
      }),
      /timed out after 20ms/
    )
  } finally {
    clearTimeout(createTimer)
    clearTimeout(removeTimer)
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Windows smoke test 使用正确架构目录、隔离数据目录并等待渲染进程主动退出', () => {
  assert.equal(unpackedDirectoryName('x64'), 'win-unpacked')
  assert.equal(unpackedDirectoryName('arm64'), 'win-arm64-unpacked')
  assert.equal(
    packagedExecutablePath('x64'),
    path.join(root, 'release', 'win-unpacked', 'Ops Desktop.exe')
  )
  assert.match(smokeScript, /win-unpacked/)
  assert.match(smokeScript, /--smoke-test/)
  assert.match(smokeScript, /--user-data-dir=/)
  assert.match(smokeScript, /OPS_DESKTOP_SMOKE_TEST/)
  assert.match(smokeScript, /OPS_DESKTOP_SMOKE_CCSWITCH_EXPECTED/)
  assert.match(smokeScript, /OPS_DESKTOP_SMOKE_MODEL_TEST_EXPECTED/)
  assert.match(smokeScript, /OPS_DESKTOP_SMOKE_MODEL_MONITOR_EXPECTED/)
  assert.match(smokeScript, /createModelAvailabilityFixture/)
  assert.match(smokeScript, /OPS_DESKTOP_SMOKE_RESULT_PATH/)
  assert.match(smokeScript, /windowsTaskbarSupported/)
  assert.match(smokeScript, /windowsTaskbarOverlayReady/)
  assert.match(smokeScript, /windowsNotificationSupported/)
  assert.match(smokeScript, /windowsNotificationReady/)
  assert.match(smokeScript, /APPDATA/)
  assert.match(smokeScript, /LOCALAPPDATA/)
  assert.match(smokeScript, /USERPROFILE/)
  assert.match(smokeScript, /child\.once\('exit'/)
})

test('Windows smoke test 可创建真实 SQLite WAL 模式的 CC Switch fixture', async () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'windows-ccswitch-'))
  let fixture = null
  try {
    fixture = await createCcSwitchFixture(directory, { modelTest: {} })
    assert.equal(fs.existsSync(fixture.expectation.dbPath), true)
    assert.ok(fs.statSync(`${fixture.expectation.dbPath}-wal`).size > 0)
    assert.equal(shouldCreateCcSwitchFixture(['node', 'script', '--ccswitch-fixture']), true)
    assert.equal(shouldCreateCcSwitchFixture(['node', 'script']), false)

    const result = await loadProviders({ dbCandidates: [fixture.expectation.dbPath] })
    assert.equal(result.ok, true, result.message)
    assert.equal(result.providers.length, 1)
    assert.equal(result.providers[0].id, fixtureProvider.providerId)
    assert.equal(result.providers[0].apiKey, fixtureProvider.secret)
    assert.equal(result.providers[0].models[0].model, fixtureProvider.model)
    assert.equal(Object.hasOwn(fixture.modelMonitorExpectation, 'endpoint'), false)
    assert.deepEqual(result.providers[0].endpoints, [
      fixtureProvider.baseUrl,
      fixtureProvider.endpoint
    ])
  } finally {
    fixture?.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Windows smoke test 的本地模型服务 fixture 验证 OpenAI Responses 请求', async () => {
  const fixture = await createModelAvailabilityFixture()
  try {
    const response = await fetch(`${fixture.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fixtureProvider.secret}`
      },
      body: JSON.stringify({ model: fixtureProvider.model, input: 'smoke' })
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.output[0].content[0].text, modelTestReply)
    assert.equal(fixture.requests.length, 1)
    assert.equal(fixture.requests[0].url, '/v1/responses')
  } finally {
    await fixture.close()
  }
})

test('Windows smoke test 读取并校验打包应用的任务栏与 CC Switch 结果', () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'windows-smoke-result-'))
  const resultPath = path.join(directory, 'result.json')
  const result = {
    ok: true,
    ccSwitchChecked: true,
    providerId: fixtureProvider.providerId,
    windowsTaskbarSupported: true,
    windowsTaskbarOverlayReady: true,
    windowsNotificationSupported: true,
    windowsNotificationReady: true,
    modelTestChecked: true,
    modelTestProviderId: fixtureProvider.providerId,
    modelMonitorChecked: true,
    modelMonitorProviderId: fixtureProvider.providerId
  }

  try {
    fs.writeFileSync(resultPath, JSON.stringify(result))
    assert.deepEqual(readPackagedSmokeResult(resultPath), result)
    assert.deepEqual(
      assertWindowsPackagedSmokeResult(result, {
        expectCcSwitch: true,
        expectModelTest: true,
        expectModelMonitor: true
      }),
      result
    )
    assert.throws(
      () =>
        assertWindowsPackagedSmokeResult({
          ...result,
          windowsTaskbarOverlayReady: false
        }),
      /overlay icon/
    )
    assert.throws(
      () =>
        assertWindowsPackagedSmokeResult({
          ...result,
          windowsNotificationReady: false
        }),
      /Windows notification/
    )
    assert.throws(
      () =>
        assertWindowsPackagedSmokeResult(
          { ...result, modelTestChecked: false },
          { expectModelTest: true }
        ),
      /model availability/
    )
    assert.throws(
      () =>
        assertWindowsPackagedSmokeResult(
          { ...result, modelMonitorChecked: false },
          { expectModelMonitor: true }
        ),
      /model monitoring/
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
