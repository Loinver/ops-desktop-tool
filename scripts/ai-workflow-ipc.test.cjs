const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { IPC_CHANNELS } = require('../src/shared/ipc-channels')

function loadWorkflowHandler(plan) {
  const handlers = new Map()
  const opened = []
  const stub = {
    redactSensitiveText: (value) => String(value || ''),
    listProviderSources: async () => [],
    listProviders: async () => [],
    addProviderFromModelReliability: async () => ({}),
    deleteProvider: async () => [],
    activateProvider: async () => [],
    runtimeProvider: async () => ({}),
    askAiChat: async () => ({}),
    askAiChatStream: async () => ({}),
    requestCompletion: async () => ({}),
    loadEvaluationState: () => ({}),
    saveEvaluationCases: () => [],
    runEvaluation: async () => ({}),
    analyzeLogText: () => ({}),
    loadLogState: () => ({ items: [] }),
    saveLogAnalysis: () => ({}),
    loadKnowledgeState: () => ({ documents: [] }),
    saveKnowledgeDocument: () => ({}),
    deleteKnowledgeDocument: () => [],
    searchKnowledge: () => [],
    loadWorkflowState: () => ({ history: plan ? [plan] : [] }),
    findWorkflowPlan: (_userDataPath, planId) => (plan?.id === planId ? plan : null),
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
    app: { getPath: () => '/tmp/ops-ai-workflow-ipc-test' },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    shell: {},
    dialog: {},
    BrowserWindow: {}
  }
  const externalUrlMock = {
    normalizeExternalUrl: (value) => new URL(String(value)).toString(),
    openExternalUrl: async (url) => opened.push(url)
  }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronMock
    if (request === '../utils/ai-ops' && parent?.filename?.endsWith('/src/main/ipc/ai-ops.js'))
      return stub
    if (
      request === '../utils/external-url' &&
      parent?.filename?.endsWith('/src/main/ipc/ai-ops.js')
    )
      return externalUrlMock
    return originalLoad.call(this, request, parent, isMain)
  }
  let modulePath
  try {
    modulePath = require.resolve('../src/main/ipc/ai-ops.js')
    delete require.cache[modulePath]
    const { registerAiOpsHandlers } = require(modulePath)
    registerAiOpsHandlers()
    return {
      handler: handlers.get(IPC_CHANNELS.AI_WORKFLOW_EXECUTE),
      opened,
      cleanup: () => delete require.cache[modulePath]
    }
  } finally {
    Module._load = originalLoad
  }
}

const trustedPlan = {
  id: 'trusted-plan-1',
  steps: [
    {
      id: 'open-1',
      type: 'open-url',
      target: 'https://trusted.example/path',
      approval: { required: true },
      allowedExecution: 'confirmed-external-open'
    },
    {
      id: 'navigate-1',
      type: 'navigate',
      target: '/system-release',
      approval: { required: true },
      allowedExecution: 'renderer-navigation-only'
    }
  ]
}

test('AI 工作流执行只信任主进程保存的计划，并要求显式审批', async () => {
  const { handler, opened, cleanup } = loadWorkflowHandler(trustedPlan)
  try {
    assert.equal(typeof handler, 'function')
    const denied = await handler(
      {},
      {
        planId: trustedPlan.id,
        stepIds: ['open-1'],
        confirmed: false,
        plan: {
          ...trustedPlan,
          steps: [{ ...trustedPlan.steps[0], target: 'https://evil.example' }]
        }
      }
    )
    assert.equal(denied.ok, false)
    assert.match(denied.error, /明确确认/)
    assert.deepEqual(opened, [])

    const approved = await handler(
      {},
      {
        planId: trustedPlan.id,
        stepIds: ['open-1'],
        confirmed: true,
        plan: {
          ...trustedPlan,
          steps: [{ ...trustedPlan.steps[0], target: 'https://evil.example' }]
        }
      }
    )
    assert.equal(approved.ok, true)
    assert.deepEqual(opened, ['https://trusted.example/path'])
    assert.equal(approved.completed[0].target, 'https://trusted.example/path')
    assert.equal(approved.approval.audited, true)
    assert.deepEqual(approved.approval.approvedStepIds, ['open-1'])
  } finally {
    cleanup()
  }
})

test('AI 工作流逐步审批仅返回白名单页面导航，过期计划与未知步骤会被拒绝', async () => {
  const current = loadWorkflowHandler(trustedPlan)
  try {
    const approved = await current.handler(
      {},
      { planId: trustedPlan.id, stepIds: ['navigate-1'], confirmed: true }
    )
    assert.equal(approved.ok, true)
    assert.equal(approved.completed[0].status, 'requires-user-navigation')
    assert.equal(approved.completed[0].target, '/system-release')

    const unknownStep = await current.handler(
      {},
      { planId: trustedPlan.id, stepIds: ['missing-step'], confirmed: true }
    )
    assert.equal(unknownStep.ok, false)
    assert.match(unknownStep.error, /步骤无效|已过期/)
  } finally {
    current.cleanup()
  }

  const expired = loadWorkflowHandler(null)
  try {
    const result = await expired.handler({}, { planId: 'expired-plan', confirmed: true })
    assert.equal(result.ok, false)
    assert.match(result.error, /无效或已过期/)
  } finally {
    expired.cleanup()
  }
})
