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
  installedExecutablePath,
  installedUninstallerPath,
  packagedInstallerPath,
  renderWindowsArtifactName,
  shouldAllowInstallerSmoke
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

test('Windows installer smoke test 使用架构化安装包并保护现有安装', () => {
  assert.equal(renderWindowsArtifactName('x64'), 'Ops Desktop-1.0.3-windows-x64.exe')
  assert.equal(renderWindowsArtifactName('arm64'), 'Ops Desktop-1.0.3-windows-arm64.exe')
  assert.equal(
    packagedInstallerPath('arm64'),
    path.join(root, 'release', 'Ops Desktop-1.0.3-windows-arm64.exe')
  )
  assert.equal(
    installedExecutablePath({ LOCALAPPDATA: 'C:\\Users\\runner\\AppData\\Local' }),
    path.join('C:\\Users\\runner\\AppData\\Local', 'Programs', 'Ops Desktop', 'Ops Desktop.exe')
  )
  assert.equal(
    installedUninstallerPath({ LOCALAPPDATA: 'C:\\Users\\runner\\AppData\\Local' }),
    path.join(
      'C:\\Users\\runner\\AppData\\Local',
      'Programs',
      'Ops Desktop',
      'Uninstall Ops Desktop.exe'
    )
  )
  assert.equal(shouldAllowInstallerSmoke(['node', 'script', '--allow-install']), true)
  assert.equal(shouldAllowInstallerSmoke(['node', 'script']), false)
  assert.match(installerSmokeScript, /Refusing to replace an existing Ops Desktop installation/)
  assert.match(installerSmokeScript, /Windows installer.*\['\/S'\]/s)
  assert.match(installerSmokeScript, /Windows uninstaller.*\['\/S'\]/s)
  assert.match(installerSmokeScript, /createModelAvailabilityFixture/)
  assert.match(installerSmokeScript, /model test and monitoring requests to the local fixture/)
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
    fixture = await createCcSwitchFixture(directory)
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
