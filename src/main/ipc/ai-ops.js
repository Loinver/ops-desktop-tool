const path = require('node:path')
const fs = require('node:fs')
const { app, ipcMain, shell, dialog, BrowserWindow, nativeImage } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { readJsonFile } = require('../utils/json-store')
const { readQuickLaunchState } = require('../utils/quicklaunch-storage')
const { normalizeExternalUrl, openExternalUrl } = require('../utils/external-url')
const { listNodeServiceHistory } = require('../utils/node-service-monitor')
const { listRunbookHistory } = require('../utils/ops-runbook')
const { loadReleaseHistory } = require('../utils/release-store')
const {
  buildCopilotTimeline,
  buildReleaseRiskSummary,
  formatCopilotTimeline
} = require('../utils/ai-insights')
const { buildIncidentPostmortem, buildOpsReport } = require('../utils/ai-reports')
const {
  MAX_IMAGE_COUNT,
  importImageEvidence,
  resolveImageEvidence,
  listImageEvidence,
  removeImageEvidence,
  clearImageEvidence
} = require('../utils/ai-image-evidence')
const {
  getAiUsageState,
  saveAiUsageSettings,
  checkAiUsageBudget,
  recordAiUsage
} = require('../utils/ai-usage')
const {
  redactSensitiveText,
  listProviderSources,
  listProviders,
  addProviderFromModelReliability,
  deleteProvider,
  activateProvider,
  runtimeProvider,
  runtimeProviderCandidates,
  askAiChat,
  askAiChatStream,
  requestCompletion,
  loadEvaluationState,
  saveEvaluationCases,
  runEvaluation,
  analyzeLogText,
  loadLogState,
  saveLogAnalysis,
  loadKnowledgeState,
  saveKnowledgeDocument,
  deleteKnowledgeDocument,
  importKnowledgeDirectory,
  searchKnowledge,
  loadWorkflowState,
  findWorkflowPlan,
  planWorkflow,
  saveWorkflowPlan
} = require('../utils/ai-ops')
const {
  executeProviderRoute,
  isLoopbackProvider,
  loadProviderRoutingState,
  resetProviderRoutingHealth,
  saveProviderRoutingSettings
} = require('../utils/ai-provider-routing')
const {
  addOpsEvent,
  deleteAutomationTask,
  eventSummary,
  listAutomationTasks,
  listOpsEvents,
  markOpsEventsRead,
  runAutomationTask,
  runDueAutomationTasks,
  saveAutomationTask,
  updateOpsEvent
} = require('../utils/ops-automation')

let automationTimer = null
const activeChatStreams = new Map()
const imageEvidenceCleanupSenders = new WeakSet()

function userDataPath() {
  return app.getPath('userData')
}
function success(value = {}) {
  return { ok: true, ...value }
}
function failure(error) {
  const result = {
    ok: false,
    error: error instanceof Error ? error.message : 'AI 运维操作失败'
  }
  if (error?.code) result.code = String(error.code).slice(0, 120)
  if (error?.budget) result.budget = error.budget
  if (error?.route) result.route = error.route
  return result
}

function imageEvidenceUsageSummary(imageEvidence = []) {
  return (Array.isArray(imageEvidence) ? imageEvidence : []).map((item) => ({
    id: String(item?.id || '').slice(0, 100),
    name: redactSensitiveText(String(item?.name || '图片证据')).slice(0, 160),
    mimeType: String(item?.mimeType || '').slice(0, 40),
    width: Math.max(0, Number(item?.width) || 0),
    height: Math.max(0, Number(item?.height) || 0),
    sizeBytes: Math.max(0, Number(item?.sizeBytes) || 0)
  }))
}

function chatUsageInput(options = {}, imageEvidence = []) {
  return JSON.stringify({
    messages: Array.isArray(options.messages) ? options.messages : [],
    knowledgeResults: Array.isArray(options.knowledgeResults) ? options.knowledgeResults : [],
    contextAttachments: Array.isArray(options.contextAttachments) ? options.contextAttachments : [],
    imageEvidence: imageEvidenceUsageSummary(imageEvidence)
  }).slice(0, 80_000)
}

function ensureChatBudget(provider, options = {}, imageEvidence = []) {
  const hasImages = imageEvidence.length > 0
  const budget = checkAiUsageBudget(userDataPath(), {
    providerId: provider.id,
    model: provider.model,
    override: options.budgetOverride === true,
    ...(hasImages ? { costKnown: false } : {})
  })
  if (budget.allowed) return budget
  const error = new Error(budget.reason)
  error.code = budget.code
  error.budget = budget
  throw error
}

