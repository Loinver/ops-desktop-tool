const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function loadWithElectronMock(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => '/tmp/ops-gpt-image-model-source-test' },
      BrowserWindow: { fromWebContents: () => null },
      dialog: {},
      ipcMain: { handle: () => {} },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(String(value)),
        decryptString: (value) => Buffer.from(value).toString()
      }
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const { __testables } = require('../src/main/ipc/gpt-image')
Module._load = originalLoad

const testRoot = '/tmp/ops-gpt-image-model-source-test'
const configFile = path.join(testRoot, 'gpt-image-config.json')

const reliabilityConfig = {
  sourceMode: 'model-reliability',
  sourceProviderId: 'provider-1',
  sourceAppType: 'codex',
  model: 'gpt-image-compatible',
  size: '1024x1024',
  quality: 'auto'
}

function statusMap(status = 'ok') {
  return new Map([[`provider-1::codex::gpt-image-compatible`, status]])
}

function providerResult(overrides = {}) {
  return {
    ok: true,
    providers: [
      {
        id: 'provider-1',
        appType: 'codex',
        protocol: 'openai',
        baseUrl: 'https://relay.example.com/v1',
        apiKey: 'sk-model-reliability-secret',
        testable: true,
        models: [{ model: 'gpt-image-compatible' }],
        ...overrides
      }
    ]
  }
}

test('图像生成安全配置保留模型可靠性引用但不会暴露 API Key', () => {
  const safeConfig = __testables.toSafeConfig({
    ...reliabilityConfig,
    baseUrl: 'https://manual.example.com/v1',
    apiKey: 'sk-manual-secret'
  })

  assert.equal(safeConfig.sourceMode, 'model-reliability')
  assert.equal(safeConfig.sourceProviderId, 'provider-1')
  assert.equal(safeConfig.sourceAppType, 'codex')
  assert.equal(safeConfig.apiKey, '')
  assert.equal(safeConfig.hasApiKey, true)
  assert.equal(safeConfig.isReady, true)
})

test('图像生成从模型可靠性解析最近测试通过的 OpenAI Provider 凭据', async () => {
  const resolved = await __testables.resolveModelReliabilityConfig(reliabilityConfig, {
    providerLoader: async () => providerResult(),
    statusLoader: () => statusMap('ok')
  })

  assert.equal(resolved.baseUrl, 'https://relay.example.com/v1')
  assert.equal(resolved.apiKey, 'sk-model-reliability-secret')
  assert.equal(resolved.model, 'gpt-image-compatible')
})

test('图像生成拒绝未通过最近测试或非 OpenAI 协议的模型可靠性来源', async () => {
  await assert.rejects(
    __testables.resolveModelReliabilityConfig(reliabilityConfig, {
      providerLoader: async () => providerResult(),
      statusLoader: () => statusMap('error')
    }),
    /尚未通过最近一次模型测试/
  )

  await assert.rejects(
    __testables.resolveModelReliabilityConfig(reliabilityConfig, {
      providerLoader: async () => providerResult({ protocol: 'anthropic' }),
      statusLoader: () => statusMap('ok')
    }),
    /仅支持模型可靠性中的 OpenAI 兼容 Provider/
  )
})

test('旧版手动配置会迁移加密并继续用于请求', async () => {
  fs.rmSync(testRoot, { recursive: true, force: true })
  fs.mkdirSync(testRoot, { recursive: true })
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      baseUrl: 'https://legacy.example.com/v1',
      apiKey: 'sk-legacy-manual-secret',
      model: 'legacy-image-model',
      size: '1536x1024',
      quality: 'high'
    })
  )

  try {
    const loaded = __testables.readConfig()
    const safeConfig = __testables.toSafeConfig(loaded)
    const resolved = await __testables.resolveRequestConfig()

    assert.equal(loaded.sourceMode, 'manual')
    assert.equal(safeConfig.sourceMode, 'manual')
    assert.equal(safeConfig.hasApiKey, true)
    assert.equal(safeConfig.apiKey, '')
    assert.equal(resolved.baseUrl, 'https://legacy.example.com/v1')
    assert.equal(resolved.apiKey, 'sk-legacy-manual-secret')
    assert.equal(resolved.model, 'legacy-image-model')
    assert.equal(resolved.count, 1)
    assert.equal(resolved.retryCount, 1)

    const migrated = JSON.parse(fs.readFileSync(configFile, 'utf8'))
    assert.equal(migrated.sourceMode, 'manual')
    assert.equal(migrated.count, 1)
    assert.equal(migrated.retryCount, 1)
    assert.equal('apiKey' in migrated, false)
    assert.match(migrated.apiKeyEncrypted, /^safe-storage:v1:/)
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true })
  }
})

test('AI 生图费用配置会持久化并限制自定义单价与单批上限边界', () => {
  const normalized = __testables.sanitizeConfig({
    estimatedCostPerImageUsd: 9999,
    maxCostPerRequestUsd: -1,
    retryCount: 99
  })
  assert.equal(normalized.estimatedCostPerImageUsd, 1000)
  assert.equal(normalized.maxCostPerRequestUsd, 0)
  assert.equal(normalized.retryCount, 2)

  const stored = __testables.serializeConfigForStorage({
    estimatedCostPerImageUsd: 0.025,
    maxCostPerRequestUsd: 0.5
  })
  assert.equal(stored.estimatedCostPerImageUsd, 0.025)
  assert.equal(stored.maxCostPerRequestUsd, 0.5)
})

test('AI 生图同一请求标识的每次执行都会获得独立预算预留标识', () => {
  const sender = { id: 7 }
  const first = __testables.imageBudgetReservationId(sender, 'request-12345678')
  const second = __testables.imageBudgetReservationId(sender, 'request-12345678')
  assert.notEqual(first, second)
  assert.match(first, /^7:request-12345678:/)
})

test('AI 生图预算覆盖令牌绑定 Renderer 与请求指纹且只能消费一次', () => {
  const sender = { id: 42 }
  const otherSender = { id: 43 }
  const token = __testables.createImageBudgetOverride(sender, 'fingerprint-a')
  assert.equal(__testables.consumeImageBudgetOverride(otherSender, token, 'fingerprint-a'), false)

  const validToken = __testables.createImageBudgetOverride(sender, 'fingerprint-a')
  assert.equal(__testables.consumeImageBudgetOverride(sender, validToken, 'fingerprint-b'), false)

  const oneTimeToken = __testables.createImageBudgetOverride(sender, 'fingerprint-a')
  assert.equal(__testables.consumeImageBudgetOverride(sender, oneTimeToken, 'fingerprint-a'), true)
  assert.equal(__testables.consumeImageBudgetOverride(sender, oneTimeToken, 'fingerprint-a'), false)
})
