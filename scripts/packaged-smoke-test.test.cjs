const assert = require('node:assert/strict')
const test = require('node:test')

const {
  CCSWITCH_EXPECTATION_ENV,
  MODEL_TEST_EXPECTATION_ENV,
  MODEL_MONITOR_EXPECTATION_ENV,
  SMOKE_RESULT_PATH_ENV,
  assertCcSwitchRendererResult,
  assertModelMonitorRendererResult,
  assertModelMonitorSettings,
  assertModelTestRendererResult,
  readCcSwitchExpectation,
  readModelMonitorExpectation,
  readModelTestExpectation,
  runPackagedRendererSmokeAssertions,
  runPackagedWindowsNotificationSmokeAssertion,
  writePackagedSmokeResult
} = require('../src/main/packaged-smoke-test')

const modelTestExpectation = {
  providerId: 'fixture-provider',
  model: 'gpt-fixture',
  baseUrl: 'http://127.0.0.1:41000/v1',
  endpoint: 'http://127.0.0.1:41000/v1',
  httpStatus: 200,
  reply: 'fixture-model-available'
}

const modelMonitorExpectation = {
  providerId: 'fixture-provider',
  providerName: 'Fixture Gateway',
  appType: 'codex',
  model: 'gpt-fixture',
  endpoint: 'http://127.0.0.1:41000/v1',
  httpStatus: 200
}

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

test('打包 smoke test 能解析可选的 CC Switch 和模型可用性预期配置', () => {
  assert.equal(readCcSwitchExpectation({}), null)
  assert.equal(readModelTestExpectation({}), null)
  assert.equal(readModelMonitorExpectation({}), null)
  assert.deepEqual(
    readCcSwitchExpectation({ [CCSWITCH_EXPECTATION_ENV]: JSON.stringify(expectation) }),
    expectation
  )
  assert.deepEqual(
    readModelTestExpectation({
      [MODEL_TEST_EXPECTATION_ENV]: JSON.stringify(modelTestExpectation)
    }),
    modelTestExpectation
  )
  assert.throws(
    () => readCcSwitchExpectation({ [CCSWITCH_EXPECTATION_ENV]: '{invalid' }),
    /无法解析 CC Switch smoke test 预期配置/
  )
  assert.throws(
    () => readModelTestExpectation({ [MODEL_TEST_EXPECTATION_ENV]: '{invalid' }),
    /无法解析 模型可用性 smoke test 预期配置/
  )
  assert.throws(
    () => readModelMonitorExpectation({ [MODEL_MONITOR_EXPECTATION_ENV]: '{invalid' }),
    /无法解析 模型巡检 smoke test 预期配置/
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

test('打包 smoke test 从页面上下文读取 Provider 并执行模型可用性检测', async () => {
  const scripts = []
  const result = await runPackagedRendererSmokeAssertions(
    {
      executeJavaScript: async (source) => {
        scripts.push(source)
        if (source.includes('window.opsApi.listModelProviders')) return rendererResult()
        if (source.includes('window.opsApi.runModelTest')) {
          return {
            ok: true,
            status: 'ok',
            httpStatus: 200,
            endpoint: `responses · ${modelTestExpectation.baseUrl}`,
            reply: modelTestExpectation.reply
          }
        }
        if (source.includes('window.opsApi.saveModelMonitorSettings')) {
          return {
            ok: true,
            settings: {
              enabled: true,
              targets: [
                {
                  providerId: modelMonitorExpectation.providerId,
                  providerName: modelMonitorExpectation.providerName,
                  appType: modelMonitorExpectation.appType,
                  model: modelMonitorExpectation.model
                }
              ]
            }
          }
        }
        return {
          ok: true,
          entry: {
            source: 'scheduled',
            summary: { total: 1, ok: 1, failed: 0, gateway: 0 },
            results: [
              {
                providerId: modelMonitorExpectation.providerId,
                providerName: modelMonitorExpectation.providerName,
                appType: modelMonitorExpectation.appType,
                model: modelMonitorExpectation.model,
                status: 'ok',
                httpStatus: 200,
                endpoint: `responses · ${modelMonitorExpectation.endpoint}`
              }
            ]
          }
        }
      }
    },
    {
      [CCSWITCH_EXPECTATION_ENV]: JSON.stringify(expectation),
      [MODEL_TEST_EXPECTATION_ENV]: JSON.stringify(modelTestExpectation),
      [MODEL_MONITOR_EXPECTATION_ENV]: JSON.stringify(modelMonitorExpectation)
    }
  )

  assert.match(scripts[0], /window\.opsApi\.listModelProviders/)
  assert.match(scripts[1], /window\.opsApi\.runModelTest/)
  assert.match(scripts[1], /gpt-fixture/)
  assert.match(scripts[2], /window\.opsApi\.saveModelMonitorSettings/)
  assert.match(scripts[3], /window\.opsApi\.runModelInspection/)
  assert.deepEqual(result, {
    ccSwitchChecked: true,
    providerId: expectation.providerId,
    modelTestChecked: true,
    modelTestProviderId: expectation.providerId,
    modelMonitorChecked: true,
    modelMonitorProviderId: expectation.providerId
  })
})

test('打包 smoke test 会拒绝失败的模型可用性检测', () => {
  assert.deepEqual(
    assertModelTestRendererResult(
      {
        ok: true,
        status: 'ok',
        httpStatus: 200,
        endpoint: `responses · ${modelTestExpectation.baseUrl}`,
        reply: modelTestExpectation.reply
      },
      modelTestExpectation
    ).status,
    'ok'
  )
  assert.throws(
    () =>
      assertModelTestRendererResult(
        { ok: false, status: 'network', message: 'connection refused' },
        modelTestExpectation
      ),
    /模型可用性检测失败/
  )
})

test('打包 smoke test 会校验保存后的巡检配置和巡检快照', () => {
  assert.equal(
    assertModelMonitorSettings(
      {
        ok: true,
        settings: {
          enabled: true,
          targets: [
            {
              providerId: modelMonitorExpectation.providerId,
              providerName: modelMonitorExpectation.providerName,
              appType: modelMonitorExpectation.appType,
              model: modelMonitorExpectation.model
            }
          ]
        }
      },
      modelMonitorExpectation
    ).enabled,
    true
  )
  assert.equal(
    assertModelMonitorRendererResult(
      {
        ok: true,
        entry: {
          source: 'scheduled',
          summary: { total: 1, ok: 1, failed: 0, gateway: 0 },
          results: [
            {
              ...modelMonitorExpectation,
              status: 'ok',
              endpoint: `responses · ${modelMonitorExpectation.endpoint}`
            }
          ]
        }
      },
      modelMonitorExpectation
    ).summary.ok,
    1
  )
  assert.equal(
    assertModelMonitorRendererResult(
      {
        ok: true,
        entry: {
          source: 'scheduled',
          summary: { total: 1, ok: 1, failed: 0, gateway: 0 },
          results: [
            {
              ...modelMonitorExpectation,
              status: 'ok',
              endpoint: 'responses · http://localhost:41000/v1'
            }
          ]
        }
      },
      { ...modelMonitorExpectation, endpoint: undefined }
    ).summary.ok,
    1
  )
  assert.throws(
    () =>
      assertModelMonitorRendererResult(
        { ok: false, error: 'not configured' },
        modelMonitorExpectation
      ),
    /模型巡检失败/
  )
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
