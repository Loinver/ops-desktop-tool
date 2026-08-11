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

function loadHandlers() {
  const handlers = new Map()
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
  const stub = {
    redactSensitiveText: (value) => String(value || ''),
    listProviderSources: async () => [],
    listProviders: async () => [],
    addProviderFromModelReliability: async () => ({}),
    deleteProvider: async () => [],
    activateProvider: async () => [],
    runtimeProvider: async () => ({}),
    askAiChat: async () => ({}),
    askAiChatStream: aiStream,
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
    BrowserWindow: {}
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronMock
    if (request === '../utils/ai-ops' && parent?.filename?.endsWith('/src/main/ipc/ai-ops.js'))
      return stub
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const modulePath = require.resolve('../src/main/ipc/ai-ops.js')
    delete require.cache[modulePath]
    const { registerAiOpsHandlers } = require(modulePath)
    registerAiOpsHandlers()
    return { handlers, modulePath }
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
