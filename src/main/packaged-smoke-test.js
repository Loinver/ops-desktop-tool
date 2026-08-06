const fs = require('node:fs')

const CCSWITCH_EXPECTATION_ENV = 'OPS_DESKTOP_SMOKE_CCSWITCH_EXPECTED'
const MODEL_TEST_EXPECTATION_ENV = 'OPS_DESKTOP_SMOKE_MODEL_TEST_EXPECTED'
const MODEL_MONITOR_EXPECTATION_ENV = 'OPS_DESKTOP_SMOKE_MODEL_MONITOR_EXPECTED'
const SMOKE_RESULT_PATH_ENV = 'OPS_DESKTOP_SMOKE_RESULT_PATH'

function readJsonExpectation(env, variableName, label) {
  const raw = String(env[variableName] || '').trim()
  if (!raw) return null

  try {
    const expectation = JSON.parse(raw)
    if (!expectation || typeof expectation !== 'object') throw new Error('配置必须是对象')
    return expectation
  } catch (error) {
    throw new Error(`无法解析 ${label}：${error.message}`, { cause: error })
  }
}

function readCcSwitchExpectation(env = process.env) {
  return readJsonExpectation(env, CCSWITCH_EXPECTATION_ENV, 'CC Switch smoke test 预期配置')
}

function readModelTestExpectation(env = process.env) {
  return readJsonExpectation(env, MODEL_TEST_EXPECTATION_ENV, '模型可用性 smoke test 预期配置')
}

function readModelMonitorExpectation(env = process.env) {
  return readJsonExpectation(env, MODEL_MONITOR_EXPECTATION_ENV, '模型巡检 smoke test 预期配置')
}

function assertEqual(actual, expected, label) {
  if (expected === undefined) return
  if (actual !== expected) {
    throw new Error(
      `${label} 不匹配：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`
    )
  }
}

function assertIncludes(values, expected, label) {
  if (expected === undefined) return
  if (!Array.isArray(values) || !values.includes(expected)) {
    throw new Error(`${label} 缺少 ${JSON.stringify(expected)}`)
  }
}

function assertCcSwitchRendererResult(result, expectation) {
  if (!result || result.ok !== true) {
    throw new Error(`渲染层未能读取 CC Switch 配置：${result?.message || '返回结果无效'}`)
  }

  if (expectation.dbPath) {
    assertEqual(
      String(result.dbPath || '').toLowerCase(),
      expectation.dbPath.toLowerCase(),
      '数据库路径'
    )
  }

  const providers = Array.isArray(result.providers) ? result.providers : []
  const provider = providers.find((item) => item.id === expectation.providerId)
  if (!provider) {
    throw new Error(`渲染层未返回预期 Provider：${expectation.providerId || '未指定'}`)
  }

  assertEqual(provider.name, expectation.name, 'Provider 名称')
  assertEqual(provider.appType, expectation.appType, 'Provider 应用类型')
  assertEqual(provider.protocol, expectation.protocol, 'Provider 协议')
  assertEqual(provider.baseUrl, expectation.baseUrl, 'Provider 主端点')
  assertEqual(provider.wireApi, expectation.wireApi, 'Provider wire API')
  assertIncludes(provider.endpoints, expectation.endpoint, 'Provider 端点')

  if (expectation.model) {
    const models = Array.isArray(provider.models) ? provider.models : []
    if (!models.some((item) => item?.model === expectation.model)) {
      throw new Error(`Provider 模型列表缺少 ${JSON.stringify(expectation.model)}`)
    }
  }

  if (Object.hasOwn(provider, 'apiKey')) {
    throw new Error('渲染层 Provider 不应包含 apiKey 字段')
  }
  if (expectation.secret && JSON.stringify(result).includes(expectation.secret)) {
    throw new Error('渲染层返回结果泄漏了 CC Switch API Key')
  }

  return provider
}

