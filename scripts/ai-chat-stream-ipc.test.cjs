const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const Module = require('node:module')
const { IPC_CHANNELS } = require('../src/shared/ipc-channels')

function makeSender(id) {
  const sender = new EventEmitter()
  sender.id = id
  sender.isDestroyed = () => false
  sender.events = []
  sender.send = (_channel, payload) => sender.events.push(payload)
  return sender
}

function loadHandlers({ askAiChatStream } = {}) {
  const handlers = new Map()
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
      return { allowed: true }
    },
    recordAiUsage: (_userDataPath, input) => {
      captures.usageRecords.push(input)
      return { id: 'usage-1' }
    }
  }
  const stub = {
    redactSensitiveText: (value) => String(value || ''),
    listProviderSources: async () => [],
    listProviders: async () => [],
    addProviderFromModelReliability: async () => ({}),
    deleteProvider: async () => [],
    activateProvider: async () => [],
    runtimeProvider: async () => ({ id: 'provider-1', name: 'Test Provider', model: 'model-1' }),
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
    app: { getPath: () => '/tmp/ops-ai-stream-ipc-test' },
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
    if (request === '../utils/ai-image-evidence' && parent?.filename?.endsWith('/src/main/ipc/ai-ops.js'))
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
    return { handlers, captures, modulePath }
  } finally {
    Module._load = originalLoad
  }
}

test('AI 对话流式 IPC 会向同一 Renderer 推送增量并支持按请求取消', async () => {
  const { handlers, modulePath } = loadHandlers()
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
})

test('AI 对话流式 IPC 只按当前 Renderer 的图片证据标识解析，并记录为未知多模态费用', async () => {
  const { handlers, captures, modulePath } = loadHandlers({
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
})
