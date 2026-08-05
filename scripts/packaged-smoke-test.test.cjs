const assert = require('node:assert/strict')
const test = require('node:test')

const {
  CCSWITCH_EXPECTATION_ENV,
  SMOKE_RESULT_PATH_ENV,
  assertCcSwitchRendererResult,
  readCcSwitchExpectation,
  runPackagedRendererSmokeAssertions,
  runPackagedWindowsNotificationSmokeAssertion,
  writePackagedSmokeResult
} = require('../src/main/packaged-smoke-test')

const expectation = {
  providerId: 'fixture-provider',
  name: 'Fixture Gateway',
  appType: 'codex',
  protocol: 'openai',
  baseUrl: 'https://fixture.example.com/v1',
  endpoint: 'https://backup.example.com/v1',
  wireApi: 'responses',
  model: 'gpt-fixture',
  secret: 'sk-fixture-secret',
  dbPath: 'C:\\Users\\runner\\AppData\\Roaming\\com.ccswitch.desktop\\cc-switch.db'
}

function rendererResult(overrides = {}) {
  return {
    ok: true,
    dbPath: expectation.dbPath.toLowerCase(),
    providers: [
      {
        id: expectation.providerId,
        name: expectation.name,
        appType: expectation.appType,
        protocol: expectation.protocol,
        baseUrl: expectation.baseUrl,
        endpoints: [expectation.baseUrl, expectation.endpoint],
        wireApi: expectation.wireApi,
        models: [{ model: expectation.model, label: 'Fixture Model' }],
        ...overrides
      }
    ]
  }
}

test('打包 smoke test 能解析可选的 CC Switch 预期配置', () => {
  assert.equal(readCcSwitchExpectation({}), null)
  assert.deepEqual(
    readCcSwitchExpectation({ [CCSWITCH_EXPECTATION_ENV]: JSON.stringify(expectation) }),
    expectation
  )
  assert.throws(
    () => readCcSwitchExpectation({ [CCSWITCH_EXPECTATION_ENV]: '{invalid' }),
    /无法解析 CC Switch smoke test 预期配置/
  )
})

test('打包 smoke test 校验 Provider、模型、端点和数据库路径', () => {
  const provider = assertCcSwitchRendererResult(rendererResult(), expectation)
  assert.equal(provider.id, expectation.providerId)
  assert.throws(
    () => assertCcSwitchRendererResult(rendererResult({ models: [] }), expectation),
    /模型列表缺少/
  )
  assert.throws(
    () => assertCcSwitchRendererResult({ ok: false, message: 'not found' }, expectation),
    /not found/
  )
})

test('打包 smoke test 拒绝 Renderer 暴露 API Key', () => {
  assert.throws(
    () => assertCcSwitchRendererResult(rendererResult({ apiKey: expectation.secret }), expectation),
    /不应包含 apiKey/
  )
  assert.throws(
    () =>
      assertCcSwitchRendererResult({ ...rendererResult(), debug: expectation.secret }, expectation),
    /泄漏了 CC Switch API Key/
  )
})

test('打包 smoke test 从页面上下文通过 preload API 读取 Provider', async () => {
  let script = ''
  const result = await runPackagedRendererSmokeAssertions(
    {
      executeJavaScript: async (source) => {
        script = source
        return rendererResult()
      }
    },
    { [CCSWITCH_EXPECTATION_ENV]: JSON.stringify(expectation) }
  )

  assert.match(script, /window\.opsApi\.listModelProviders/)
  assert.deepEqual(result, { ccSwitchChecked: true, providerId: expectation.providerId })
})

test('打包 smoke test 会在 Windows 创建并展示静默系统通知', () => {
  const calls = []
  class MockNotification {
    static isSupported() {
      calls.push('isSupported')
      return true
    }

    constructor(options) {
      calls.push(options)
    }

    show() {
      calls.push('show')
    }
  }

  assert.deepEqual(
    runPackagedWindowsNotificationSmokeAssertion({
      Notification: MockNotification,
      platform: 'win32'
    }),
    { windowsNotificationSupported: true, windowsNotificationReady: true }
  )
  assert.equal(calls[0], 'isSupported')
  assert.equal(calls[1].silent, true)
  assert.match(calls[1].title, /Windows 通知 smoke test/)
  assert.equal(calls[2], 'show')
  assert.deepEqual(
    runPackagedWindowsNotificationSmokeAssertion({
      Notification: MockNotification,
      platform: 'darwin'
    }),
    { windowsNotificationSupported: false, windowsNotificationReady: false }
  )
})

test('打包 smoke test 将主进程断言结果写入调用方指定路径', () => {
  const writes = []
  const fileSystem = {
    writeFileSync(...args) {
      writes.push(args)
    }
  }
  const result = {
    ok: true,
    windowsTaskbarSupported: true,
    windowsTaskbarOverlayReady: true
  }

  assert.equal(writePackagedSmokeResult(result, {}, fileSystem), false)
  assert.equal(
    writePackagedSmokeResult(
      result,
      { [SMOKE_RESULT_PATH_ENV]: 'C:\\Temp\\ops-smoke-result.json' },
      fileSystem
    ),
    true
  )
  assert.deepEqual(writes, [
    ['C:\\Temp\\ops-smoke-result.json', `${JSON.stringify(result)}\n`, 'utf8']
  ])
})