function assertModelTestRendererResult(result, expectation) {
  if (!result || result.ok !== true || result.status !== 'ok') {
    throw new Error(`渲染层模型可用性检测失败：${result?.message || '返回结果无效'}`)
  }
  assertEqual(result.httpStatus, expectation.httpStatus ?? 200, '模型检测 HTTP 状态')
  assertEqual(result.reply, expectation.reply, '模型检测回复')
  if (expectation.endpoint && !String(result.endpoint || '').includes(expectation.endpoint)) {
    throw new Error(`模型检测端点不匹配：未包含 ${JSON.stringify(expectation.endpoint)}`)
  }
  return result
}

function assertModelMonitorRendererResult(result, expectation) {
  if (!result || result.ok !== true || !result.entry) {
    throw new Error(`渲染层模型巡检失败：${result?.error || '返回结果无效'}`)
  }
  const entry = result.entry
  assertEqual(entry.source, 'scheduled', '巡检来源')
  assertEqual(entry.summary?.total, expectation.total ?? 1, '巡检总数')
  assertEqual(entry.summary?.ok, expectation.ok ?? 1, '巡检成功数')
  assertEqual(entry.summary?.failed, expectation.failed ?? 0, '巡检失败数')
  assertEqual(entry.summary?.gateway, expectation.gateway ?? 0, '巡检网关异常数')

  const inspected = Array.isArray(entry.results)
    ? entry.results.find(
        (item) =>
          item?.providerId === expectation.providerId &&
          item?.appType === expectation.appType &&
          item?.model === expectation.model
      )
    : null
  if (!inspected) {
    throw new Error(
      `巡检结果缺少 ${expectation.providerId || '未指定 Provider'} · ${expectation.model || '未指定模型'}`
    )
  }
  assertEqual(inspected.providerName, expectation.providerName, '巡检 Provider 名称')
  assertEqual(inspected.status, 'ok', '巡检状态')
  assertEqual(inspected.httpStatus, expectation.httpStatus ?? 200, '巡检 HTTP 状态')
  if (expectation.endpoint && !String(inspected.endpoint || '').includes(expectation.endpoint)) {
    throw new Error(`巡检端点不匹配：未包含 ${JSON.stringify(expectation.endpoint)}`)
  }
  return entry
}

function assertModelMonitorSettings(result, expectation) {
  if (!result || result.ok !== true || !result.settings) {
    throw new Error(`渲染层保存模型巡检配置失败：${result?.error || '返回结果无效'}`)
  }
  const target = result.settings.targets?.find(
    (item) =>
      item?.providerId === expectation.providerId &&
      item?.appType === expectation.appType &&
      item?.model === expectation.model
  )
  if (!target) throw new Error('保存后的模型巡检配置缺少预期目标')
  assertEqual(result.settings.enabled, true, '巡检启用状态')
  assertEqual(target.providerName, expectation.providerName, '巡检配置 Provider 名称')
  return result.settings
}

