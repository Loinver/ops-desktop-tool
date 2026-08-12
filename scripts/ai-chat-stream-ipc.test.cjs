const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { IPC_CHANNELS } = require('../src/shared/ipc-channels')

function makeSender(id) {
  const sender = new EventEmitter()
  sender.id = id
  sender.isDestroyed = () => false
  sender.events = []
  sender.send = (_channel, payload) => sender.events.push(payload)
  return sender
}

function loadHandlers({
  askAiChatStream,
  routingEnabled = false,
  runtimeProviders,
  budgetResult
} = {}) {
  const handlers = new Map()
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-ai-stream-ipc-'))
  const providers = runtimeProviders || [
    {
      id: 'provider-1',
      name: 'Test Provider',
      model: 'model-1',
      baseUrl: 'https://api.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    }
  ]
  if (routingEnabled) {
    const { saveProviderRoutingSettings } = require('../src/main/utils/ai-provider-routing')
    saveProviderRoutingSettings(userDataPath, {
      enabled: true,
      preferLocal: false,
      maxAttempts: 3,
      cooldownMinutes: 5
    })
  }
  const captures = {
    streamCalls: [],
    resolvedImageIds: [],
    clearedImageSenders: [],
    budgetChecks: [],
    usageRecords: []
  }
  const aiStream = ({ signal, onDelta }) =>
    new Promise((_resolve, reject) => {
      onDelta('partial answer')
      signal.addEventListener(
        'abort',
        () => {
          const error = new Error('AI 请求已取消')
          error.code = 'AI_CHAT_CANCELLED'
          reject(error)
        },
        { once: true }
      )
    })
  const aiImageEvidence = {
    MAX_IMAGE_COUNT: 4,
    importImageEvidence: async () => [],
    listImageEvidence: () => [],
    removeImageEvidence: () => false,
    clearImageEvidence: (sender) => captures.clearedImageSenders.push(sender.id),
    resolveImageEvidence: (sender, id) => {
      captures.resolvedImageIds.push({ senderId: sender.id, id })
      if (id !== '11111111-1111-4111-8111-111111111111') {
        throw new Error('图片证据不存在或已过期')
      }
      return {
        id,
        name: 'release-error.png',
        mimeType: 'image/png',
        data: 'aGVsbG8=',
        width: 640,
        height: 480,
        sizeBytes: 5
      }
    }
  }
  const aiUsage = {
    getAiUsageState: () => ({}),
    saveAiUsageSettings: () => ({}),
    checkAiUsageBudget: (_userDataPath, input) => {
      captures.budgetChecks.push(input)
      return budgetResult || { allowed: true }
    },
    recordAiUsage: (_userDataPath, input) => {
      captures.usageRecords.push(input)
      return { id: 'usage-1' }
    }
  }
  const stub = {
    redactSensitiveText: (value) => String(value || ''),
    listProviderSources: async () => [],
    listProviders: async () => providers,
    addProviderFromModelReliability: async () => ({}),
    deleteProvider: async () => [],
    activateProvider: async () => [],
    runtimeProvider: async ({ providerId } = {}) =>
      providers.find((provider) => provider.id === providerId) || providers[0],
    runtimeProviderCandidates: async ({ providerId } = {}) => ({
      requestedProviderId: providerId || providers[0].id,
      providers,
      requestedError: null
    }),
    askAiChat: async () => ({}),
    askAiChatStream: async (input) => {
      captures.streamCalls.push(input)
      return askAiChatStream ? askAiChatStream(input) : aiStream(input)
    },
    requestCompletion: async () => ({}),
    loadEvaluationState: () => ({}),
    saveEvaluationCases: () => [],
    runEvaluation: async () => ({}),
    analyzeLogText: async () => ({}),
    loadLogState: () => ({ items: [] }),
    saveLogAnalysis: () => ({}),
    loadKnowledgeState: () => ({ items: [] }),
    saveKnowledgeDocument: () => ({}),
    deleteKnowledgeDocument: () => [],
    searchKnowledge: () => [],
    loadWorkflowState: () => ({ history: [] }),
    planWorkflow: () => ({}),
    saveWorkflowPlan: () => ({}),
    addOpsEvent: () => ({}),
    deleteAutomationTask: () => [],
    eventSummary: () => ({}),
    listAutomationTasks: () => [],
    listOpsEvents: () => [],
    markOpsEventsRead: () => ({}),
    runAutomationTask: async () => ({}),
    runDueAutomationTasks: async () => ({}),
    saveAutomationTask: () => ({})
  }
  const electronMock = {
    app: { getPath: () => userDataPath },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    shell: {},
    dialog: {},
    BrowserWindow: {},
    nativeImage: {}
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronMock
    if (request === '../utils/ai-ops' && parent?.filename?.endsWith('/src/main/ipc/ai-ops.js'))
      return stub
    if (
      request === '../utils/ai-image-evidence' &&
      parent?.filename?.endsWith('/src/main/ipc/ai-ops.js')
    )
      return aiImageEvidence
    if (request === '../utils/ai-usage' && parent?.filename?.endsWith('/src/main/ipc/ai-ops.js'))
      return aiUsage
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const modulePath = require.resolve('../src/main/ipc/ai-ops.js')
    delete require.cache[modulePath]
    const { registerAiOpsHandlers } = require(modulePath)
    registerAiOpsHandlers()
    return { handlers, captures, modulePath, userDataPath }
  } finally {
    Module._load = originalLoad
  }
}

test('AI 对话流式 IPC 会向同一 Renderer 推送增量并支持按请求取消', async () => {
  const { handlers, modulePath, userDataPath } = loadHandlers()
  const sender = makeSender(42)
  const requestId = 'request-123456'
  const start = handlers.get(IPC_CHANNELS.AI_CHAT_STREAM_START)
  const cancel = handlers.get(IPC_CHANNELS.AI_CHAT_STREAM_CANCEL)
  assert.equal(typeof start, 'function')
  assert.equal(typeof cancel, 'function')

  const pending = start({ sender }, { requestId })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(sender.events, [
    {
      requestId,
      type: 'delta',
      delta: 'partial answer'
    }
  ])

  const otherSender = makeSender(43)
  assert.deepEqual(await cancel({ sender: otherSender }, { requestId }), {
    ok: true,
    requestId,
    cancelled: false
  })

  const cancelled = await cancel({ sender }, { requestId })
  assert.deepEqual(cancelled, { ok: true, requestId, cancelled: true })
  assert.deepEqual(await pending, {
    ok: false,
    cancelled: true,
    requestId,
    error: '已停止生成'
  })

  delete require.cache[modulePath]
  fs.rmSync(userDataPath, { recursive: true, force: true })
})

test('AI 对话流式 IPC 只按当前 Renderer 的图片证据标识解析，并记录为未知多模态费用', async () => {
  const { handlers, captures, modulePath, userDataPath } = loadHandlers({
    askAiChatStream: async () => ({
      content: '已分析截图中的发布错误。',
      model: 'model-1',
      truncated: false,
      usage: { inputTokens: 12, outputTokens: 8 }
    })
  })
  const sender = makeSender(88)
  const requestId = 'request-654321'
  const evidenceId = '11111111-1111-4111-8111-111111111111'
  const start = handlers.get(IPC_CHANNELS.AI_CHAT_STREAM_START)

  const result = await start(
    { sender },
    {
      requestId,
      messages: [{ role: 'user', content: '请分析发布失败原因' }],
      imageEvidenceIds: [evidenceId]
    }
  )

  assert.equal(result.ok, true)
  assert.deepEqual(captures.resolvedImageIds, [{ senderId: 88, id: evidenceId }])
  assert.deepEqual(captures.streamCalls[0].imageEvidence, [
    {
      id: evidenceId,
      name: 'release-error.png',
      mimeType: 'image/png',
      data: 'aGVsbG8=',
      width: 640,
      height: 480,
      sizeBytes: 5
    }
  ])
  assert.equal(captures.budgetChecks[0].costKnown, false)
  assert.equal(captures.usageRecords[0].costKnown, false)
  assert.equal(captures.usageRecords[0].costSource, 'multimodal-usage-unknown')
  assert.doesNotMatch(captures.usageRecords[0].inputText, /aGVsbG8=/)
  assert.deepEqual(captures.clearedImageSenders, [88])
  assert.deepEqual(sender.events.at(-1), {
    requestId,
    type: 'done',
    model: 'model-1',
    truncated: false,
    usage: { inputTokens: 12, outputTokens: 8 }
  })

  delete require.cache[modulePath]
  fs.rmSync(userDataPath, { recursive: true, force: true })
})

test('AI 对话流式 IPC 会在首个 Provider 输出前失败时切换，并按实际 Provider 记账', async () => {
  const runtimeProviders = [
    {
      id: 'provider-primary',
      name: 'Primary Provider',
      model: 'model-primary',
      baseUrl: 'https://primary.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    },
    {
      id: 'provider-fallback',
      name: 'Fallback Provider',
      model: 'model-fallback',
      baseUrl: 'https://fallback.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    }
  ]
  const { handlers, captures, modulePath, userDataPath } = loadHandlers({
    routingEnabled: true,
    runtimeProviders,
    askAiChatStream: async (input) => {
      if (input.provider.id === 'provider-primary') {
        const error = new Error('上游连接失败')
        error.code = 'AI_PROVIDER_NETWORK_ERROR'
        throw error
      }
      input.onDelta('fallback answer')
      return {
        content: 'fallback answer',
        model: 'model-fallback',
        truncated: false,
        usage: { inputTokens: 5, outputTokens: 3 }
      }
    }
  })
  const sender = makeSender(99)
  const requestId = 'request-failover-123'
  const start = handlers.get(IPC_CHANNELS.AI_CHAT_STREAM_START)

  const result = await start(
    { sender },
    {
      requestId,
      providerId: 'provider-primary',
      messages: [{ role: 'user', content: '检查自动故障转移' }]
    }
  )

  assert.equal(result.ok, true)
  assert.deepEqual(
    captures.streamCalls.map((item) => item.provider.id),
    ['provider-primary', 'provider-fallback']
  )
  assert.deepEqual(
    captures.budgetChecks.map((item) => item.providerId),
    ['provider-primary', 'provider-fallback']
  )
  assert.equal(captures.usageRecords.length, 1)
  assert.equal(captures.usageRecords[0].providerId, 'provider-fallback')
  assert.equal(result.route.failover, true)
  assert.deepEqual(result.route.attemptedProviderIds, ['provider-primary', 'provider-fallback'])
  assert.equal(result.route.providerId, 'provider-fallback')
  assert.equal(result.route.providerName, 'Fallback Provider')
  assert.deepEqual(sender.events, [
    { requestId, type: 'delta', delta: 'fallback answer' },
    {
      requestId,
      type: 'done',
      model: 'model-fallback',
      truncated: false,
      usage: { inputTokens: 5, outputTokens: 3 }
    }
  ])

  delete require.cache[modulePath]
  fs.rmSync(userDataPath, { recursive: true, force: true })
})

test('AI Provider 路由 IPC 返回的 routing payload 不泄漏敏感字段', async () => {
  const sensitiveValues = {
    apiKey: 'sk-routing-secret-123',
    authorization: 'Bearer routing-secret-456',
    prompt: '内部提示词 routing-prompt-secret',
    response: '上游响应 routing-response-secret',
    error: '上游原始错误 routing-error-secret'
  }
  const runtimeProviders = [
    {
      id: 'provider-sensitive',
      name: 'Sanitized Provider',
      model: 'model-sensitive',
      baseUrl: 'https://sensitive.example.com/v1',
      protocolLabel: 'OpenAI 兼容',
      apiKey: sensitiveValues.apiKey,
      Authorization: sensitiveValues.authorization,
      prompt: sensitiveValues.prompt,
      response: sensitiveValues.response,
      errorMessage: sensitiveValues.error
    }
  ]
  const { handlers, modulePath, userDataPath } = loadHandlers({ runtimeProviders })
  fs.writeFileSync(
    path.join(userDataPath, 'ai-provider-routing.json'),
    JSON.stringify({
      version: 1,
      settings: {
        enabled: false,
        preferLocal: true,
        maxAttempts: 2,
        cooldownMinutes: 5,
        apiKey: sensitiveValues.apiKey,
        Authorization: sensitiveValues.authorization,
        prompt: sensitiveValues.prompt,
        response: sensitiveValues.response,
        errorMessage: sensitiveValues.error
      },
      health: {
        'provider-sensitive': {
          consecutiveFailures: 1,
          lastErrorCode: 'AI_PROVIDER_NETWORK_ERROR',
          errorMessage: sensitiveValues.error,
          prompt: sensitiveValues.prompt,
          response: sensitiveValues.response
        }
      },
      routeHistory: [
        {
          providerId: 'provider-sensitive',
          outcome: 'failure',
          attempt: 1,
          index: 0,
          switched: false,
          errorCode: 'AI_PROVIDER_NETWORK_ERROR',
          apiKey: sensitiveValues.apiKey,
          Authorization: sensitiveValues.authorization,
          prompt: sensitiveValues.prompt,
          response: sensitiveValues.response,
          errorMessage: sensitiveValues.error
        }
      ]
    })
  )

  const assertSafeRoutingPayload = (result) => {
    assert.equal(result.ok, true)
    const serialized = JSON.stringify(result.routing)
    assert.doesNotMatch(serialized, /apiKey|authorization|prompt|response/i)
    for (const value of Object.values(sensitiveValues)) {
      assert.doesNotMatch(serialized, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  }

  const getState = handlers.get(IPC_CHANNELS.AI_OPS_GET_STATE)
  const saveRouting = handlers.get(IPC_CHANNELS.AI_PROVIDER_ROUTING_SAVE)
  const resetRouting = handlers.get(IPC_CHANNELS.AI_PROVIDER_ROUTING_RESET)

  assertSafeRoutingPayload(await getState())
  assertSafeRoutingPayload(
    await saveRouting(
      {},
      {
        enabled: true,
        apiKey: sensitiveValues.apiKey,
        Authorization: sensitiveValues.authorization,
        prompt: sensitiveValues.prompt,
        response: sensitiveValues.response,
        errorMessage: sensitiveValues.error
      }
    )
  )
  assertSafeRoutingPayload(await resetRouting())

  delete require.cache[modulePath]
  fs.rmSync(userDataPath, { recursive: true, force: true })
})

test('AI 对话流式 IPC 在已产生增量后失败不会切换，也不会重复完成事件', async () => {
  const runtimeProviders = [
    {
      id: 'provider-partial-primary',
      name: 'Partial Primary',
      model: 'model-primary',
      baseUrl: 'https://partial-primary.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    },
    {
      id: 'provider-partial-fallback',
      name: 'Partial Fallback',
      model: 'model-fallback',
      baseUrl: 'https://partial-fallback.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    }
  ]
  const { handlers, captures, modulePath, userDataPath } = loadHandlers({
    routingEnabled: true,
    runtimeProviders,
    askAiChatStream: async (input) => {
      input.onDelta('partial answer')
      const error = new Error('增量输出后上游断开')
      error.code = 'AI_PROVIDER_NETWORK_ERROR'
      throw error
    }
  })
  const sender = makeSender(101)
  const result = await handlers.get(IPC_CHANNELS.AI_CHAT_STREAM_START)(
    { sender },
    {
      requestId: 'request-partial-failure',
      providerId: 'provider-partial-primary',
      messages: [{ role: 'user', content: '验证增量输出安全边界' }]
    }
  )

  assert.equal(result.ok, false)
  assert.equal(result.code, 'AI_PROVIDER_ROUTE_PARTIAL_OUTPUT')
  assert.equal(result.retryable, true)
  assert.equal(result.route.stoppedReason, 'partial-output')
  assert.deepEqual(
    captures.streamCalls.map((item) => item.provider.id),
    ['provider-partial-primary']
  )
  assert.equal(captures.usageRecords.length, 0)
  assert.deepEqual(sender.events, [
    { requestId: 'request-partial-failure', type: 'delta', delta: 'partial answer' }
  ])

  delete require.cache[modulePath]
  fs.rmSync(userDataPath, { recursive: true, force: true })
})

test('AI 对话流式 IPC 遇到不可重试的 HTTP 400 时保留原 Provider，不写入故障转移', async () => {
  const runtimeProviders = [
    {
      id: 'provider-http-primary',
      name: 'HTTP Primary',
      model: 'model-primary',
      baseUrl: 'https://http-primary.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    },
    {
      id: 'provider-http-fallback',
      name: 'HTTP Fallback',
      model: 'model-fallback',
      baseUrl: 'https://http-fallback.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    }
  ]
  const { handlers, captures, modulePath, userDataPath } = loadHandlers({
    routingEnabled: true,
    runtimeProviders,
    askAiChatStream: async () => {
      const error = new Error('请求参数或上下文不兼容')
      error.code = 'AI_PROVIDER_HTTP_ERROR'
      error.status = 400
      throw error
    }
  })
  const sender = makeSender(102)
  const result = await handlers.get(IPC_CHANNELS.AI_CHAT_STREAM_START)(
    { sender },
    {
      requestId: 'request-http-400',
      providerId: 'provider-http-primary',
      messages: [{ role: 'user', content: '验证 HTTP 400 安全边界' }]
    }
  )

  assert.equal(result.ok, false)
  assert.equal(result.code, 'AI_PROVIDER_HTTP_ERROR')
  assert.equal(result.retryable, false)
  assert.deepEqual(
    captures.streamCalls.map((item) => item.provider.id),
    ['provider-http-primary']
  )
  assert.equal(captures.usageRecords.length, 0)
  assert.deepEqual(sender.events, [])
  const routingState = JSON.parse(
    fs.readFileSync(path.join(userDataPath, 'ai-provider-routing.json'), 'utf8')
  )
  assert.equal(routingState.health['provider-http-primary'], undefined)

  delete require.cache[modulePath]
  fs.rmSync(userDataPath, { recursive: true, force: true })
})

test('AI 对话流式 IPC 路由关闭时只调用显式指定的 Provider', async () => {
  const runtimeProviders = [
    {
      id: 'provider-direct-primary',
      name: 'Direct Primary',
      model: 'model-primary',
      baseUrl: 'https://direct-primary.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    },
    {
      id: 'provider-direct-requested',
      name: 'Direct Requested',
      model: 'model-requested',
      baseUrl: 'https://direct-requested.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    }
  ]
  const { handlers, captures, modulePath, userDataPath } = loadHandlers({
    runtimeProviders,
    askAiChatStream: async (input) => ({
      content: `来自 ${input.provider.id}`,
      model: input.provider.model,
      truncated: false,
      usage: { inputTokens: 1, outputTokens: 1 }
    })
  })
  const sender = makeSender(103)
  const result = await handlers.get(IPC_CHANNELS.AI_CHAT_STREAM_START)(
    { sender },
    {
      requestId: 'request-routing-disabled',
      providerId: 'provider-direct-requested',
      messages: [{ role: 'user', content: '验证默认关闭兼容性' }]
    }
  )

  assert.equal(result.ok, true)
  assert.deepEqual(
    captures.streamCalls.map((item) => item.provider.id),
    ['provider-direct-requested']
  )
  assert.equal(result.route.enabled, false)
  assert.equal(result.route.failover, false)
  assert.deepEqual(sender.events, [
    {
      requestId: 'request-routing-disabled',
      type: 'done',
      model: 'model-requested',
      truncated: false,
      usage: { inputTokens: 1, outputTokens: 1 }
    }
  ])

  delete require.cache[modulePath]
  fs.rmSync(userDataPath, { recursive: true, force: true })
})

test('AI 对话流式 IPC 预算拒绝时不调用 Provider，也不触发备用 Provider', async () => {
  const runtimeProviders = [
    {
      id: 'provider-budget-primary',
      name: 'Budget Primary',
      model: 'model-primary',
      baseUrl: 'https://budget-primary.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    },
    {
      id: 'provider-budget-fallback',
      name: 'Budget Fallback',
      model: 'model-fallback',
      baseUrl: 'https://budget-fallback.example.com/v1',
      protocolLabel: 'OpenAI 兼容'
    }
  ]
  const { handlers, captures, modulePath, userDataPath } = loadHandlers({
    routingEnabled: true,
    runtimeProviders,
    budgetResult: {
      allowed: false,
      code: 'AI_USAGE_BUDGET_EXCEEDED',
      reason: '已达到 AI 使用预算'
    },
    askAiChatStream: async () => {
      throw new Error('不应调用 Provider')
    }
  })
  const sender = makeSender(104)
  const result = await handlers.get(IPC_CHANNELS.AI_CHAT_STREAM_START)(
    { sender },
    {
      requestId: 'request-budget-blocked',
      providerId: 'provider-budget-primary',
      messages: [{ role: 'user', content: '验证预算阻断' }]
    }
  )

  assert.equal(result.ok, false)
  assert.equal(result.code, 'AI_USAGE_BUDGET_EXCEEDED')
  assert.deepEqual(
    captures.budgetChecks.map((item) => item.providerId),
    ['provider-budget-primary']
  )
  assert.deepEqual(captures.streamCalls, [])
  assert.equal(captures.usageRecords.length, 0)
  assert.deepEqual(sender.events, [])
  const routingState = JSON.parse(
    fs.readFileSync(path.join(userDataPath, 'ai-provider-routing.json'), 'utf8')
  )
  assert.equal(routingState.health['provider-budget-primary'], undefined)

  delete require.cache[modulePath]
  fs.rmSync(userDataPath, { recursive: true, force: true })
})