function recordChatUsage(provider, result, options = {}, imageEvidence = []) {
  const hasImages = imageEvidence.length > 0
  return recordAiUsage(userDataPath(), {
    providerId: provider.id,
    providerName: provider.name,
    model: result.model || provider.model,
    usage: result.usage,
    inputText: chatUsageInput(options, imageEvidence),
    outputText: result.content,
    ...(hasImages ? { costKnown: false, costSource: 'multimodal-usage-unknown' } : {})
  })
}

function bindImageEvidenceCleanup(sender) {
  if (!sender || imageEvidenceCleanupSenders.has(sender)) return
  imageEvidenceCleanupSenders.add(sender)
  sender.once?.('destroyed', () => clearImageEvidence(sender))
}

function resolveImageEvidenceIds(sender, value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('图片证据标识无效')
  if (value.length > MAX_IMAGE_COUNT) {
    throw new Error(`每次对话最多附加 ${MAX_IMAGE_COUNT} 张图片证据`)
  }
  const ids = []
  const seen = new Set()
  for (const item of value) {
    const id = String(item || '').trim()
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids.map((id) => resolveImageEvidence(sender, id))
}

function safeRoutingState(providerState) {
  const state = loadProviderRoutingState(userDataPath())
  const providers = Array.isArray(providerState?.providers) ? providerState.providers : []
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const now = Date.now()
  return {
    version: state.version,
    settings: state.settings,
    health: Object.entries(state.health || {}).map(([providerId, item]) => {
      const provider = providerById.get(providerId)
      return {
        providerId,
        providerName: provider?.name || '已移除 Provider',
        model: provider?.model || '',
        local: Boolean(provider && isLoopbackProvider(provider)),
        consecutiveFailures: Math.max(0, Number(item?.consecutiveFailures) || 0),
        cooldownUntil: Number(item?.cooldownUntil) || 0,
        cooling: Number(item?.cooldownUntil) > now,
        lastFailureAt: Number(item?.lastFailureAt) || 0,
        lastSuccessAt: Number(item?.lastSuccessAt) || 0,
        lastErrorCode: String(item?.lastErrorCode || '').slice(0, 80)
      }
    }),
    recentRoutes: (Array.isArray(state.routeHistory) ? state.routeHistory : [])
      .slice(-12)
      .reverse()
      .map((item) => {
        const provider = providerById.get(item.providerId)
        return {
          ...item,
          providerName: provider?.name || '已移除 Provider',
          model: provider?.model || '',
          local: Boolean(provider && isLoopbackProvider(provider))
        }
      })
  }
}

function safeRouteResult(routed) {
  const provider = routed.provider
  return {
    ...routed.route,
    providerId: provider.id,
    providerName: provider.name,
    model: routed.result?.model || provider.model,
    protocolLabel: provider.protocolLabel || '',
    local: isLoopbackProvider(provider)
  }
}

function isRouteCancellation(error, signal) {
  return (
    signal?.aborted ||
    ['AI_CHAT_CANCELLED', 'AI_PROVIDER_ROUTE_CANCELLED'].includes(String(error?.code || ''))
  )
}

function isRetryableProviderError(error) {
  const code = String(error?.code || '')
  if (code.startsWith('AI_USAGE_') || code === 'AI_CHAT_CANCELLED') return false
  if (code === 'AI_PROVIDER_HTTP_ERROR') {
    const status = Math.max(0, Number(error?.status) || 0)
    return status === 0 || [408, 425, 429].includes(status) || status >= 500
  }
  return [
    'AI_PROVIDER_NETWORK_ERROR',
    'AI_PROVIDER_TIMEOUT',
    'AI_PROVIDER_EMPTY_RESPONSE'
  ].includes(code)
}

async function executeRoutedProviderRequest({
  providerId,
  execute,
  beforeAttempt,
  signal,
  hasPartialOutput
}) {
  const currentUserDataPath = userDataPath()
  const routingState = loadProviderRoutingState(currentUserDataPath)
  const resolved =
    typeof runtimeProviderCandidates === 'function'
      ? await runtimeProviderCandidates({ userDataPath: currentUserDataPath, providerId })
      : await runtimeProvider({ userDataPath: currentUserDataPath, providerId }).then(
          (provider) => ({
            requestedProviderId: provider.id,
            providers: [provider],
            requestedError: null
          })
        )
  if (!routingState.settings.enabled) {
    if (resolved.requestedError) throw resolved.requestedError
    const provider =
      resolved.providers.find((item) => item.id === resolved.requestedProviderId) ||
      resolved.providers[0]
    if (!provider) throw new Error('没有可用的 AI Provider')
    if (typeof beforeAttempt === 'function') await beforeAttempt(provider)
    const result = await execute(provider)
    const routed = {
      provider,
      result,
      route: {
        enabled: false,
        requestedProviderId: resolved.requestedProviderId || provider.id,
        attemptedProviderIds: [provider.id],
        attemptCount: 1,
        maxAttempts: 1,
        selectedProviderId: provider.id,
        failover: false,
        stoppedReason: 'routing-disabled'
      }
    }
    return { ...routed, route: safeRouteResult(routed) }
  }

  const routed = await executeProviderRoute({
    userDataPath: currentUserDataPath,
    state: routingState,
    settings: routingState.settings,
    candidates: resolved.providers,
    requestedProviderId: resolved.requestedProviderId,
    execute,
    beforeAttempt,
    isCancelled: ({ error } = {}) => isRouteCancellation(error, signal),
    hasPartialOutput,
    canFailover: ({ error } = {}) => isRetryableProviderError(error),
    preserveError: ({ error } = {}) => !isRetryableProviderError(error),
    shouldRecordFailure: ({ error } = {}) => isRetryableProviderError(error)
  })
  return { ...routed, route: safeRouteResult(routed) }
}

async function safeState() {
  const providers = await listProviders({ userDataPath: userDataPath() })
  return {
    providers,
    routing: safeRoutingState(providers),
    evaluations: loadEvaluationState(userDataPath()),
    logs: loadLogState(userDataPath()),
    knowledge: loadKnowledgeState(userDataPath()),
    workflows: loadWorkflowState(userDataPath()),
    events: {
      items: listOpsEvents(userDataPath(), { limit: 100 }),
      summary: eventSummary(userDataPath())
    },
    automation: { tasks: listAutomationTasks(userDataPath()) }
  }
}

function startAutomationTimer() {
  if (automationTimer) return
  automationTimer = setInterval(() => {
    runDueAutomationTasks(userDataPath()).catch((error) => console.error('自动化巡检失败:', error))
  }, 60_000)
  automationTimer.unref?.()
}

function normalizeChatStreamRequestId(value) {
  const requestId = String(value || '').trim()
  if (!/^[a-zA-Z0-9:_-]{8,120}$/.test(requestId)) throw new Error('AI 对话请求标识无效')
  return requestId
}

function chatStreamKey(sender, requestId) {
  return `${sender?.id || 'renderer'}:${requestId}`
}

function sendChatStreamEvent(sender, payload) {
  if (!sender || sender.isDestroyed?.()) return
  sender.send(IPC_CHANNELS.AI_CHAT_STREAM_EVENT, payload)
}

function copilotContext(prompt) {
  const knowledge = searchKnowledge(userDataPath(), prompt, 5)
  const events = listOpsEvents(userDataPath(), { limit: 12 })
  const logs = loadLogState(userDataPath()).items.slice(0, 5)
  const timeline = buildCopilotTimeline({
    events,
    logs,
    releases: loadReleaseHistory().slice(0, 20),
    nodeHistory: listNodeServiceHistory(userDataPath(), { limit: 200 }),
    runbooks: listRunbookHistory(userDataPath(), { limit: 20 }),
    redact: redactSensitiveText,
    limit: 60
  })
  return {
    knowledge,
    timeline,
    text: [
      `近期事件：${events.map((item) => `[${item.level}/${item.status}] ${item.title}：${item.description}`).join('\n') || '无'}`,
      `近期日志分析：${logs.map((item) => `[${item.level}] ${item.title}：${item.headline}`).join('\n') || '无'}`,
      formatCopilotTimeline(timeline),
      `知识证据：${knowledge.map((item, index) => `[${index + 1}] ${item.title}（第 ${item.startLine}-${item.endLine} 行）\n${item.content}`).join('\n\n') || '无'}`
    ]
      .join('\n\n')
      .slice(0, 30_000)
  }
}

async function generateOptionalAnalysis({ providerId, prompt }) {
  const routed = await executeRoutedProviderRequest({
    providerId,
    execute: (provider) =>
      requestCompletion(provider, {
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              '你是谨慎的运维分析助手。仅根据给出的脱敏材料给出结论，区分事实、推测和建议；禁止输出密钥、密码或破坏性命令。'
          },
          { role: 'user', content: prompt }
        ]
      })
  })
  return redactSensitiveText(routed.result.content)
}

