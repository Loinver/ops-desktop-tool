const CCSWITCH_EXPECTATION_ENV = 'OPS_DESKTOP_SMOKE_CCSWITCH_EXPECTED'

function readCcSwitchExpectation(env = process.env) {
  const raw = String(env[CCSWITCH_EXPECTATION_ENV] || '').trim()
  if (!raw) return null

  try {
    const expectation = JSON.parse(raw)
    if (!expectation || typeof expectation !== 'object') throw new Error('配置必须是对象')
    return expectation
  } catch (error) {
    throw new Error(`无法解析 CC Switch smoke test 预期配置：${error.message}`, { cause: error })
  }
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

async function runPackagedRendererSmokeAssertions(webContents, env = process.env) {
  const expectation = readCcSwitchExpectation(env)
  if (!expectation) return { ccSwitchChecked: false }

  const result = await webContents.executeJavaScript(
    `(() => {
      if (!window.opsApi || typeof window.opsApi.listModelProviders !== 'function') {
        throw new Error('window.opsApi.listModelProviders 不可用')
      }
      return window.opsApi.listModelProviders()
    })()`
  )
  const provider = assertCcSwitchRendererResult(result, expectation)
  return { ccSwitchChecked: true, providerId: provider.id }
}

module.exports = {
  CCSWITCH_EXPECTATION_ENV,
  assertCcSwitchRendererResult,
  readCcSwitchExpectation,
  runPackagedRendererSmokeAssertions
}
