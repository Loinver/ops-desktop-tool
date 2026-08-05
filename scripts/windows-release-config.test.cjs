const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const packageJson = require(path.join(root, 'package.json'))
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
const smokeScriptPath = path.join(root, 'scripts', 'windows-packaged-app-smoke.cjs')
const smokeScript = fs.readFileSync(smokeScriptPath, 'utf8')
const {
  assertWindowsPackagedSmokeResult,
  createCcSwitchFixture,
  fixtureProvider,
  packagedExecutablePath,
  readPackagedSmokeResult,
  shouldCreateCcSwitchFixture,
  unpackedDirectoryName
} = require(smokeScriptPath)
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
})

test('Windows CI 在原生 x64 和 ARM64 runner 构建、启动并上传各自安装产物', () => {
  assert.match(workflow, /runs-on: \$\{\{ matrix\.os \}\}/)
  assert.match(workflow, /os: windows-latest/)
  assert.match(workflow, /os: windows-11-arm/)
  assert.match(workflow, /arch: x64/)
  assert.match(workflow, /arch: arm64/)
  assert.match(workflow, /run: pnpm electron:build:win:\$\{\{ matrix\.arch \}\}/)
  assert.match(
    workflow,
    /node scripts\/windows-packaged-app-smoke\.cjs --arch=\$\{\{ matrix\.arch \}\} --ccswitch-fixture/
  )
  assert.match(workflow, /name: ops-desktop-win-\$\{\{ matrix\.arch \}\}/)
  assert.match(workflow, /pattern: ops-desktop-win-\*/)
  assert.match(workflow, /merge-multiple: true/)
  assert.match(workflow, /release\/\*\.exe/)
  assert.match(workflow, /release\/\*\.zip/)
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
  assert.match(smokeScript, /OPS_DESKTOP_SMOKE_RESULT_PATH/)
  assert.match(smokeScript, /windowsTaskbarSupported/)
  assert.match(smokeScript, /windowsTaskbarOverlayReady/)
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

test('Windows smoke test 读取并校验打包应用的任务栏与 CC Switch 结果', () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'windows-smoke-result-'))
  const resultPath = path.join(directory, 'result.json')
  const result = {
    ok: true,
    ccSwitchChecked: true,
    providerId: fixtureProvider.providerId,
    windowsTaskbarSupported: true,
    windowsTaskbarOverlayReady: true
  }

  try {
    fs.writeFileSync(resultPath, JSON.stringify(result))
    assert.deepEqual(readPackagedSmokeResult(resultPath), result)
    assert.deepEqual(assertWindowsPackagedSmokeResult(result, { expectCcSwitch: true }), result)
    assert.throws(
      () =>
        assertWindowsPackagedSmokeResult({
          ...result,
          windowsTaskbarOverlayReady: false
        }),
      /overlay icon/
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