function registerAiOpsHandlers() {
  startAutomationTimer()
  ipcMain.handle(IPC_CHANNELS.AI_OPS_GET_STATE, async () => {
    try {
      return success(await safeState())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_SOURCE_LIST, async () => {
    try {
      return success({ sources: await listProviderSources({ userDataPath: userDataPath() }) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_USAGE_GET, async () => {
    try {
      return success({ usage: getAiUsageState(userDataPath()) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_USAGE_SETTINGS_SAVE, async (_event, settings = {}) => {
    try {
      return success({ usage: saveAiUsageSettings(userDataPath(), settings) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_SOURCE_ADD, async (_event, input) => {
    try {
      return success(await addProviderFromModelReliability({ userDataPath: userDataPath(), input }))
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_DELETE, async (_event, id) => {
    try {
      return success({ providers: await deleteProvider({ userDataPath: userDataPath(), id }) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_ACTIVATE, async (_event, id) => {
    try {
      return success({ providers: await activateProvider({ userDataPath: userDataPath(), id }) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_TEST, async (_event, providerId) => {
    try {
      const provider = await runtimeProvider({ userDataPath: userDataPath(), providerId })
      const result = await requestCompletion(provider, {
        messages: [{ role: 'user', content: '回复“连接正常”。' }],
        temperature: 0
      })
      return success({
        model: result.model,
        content: redactSensitiveText(result.content).slice(0, 500),
        usage: result.usage
      })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_ROUTING_SAVE, async (_event, settings = {}) => {
    try {
      const providers = await listProviders({ userDataPath: userDataPath() })
      saveProviderRoutingSettings(userDataPath(), settings)
      return success({ routing: safeRoutingState(providers) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_ROUTING_RESET, async () => {
    try {
      const providers = await listProviders({ userDataPath: userDataPath() })
      resetProviderRoutingHealth(userDataPath())
      return success({ routing: safeRoutingState(providers) })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_IMAGE_EVIDENCE_IMPORT, async (event) => {
    try {
      bindImageEvidenceCleanup(event.sender)
      const current = listImageEvidence(event.sender)
      if (current.length >= MAX_IMAGE_COUNT) {
        throw new Error(`每次对话最多附加 ${MAX_IMAGE_COUNT} 张图片证据`)
      }
      const focused = BrowserWindow.fromWebContents?.(event.sender) || null
      const options = {
        title: '选择故障截图或图片证据',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      }
      const selection = focused
        ? await dialog.showOpenDialog(focused, options)
        : await dialog.showOpenDialog(options)
      if (selection.canceled || !selection.filePaths?.length) {
        return success({ cancelled: true, attachments: current })
      }
      await importImageEvidence({
        sender: event.sender,
        filePaths: selection.filePaths,
        nativeImage
      })
      return success({ attachments: listImageEvidence(event.sender) })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_IMAGE_EVIDENCE_REMOVE, async (event, input = {}) => {
    try {
      removeImageEvidence(event.sender, input.id)
      return success({ attachments: listImageEvidence(event.sender) })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_IMAGE_EVIDENCE_CLEAR, async (event) => {
    try {
      clearImageEvidence(event.sender)
      return success({ attachments: [] })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_CHAT_ASK, async (event, options = {}) => {
    try {
      const imageEvidence = resolveImageEvidenceIds(event.sender, options.imageEvidenceIds)
      const routed = await executeRoutedProviderRequest({
        providerId: options.providerId,
        beforeAttempt: (provider) => ensureChatBudget(provider, options, imageEvidence),
        execute: (provider) =>
          askAiChat({
            userDataPath: userDataPath(),
            providerId: provider.id,
            messages: options.messages,
            knowledgeResults: options.knowledgeResults,
            contextAttachments: options.contextAttachments,
            imageEvidence,
            provider
          })
      })
      const result = routed.result
      const usageState = recordChatUsage(routed.provider, result, options, imageEvidence)
      if (imageEvidence.length) clearImageEvidence(event.sender)
      return success({ ...result, route: routed.route, usageState })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_CHAT_STREAM_START, async (event, options = {}) => {
    const requestId = normalizeChatStreamRequestId(options.requestId)
    const sender = event.sender
    const key = chatStreamKey(sender, requestId)
    if (activeChatStreams.has(key)) throw new Error('AI 对话请求已存在')
    const controller = new AbortController()
    const entry = { controller, cancelled: false }
    activeChatStreams.set(key, entry)
    const onDestroyed = () => {
      entry.cancelled = true
      controller.abort()
    }
    sender.once?.('destroyed', onDestroyed)

    try {
      const imageEvidence = resolveImageEvidenceIds(sender, options.imageEvidenceIds)
      let emittedDelta = false
      const routed = await executeRoutedProviderRequest({
        providerId: options.providerId,
        signal: controller.signal,
        hasPartialOutput: () => emittedDelta,
        beforeAttempt: (provider) => ensureChatBudget(provider, options, imageEvidence),
        execute: (provider) =>
          askAiChatStream({
            userDataPath: userDataPath(),
            providerId: provider.id,
            messages: options.messages,
            knowledgeResults: options.knowledgeResults,
            contextAttachments: options.contextAttachments,
            imageEvidence,
            provider,
            signal: controller.signal,
            onDelta: (delta) => {
              if (entry.cancelled || controller.signal.aborted) return
              emittedDelta = true
              sendChatStreamEvent(sender, { requestId, type: 'delta', delta })
            }
          })
      })
      const result = routed.result
      if (entry.cancelled || controller.signal.aborted) {
        const cancelled = new Error('AI 请求已取消')
        cancelled.code = 'AI_CHAT_CANCELLED'
        throw cancelled
      }
      sendChatStreamEvent(sender, {
        requestId,
        type: 'done',
        model: result.model,
        truncated: Boolean(result.truncated),
        usage: result.usage
      })
      const usageState = recordChatUsage(routed.provider, result, options, imageEvidence)
      if (imageEvidence.length) clearImageEvidence(sender)
      return success({
        requestId,
        content: result.content,
        model: result.model,
        truncated: result.truncated,
        usage: result.usage,
        route: routed.route,
        usageState
      })
    } catch (error) {
      const cancelled =
        entry.cancelled ||
        ['AI_CHAT_CANCELLED', 'AI_PROVIDER_ROUTE_CANCELLED'].includes(String(error?.code || ''))
      if (cancelled) return { ok: false, cancelled: true, requestId, error: '已停止生成' }
      return {
        ...failure(error),
        requestId,
        retryable: isRetryableProviderError(error) || isRetryableProviderError(error?.cause)
      }
    } finally {
      sender.removeListener?.('destroyed', onDestroyed)
      activeChatStreams.delete(key)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_CHAT_STREAM_CANCEL, async (event, options = {}) => {
    const requestId = normalizeChatStreamRequestId(options.requestId)
    const key = chatStreamKey(event.sender, requestId)
    const entry = activeChatStreams.get(key)
    if (!entry) return success({ requestId, cancelled: false })
    entry.cancelled = true
    entry.controller.abort()
    return success({ requestId, cancelled: true })
  })

  ipcMain.handle(IPC_CHANNELS.AI_EVALUATION_SAVE_CASES, async (_event, cases) => {
    try {
      return success({ cases: saveEvaluationCases(userDataPath(), cases) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_EVALUATION_RUN, async (_event, options) => {
    try {
      const run = await runEvaluation({
        userDataPath: userDataPath(),
        providerId: options?.providerId,
        caseIds: options?.caseIds
      })
      addOpsEvent(userDataPath(), {
        sourceKey: `evaluation:${run.id}`,
        category: 'model',
        level: run.summary.failed ? 'warning' : 'info',
        status: run.summary.failed ? 'open' : 'resolved',
        title: run.summary.failed
          ? `模型评测发现 ${run.summary.failed} 项异常`
          : '模型评测全部通过',
        description: `${run.providerName} · ${run.model} · ${run.summary.passed}/${run.summary.total} 通过`,
        relatedId: run.id
      })
      return success({ run })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_LOG_ANALYZE, async (_event, options) => {
    try {
      const title = String(options?.title || '未命名日志')
      const local = analyzeLogText(options?.text)
      let aiSummary = ''
      if (options?.useAi) {
        aiSummary = await generateOptionalAnalysis({
          providerId: options?.providerId,
          prompt: `请分析以下日志的本地统计结果和节选，给出：1. 已确认事实；2. 最可能原因（标记为推测）；3. 不含破坏性命令的下一步检查建议。\n\n统计：${JSON.stringify(local.findings)}\n\n日志节选：\n${local.excerpt}`
        })
      }
      const item = saveLogAnalysis(userDataPath(), { title, text: options?.text, aiSummary })
      if (item.level === 'high' || item.level === 'medium') {
        addOpsEvent(userDataPath(), {
          sourceKey: `log:${item.id}`,
          category: 'log',
          level: item.level === 'high' ? 'critical' : 'warning',
          title: `日志分析发现风险：${item.title}`,
          description: item.headline,
          relatedId: item.id
        })
      }
      return success({ item })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_SAVE, async (_event, document) => {
    try {
      return success({ document: saveKnowledgeDocument(userDataPath(), document) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_IMPORT, async (_event, inputPath) => {
    try {
      const candidate = String(inputPath || '').trim()
      if (!candidate) throw new Error('请先选择要导入的文档')
      const stat = fs.statSync(candidate)
      if (!stat.isFile()) throw new Error('只能导入普通文件')
      if (stat.size > 1_000_000) throw new Error('单个知识文档不能超过 1 MB')
      const extension = path.extname(candidate).toLowerCase()
      if (!['.md', '.txt', '.log', '.json', '.yml', '.yaml', '.conf'].includes(extension))
        throw new Error('仅支持 Markdown、文本、日志、JSON、YAML 或配置文件')
      const content = fs.readFileSync(candidate, 'utf8')
      const document = saveKnowledgeDocument(userDataPath(), {
        title: path.basename(candidate, extension) || path.basename(candidate),
        tags: ['导入文档', extension.replace('.', '')].filter(Boolean),
        content,
        source: { type: 'file', name: path.basename(candidate), importedAt: Date.now() }
      })
      return success({ document })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_IMPORT_DIRECTORY, async () => {
    try {
      const focused = BrowserWindow.getFocusedWindow()
      const selection = await dialog.showOpenDialog(focused, {
        title: '选择知识文档目录',
        properties: ['openDirectory']
      })
      if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true }
      return success(importKnowledgeDirectory(userDataPath(), selection.filePaths[0]))
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_EXPORT, async (_event, document) => {
    try {
      const title = String(document?.title || '未命名知识').trim() || '未命名知识'
      const content = String(document?.content || '')
      if (!content.trim()) throw new Error('文档内容为空，无法导出')
      const tags = Array.isArray(document?.tags) ? document.tags : []
      const focused = BrowserWindow.getFocusedWindow()
      const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
      const result = await dialog.showSaveDialog(focused, {
        title: '导出知识文档',
        defaultPath: `${safeName}.md`,
        filters: [
          { name: 'Markdown 文件', extensions: ['md'] },
          { name: '文本文件', extensions: ['txt'] }
        ]
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      const header = tags.length
        ? `# ${title}\n\n> 标签：${tags.join(' · ')}\n\n`
        : `# ${title}\n\n`
      fs.writeFileSync(result.filePath, `${header}${content}\n`, { encoding: 'utf8', mode: 0o600 })
      return success({ filePath: result.filePath })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_DELETE, async (_event, id) => {
    try {
      return success({ documents: deleteKnowledgeDocument(userDataPath(), id) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_SEARCH, async (_event, query) => {
    try {
      return success({ results: searchKnowledge(userDataPath(), query) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_ANSWER, async (_event, options) => {
    try {
      const query = String(options?.query || '').trim()
      const results = searchKnowledge(userDataPath(), query)
      if (!results.length) return success({ results, answer: '本地知识库没有检索到相关内容。' })
      if (!options?.useAi) return success({ results, answer: '' })
      const context = results
        .map(
          (item, index) =>
            `[${index + 1}] ${item.title}（第 ${item.startLine}-${item.endLine} 行）\n${item.content}`
        )
        .join('\n\n')
      const answer = await generateOptionalAnalysis({
        providerId: options?.providerId,
        prompt: `只依据以下本地知识片段回答问题；每个结论用 [编号] 标注来源。没有依据时明确说不知道。\n问题：${query}\n\n知识片段：\n${context}`
      })
      return success({ results, answer })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_WORKFLOW_PLAN, async (_event, prompt) => {
    try {
      const quickLaunch = readQuickLaunchState(
        readJsonFile(path.join(userDataPath(), 'quick-launch.json'), null)
      )
      const plan = planWorkflow({ prompt, quickLaunchItems: quickLaunch.items })
      return success({ plan: saveWorkflowPlan(userDataPath(), plan) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_WORKFLOW_EXECUTE, async (_event, options = {}) => {
    try {
      const planId = String(options.planId || options.plan?.id || '')
        .trim()
        .slice(0, 120)
      const plan = findWorkflowPlan(userDataPath(), planId)
      if (!plan || !Array.isArray(plan.steps)) throw new Error('工作流预览无效或已过期，请重新生成')
      const requestedStepIds = Array.isArray(options.stepIds)
        ? Array.from(
            new Set(
              options.stepIds
                .map((value) =>
                  String(value || '')
                    .trim()
                    .slice(0, 120)
                )
                .filter(Boolean)
            )
          ).slice(0, 20)
        : []
      const steps = requestedStepIds.length
        ? plan.steps.filter((step) => requestedStepIds.includes(step.id))
        : plan.steps
      if (!steps.length || (requestedStepIds.length && steps.length !== requestedStepIds.length))
        throw new Error('工作流步骤无效或已过期，请重新生成')
      if (steps.some((step) => step.approval?.required) && options.confirmed !== true)
        throw new Error('所选步骤需要明确确认后才能继续')
      const allowedNavigationRoutes = new Set([
        '/system-release',
        '/ai-models',
        '/ai-operations',
        '/knowledge-base',
        '/ai-integrations',
        '/node-services'
      ])
      const completed = []
      for (const step of steps) {
        if (step.type === 'open-url' && step.allowedExecution === 'confirmed-external-open') {
          const url = normalizeExternalUrl(step.target)
          await openExternalUrl(url, { shell })
          completed.push({ ...step, target: url, status: 'done' })
        } else if (
          step.type === 'navigate' &&
          step.allowedExecution === 'renderer-navigation-only'
        ) {
          const routePath = String(step.target || '').split('?')[0]
          if (!allowedNavigationRoutes.has(routePath))
            throw new Error('工作流页面步骤无效，请重新生成')
          completed.push({ ...step, status: 'requires-user-navigation' })
        } else {
          completed.push({ ...step, target: '', status: 'guided' })
        }
      }
      return success({
        completed,
        approval: {
          planId: plan.id,
          confirmed: options.confirmed === true,
          approvedStepIds: completed.map((step) => step.id),
          recordedAt: Date.now(),
          audited: true
        }
      })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_COPILOT_ASK, async (_event, options = {}) => {
    try {
      const prompt = String(options.prompt || '')
        .trim()
        .slice(0, 4000)
      if (!prompt) throw new Error('请输入需要分析的运维问题')
      const context = copilotContext(prompt)
      const quickLaunch = readQuickLaunchState(
        readJsonFile(path.join(userDataPath(), 'quick-launch.json'), null)
      )
      const plan = saveWorkflowPlan(
        userDataPath(),
        planWorkflow({ prompt, quickLaunchItems: quickLaunch.items })
      )
      let answer = ''
      if (options.useAi) {
        answer = await generateOptionalAnalysis({
          providerId: options.providerId,
          prompt: `用户问题：${prompt}\n\n请仅依据以下本地材料回答。输出：1. 已确认事实；2. 推测（明确标注）；3. 建议的只读检查；4. 如有工作流，提醒用户确认后执行。每个知识结论标注 [编号]。\n\n${context.text}`
        })
      } else {
        answer = `已收集 ${context.knowledge.length} 条知识证据和 ${context.timeline.summary.total} 条关联时间线记录，其中严重 ${context.timeline.summary.critical} 条、警告 ${context.timeline.summary.warning} 条。请查看下方证据和确认式工作流；配置 Provider 后可生成 AI 总结。`
      }
      addOpsEvent(userDataPath(), {
        sourceKey: `copilot:${plan.id}`,
        category: 'copilot',
        level: 'info',
        status: 'resolved',
        title: 'AI Copilot 已生成运维建议',
        description: prompt.slice(0, 300),
        relatedId: plan.id
      })
      return success({ answer, sources: context.knowledge, timeline: context.timeline, plan })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_RELEASE_RISK_ANALYZE, async (_event, options = {}) => {
    try {
      const profile = options.profile && typeof options.profile === 'object' ? options.profile : {}
      const profileId = String(profile.id || options.profileId || '')
        .trim()
        .slice(0, 120)
      return success({
        risk: buildReleaseRiskSummary({
          preflight: options.preflight,
          profile,
          profileId,
          history: loadReleaseHistory({ profileId })
        })
      })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_POSTMORTEM_GENERATE, async (_event, options = {}) => {
    try {
      const eventId = String(options.eventId || '')
        .trim()
        .slice(0, 100)
      if (!eventId) throw new Error('请选择需要复盘的事件')
      const event = listOpsEvents(userDataPath(), { limit: 500 }).find(
        (item) => item.id === eventId
      )
      if (!event) throw new Error('事件不存在或已被移除')
      const since = Math.max(
        0,
        Number(event.firstOccurredAt || event.createdAt || event.updatedAt) - 6 * 60 * 60_000
      )
      const timeline = buildCopilotTimeline({
        events: [event],
        logs: loadLogState(userDataPath()).items.slice(0, 20),
        releases: loadReleaseHistory().slice(0, 50),
        nodeHistory: listNodeServiceHistory(userDataPath(), { since, limit: 500 }),
        runbooks: listRunbookHistory(userDataPath(), { limit: 50 }),
        redact: redactSensitiveText,
        limit: 100
      })
      return success({
        postmortem: buildIncidentPostmortem({
          event,
          timeline,
          redact: redactSensitiveText
        })
      })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_OPS_REPORT_GENERATE, async (_event, options = {}) => {
    try {
      const kind = ['daily', 'weekly', 'handoff'].includes(options.kind) ? options.kind : 'daily'
      const now = Date.now()
      const to = Math.min(now, Math.max(0, Number(options.to) || now))
      const requestedFrom = Math.max(0, Number(options.from) || 0)
      const from = requestedFrom ? Math.max(to - 31 * 24 * 60 * 60_000, requestedFrom) : 0
      return success({
        report: buildOpsReport({
          kind,
          from,
          to,
          events: listOpsEvents(userDataPath(), { limit: 500 }),
          releases: loadReleaseHistory().slice(0, 200),
          nodeHistory: listNodeServiceHistory(userDataPath(), {
            since: from || Math.max(0, to - 31 * 24 * 60 * 60_000),
            limit: 2000
          }),
          runbooks: listRunbookHistory(userDataPath(), { limit: 100 }),
          logs: loadLogState(userDataPath()).items,
          redact: redactSensitiveText,
          generatedAt: now
        })
      })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPS_EVENTS_GET, async (_event, options = {}) => {
    try {
      return success({
        items: listOpsEvents(userDataPath(), options),
        summary: eventSummary(userDataPath())
      })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_EVENT_UPDATE, async (_event, options = {}) => {
    try {
      return success({
        item: updateOpsEvent(userDataPath(), String(options.id || ''), options.status)
      })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_EVENTS_MARK_READ, async (_event, options = {}) => {
    try {
      const result = markOpsEventsRead(userDataPath(), options)
      return success({ ...result, summary: eventSummary(userDataPath()) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_AUTOMATION_GET, async () => {
    try {
      return success({ tasks: listAutomationTasks(userDataPath()) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_AUTOMATION_SAVE, async (_event, task) => {
    try {
      return success({ task: saveAutomationTask(userDataPath(), task) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_AUTOMATION_DELETE, async (_event, id) => {
    try {
      return success({ tasks: deleteAutomationTask(userDataPath(), String(id || '')) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_AUTOMATION_RUN, async (_event, id) => {
    try {
      return success(await runAutomationTask(userDataPath(), String(id || '')))
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_MCP_INFO, async () => {
    const packaged = app.isPackaged
    return success({
      mode: 'stdio',
      readOnly: true,
      command: process.execPath,
      args: packaged ? ['--mcp'] : [app.getAppPath(), '--mcp'],
      script: path.join(app.getAppPath(), 'src', 'main', 'mcp-server.js'),
      tools: ['get_release_history', 'get_model_health', 'search_ops_knowledge'],
      note: packaged
        ? '当前安装包可通过上方命令以 stdio 模式启动 MCP；服务只提供本机只读数据。'
        : '开发环境可使用 pnpm mcp，或使用上方 Electron 命令启动；服务只提供本机只读数据。'
    })
  })
}

module.exports = { registerAiOpsHandlers }