async function runPackagedRendererSmokeAssertions(webContents, env = process.env) {
  const expectation = readCcSwitchExpectation(env)
  const modelTestExpectation = readModelTestExpectation(env)
  const modelMonitorExpectation = readModelMonitorExpectation(env)
  if (!expectation) {
    if (modelTestExpectation || modelMonitorExpectation) {
      throw new Error('模型 smoke test 缺少 CC Switch 预期配置')
    }
    return { ccSwitchChecked: false, modelTestChecked: false, modelMonitorChecked: false }
  }

  const result = await webContents.executeJavaScript(
    `(() => {
      if (!window.opsApi || typeof window.opsApi.listModelProviders !== 'function') {
        throw new Error('window.opsApi.listModelProviders 不可用')
      }
      return window.opsApi.listModelProviders()
    })()`
  )
  const provider = assertCcSwitchRendererResult(result, expectation)
  let smokeResult = {
    ccSwitchChecked: true,
    providerId: provider.id,
    modelTestChecked: false,
    modelMonitorChecked: false
  }
  if (modelTestExpectation && modelTestExpectation.providerId !== provider.id) {
    throw new Error(
      `模型可用性 smoke test Provider 不匹配：${modelTestExpectation.providerId || '未指定'}`
    )
  }
  if (modelTestExpectation) {
    const payload = JSON.stringify({
      providerId: provider.id,
      appType: provider.appType,
      model: modelTestExpectation.model || expectation.model,
      baseUrl: modelTestExpectation.baseUrl || expectation.baseUrl,
      timeoutMs: modelTestExpectation.timeoutMs || 10_000
    })
    const modelTestResult = await webContents.executeJavaScript(
      `(() => {
        if (!window.opsApi || typeof window.opsApi.runModelTest !== 'function') {
          throw new Error('window.opsApi.runModelTest 不可用')
        }
        return window.opsApi.runModelTest(${payload})
      })()`
    )
    assertModelTestRendererResult(modelTestResult, modelTestExpectation)
    smokeResult = { ...smokeResult, modelTestChecked: true, modelTestProviderId: provider.id }
  }

  if (!modelMonitorExpectation) return smokeResult
  if (modelMonitorExpectation.providerId !== provider.id) {
    throw new Error(
      `模型巡检 smoke test Provider 不匹配：${modelMonitorExpectation.providerId || '未指定'}`
    )
  }
  const monitorSettings = JSON.stringify({
    enabled: true,
    intervalMinutes: modelMonitorExpectation.intervalMinutes || 5,
    notifyOnFailure: false,
    targets: [
      {
        providerId: provider.id,
        providerName: modelMonitorExpectation.providerName || provider.name,
        appType: provider.appType,
        model: modelMonitorExpectation.model || expectation.model
      }
    ]
  })
  const savedMonitor = await webContents.executeJavaScript(
    `(() => {
      if (!window.opsApi || typeof window.opsApi.saveModelMonitorSettings !== 'function') {
        throw new Error('window.opsApi.saveModelMonitorSettings 不可用')
      }
      return window.opsApi.saveModelMonitorSettings(${monitorSettings})
    })()`
  )
  assertModelMonitorSettings(savedMonitor, modelMonitorExpectation)
  const monitorResult = await webContents.executeJavaScript(
    `(() => {
      if (!window.opsApi || typeof window.opsApi.runModelInspection !== 'function') {
        throw new Error('window.opsApi.runModelInspection 不可用')
      }
      return window.opsApi.runModelInspection()
    })()`
  )
  assertModelMonitorRendererResult(monitorResult, modelMonitorExpectation)
  return { ...smokeResult, modelMonitorChecked: true, modelMonitorProviderId: provider.id }
}

function runPackagedWindowsNotificationSmokeAssertion({
  Notification,
  platform = process.platform
} = {}) {
  if (platform !== 'win32')
    return { windowsNotificationSupported: false, windowsNotificationReady: false }
  if (!Notification || typeof Notification.isSupported !== 'function') {
    throw new Error('Electron Notification.isSupported 不可用')
  }
  if (!Notification.isSupported()) {
    throw new Error('Windows 系统通知不可用')
  }

  const notification = new Notification({
    title: 'Ops Desktop Windows 通知 smoke test',
    body: '验证 Windows 系统通知可以创建并显示。',
    silent: true
  })
  if (!notification || typeof notification.show !== 'function') {
    throw new Error('Electron Notification.show 不可用')
  }
  notification.show()
  return { windowsNotificationSupported: true, windowsNotificationReady: true }
}

function writePackagedSmokeResult(result, env = process.env, fileSystem = fs) {
  const resultPath = String(env[SMOKE_RESULT_PATH_ENV] || '').trim()
  if (!resultPath) return false
  fileSystem.writeFileSync(resultPath, `${JSON.stringify(result)}\n`, 'utf8')
  return true
}

module.exports = {
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
}
