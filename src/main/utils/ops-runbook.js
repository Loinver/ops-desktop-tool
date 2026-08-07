const crypto = require('node:crypto')
const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')

const RUNBOOK_VERSION = 1
const RUNBOOK_HISTORY_FILE = 'ops-runbook-history.json'
const MAX_RUNBOOK_STEPS = 20
const MAX_RUNBOOK_HISTORY = 50
const MAX_RUNBOOK_MESSAGE_LENGTH = 500
const MAX_PLAN_SERIALIZED_LENGTH = 32_000
const MAX_EVENT_ID_LENGTH = 120
const MAX_SOURCE_ID_LENGTH = 160
const MAX_EVENT_TEXT_LENGTH = 240
const MAX_ATTRIBUTES = 12

const SOURCE_ALIASES = Object.freeze({
  automation: 'automation',
  'model-monitor': 'model-monitor',
  model: 'model-monitor',
  node: 'node-service',
  'node-service': 'node-service',
  backup: 'backup',
  'data-backup': 'backup',
  release: 'release',
  log: 'log',
  logs: 'log',
  copilot: 'copilot'
})

const SOURCE_STEP_DEFINITIONS = Object.freeze({
  automation: Object.freeze({
    actionType: 'automation-diagnostic',
    actionHandler: 'automation.diagnose',
    verificationType: 'automation-recheck',
    verificationHandler: 'automation.recheck',
    routeKey: 'ops-control-center'
  }),
  'model-monitor': Object.freeze({
    actionType: 'model-monitor-diagnostic',
    actionHandler: 'model-monitor.diagnose',
    verificationType: 'model-monitor-recheck',
    verificationHandler: 'model-monitor.recheck',
    routeKey: 'model-test'
  }),
  'node-service': Object.freeze({
    actionType: 'node-service-diagnostic',
    actionHandler: 'node-service.diagnose',
    verificationType: 'node-service-recheck',
    verificationHandler: 'node-service.recheck',
    routeKey: 'node-services'
  }),
  backup: Object.freeze({
    actionType: 'backup-diagnostic',
    actionHandler: 'backup.diagnose',
    verificationType: 'backup-recheck',
    verificationHandler: 'backup.recheck',
    routeKey: 'data-management'
  }),
  release: Object.freeze({
    actionType: 'release-diagnostic',
    actionHandler: 'release.diagnose',
    verificationType: 'release-recheck',
    verificationHandler: 'release.recheck',
    routeKey: 'system-release'
  }),
  log: Object.freeze({
    actionType: 'log-diagnostic',
    actionHandler: 'log.diagnose',
    verificationType: 'log-recheck',
    verificationHandler: 'log.recheck',
    routeKey: 'ai-operations'
  }),
  copilot: Object.freeze({
    actionType: 'copilot-diagnostic',
    actionHandler: 'copilot.diagnose',
    verificationType: 'copilot-recheck',
    verificationHandler: 'copilot.recheck',
    routeKey: 'ai-operations'
  })
})

const ALLOWED_STEP_TYPES = new Set([
  'automation-diagnostic',
  'automation-recheck',
  'model-monitor-diagnostic',
  'model-monitor-recheck',
  'node-service-diagnostic',
  'node-service-recheck',
  'backup-diagnostic',
  'backup-recheck',
  'release-diagnostic',
  'release-recheck',
  'log-diagnostic',
  'log-recheck',
  'copilot-diagnostic',
  'copilot-recheck',
  'guided-review'
])

const SAFE_ATTRIBUTE_KEYS = new Set([
  'analysisId',
  'appType',
  'currentPid',
  'lastSuccessfulAt',
  'missingCount',
  'model',
  'port',
  'previousPid',
  'provider',
  'providerId',
  'protocol',
  'status',
  'taskId',
  'taskType',
  'planId',
  'releaseId',
  'runId'
])

const STEP_STATUSES = new Set(['succeeded', 'failed', 'guided'])

function boundedString(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).trim().slice(0, max)
}

function finiteNumber(value, fallback = 0) {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

function boundedTimestamp(value) {
  const result = finiteNumber(value)
  return result > 0 ? Math.floor(result) : 0
}

function normalizeSourceType(value) {
  const source = boundedString(value, 60).toLowerCase()
  return SOURCE_ALIASES[source] || 'unknown'
}

function normalizeSeverity(value) {
  return ['info', 'warning', 'critical'].includes(value) ? value : 'info'
}

function normalizeAttributeValue(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().slice(0, 160)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function normalizeAttributes(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const attributes = {}
  for (const key of Object.keys(input).sort()) {
    if (Object.keys(attributes).length >= MAX_ATTRIBUTES) break
    if (!SAFE_ATTRIBUTE_KEYS.has(key)) continue
    const value = normalizeAttributeValue(input[key])
    if (value !== undefined) attributes[key] = value
  }
  return attributes
}

function normalizeOpsEvent(event = {}) {
  const input = event && typeof event === 'object' && !Array.isArray(event) ? event : {}
  const sourceType = normalizeSourceType(input.sourceType || input.category)
  const sourceId = boundedString(input.sourceId || input.relatedId, MAX_SOURCE_ID_LENGTH)
  return {
    id: boundedString(input.id, MAX_EVENT_ID_LENGTH),
    sourceType,
    sourceId,
    severity: normalizeSeverity(input.severity || input.level),
    title: boundedString(input.title, MAX_EVENT_TEXT_LENGTH),
    description: boundedString(input.description, MAX_EVENT_TEXT_LENGTH),
    occurredAt: boundedTimestamp(input.occurredAt || input.lastOccurredAt || input.createdAt),
    attributes: normalizeAttributes(input.attributes)
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  )
}

function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

function digest(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 20)
}

function stepInput(event) {
  return {
    eventId: event.id,
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    severity: event.severity,
    attributes: event.attributes
  }
}

function buildRunbookPlan(event = {}) {
  const normalizedEvent = normalizeOpsEvent(event)
  const definition = SOURCE_STEP_DEFINITIONS[normalizedEvent.sourceType]
  const input = stepInput(normalizedEvent)
  const steps = definition
    ? [
        {
          id: 'action-1',
          phase: 'action',
          type: definition.actionType,
          kind: 'diagnostic',
          handlerKey: definition.actionHandler,
          routeKey: definition.routeKey,
          requiresConfirmation: true,
          input
        },
        {
          id: 'verification-1',
          phase: 'verification',
          type: definition.verificationType,
          kind: 'recheck',
          handlerKey: definition.verificationHandler,
          routeKey: definition.routeKey,
          requiresConfirmation: false,
          input
        }
      ]
    : [
        {
          id: 'guided-1',
          phase: 'action',
          type: 'guided-review',
          kind: 'guided',
          handlerKey: '',
          routeKey: 'ops-control-center',
          requiresConfirmation: false,
          input
        }
      ]

  const plan = {
    version: RUNBOOK_VERSION,
    planId: '',
    event: normalizedEvent,
    executable: Boolean(definition),
    requiresConfirmation: Boolean(definition),
    steps: steps.slice(0, MAX_RUNBOOK_STEPS)
  }
  plan.planId = `runbook-${digest(plan)}`
  return plan
}

function validateRunbookPlan(plan, event = {}) {
  const expectedPlan = buildRunbookPlan(event)
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { valid: false, reason: 'invalid-plan', expectedPlan }
  }
  if (!Array.isArray(plan.steps) || plan.steps.length > MAX_RUNBOOK_STEPS) {
    return { valid: false, reason: 'invalid-plan', expectedPlan }
  }
  try {
    const candidateJson = stableJson(plan)
    if (typeof candidateJson !== 'string' || candidateJson.length > MAX_PLAN_SERIALIZED_LENGTH) {
      return { valid: false, reason: 'invalid-plan', expectedPlan }
    }
    if (candidateJson !== stableJson(expectedPlan)) {
      return { valid: false, reason: 'plan-mismatch', expectedPlan }
    }
  } catch {
    return { valid: false, reason: 'invalid-plan', expectedPlan }
  }
  return { valid: true, reason: '', expectedPlan }
}

function historyPath(userDataPath) {
  return path.join(userDataPath, RUNBOOK_HISTORY_FILE)
}

function normalizeStepResult(input = {}, fallbackPhase = 'action') {
  const phase = input.phase === 'verification' ? 'verification' : fallbackPhase
  const status = STEP_STATUSES.has(input.status) ? input.status : 'guided'
  return {
    stepId: boundedString(input.stepId, 80),
    phase,
    type: ALLOWED_STEP_TYPES.has(input.type) ? input.type : 'guided-review',
    status,
    message: boundedString(input.message, MAX_RUNBOOK_MESSAGE_LENGTH),
    durationMs: Math.max(0, Math.floor(finiteNumber(input.durationMs)))
  }
}

function summarizeResults(actionResults = [], verificationResults = []) {
  const results = [...actionResults, ...verificationResults]
  const summary = {
    total: results.length,
    succeeded: results.filter((item) => item.status === 'succeeded').length,
    failed: results.filter((item) => item.status === 'failed').length,
    guided: results.filter((item) => item.status === 'guided').length
  }
  const status = summary.failed > 0 ? 'failed' : summary.guided > 0 ? 'guided' : 'succeeded'
  return { ...summary, status }
}

function normalizeRunRecord(input = {}) {
  const actionResults = Array.isArray(input.actionResults)
    ? input.actionResults
        .slice(0, MAX_RUNBOOK_STEPS)
        .map((item) => normalizeStepResult(item, 'action'))
    : []
  const remainingSteps = Math.max(0, MAX_RUNBOOK_STEPS - actionResults.length)
  const verificationResults = Array.isArray(input.verificationResults)
    ? input.verificationResults
        .slice(0, remainingSteps)
        .map((item) => normalizeStepResult(item, 'verification'))
    : []
  const summary = summarizeResults(actionResults, verificationResults)
  return {
    id: boundedString(input.id, 100),
    planId: boundedString(input.planId, 100),
    eventId: boundedString(input.eventId, MAX_EVENT_ID_LENGTH),
    sourceType: normalizeSourceType(input.sourceType),
    sourceId: boundedString(input.sourceId, MAX_SOURCE_ID_LENGTH),
    status: summary.status,
    confirmed: input.confirmed === true,
    planRejected: input.planRejected === true,
    confirmationRequired: input.confirmationRequired === true,
    reason: boundedString(input.reason, MAX_RUNBOOK_MESSAGE_LENGTH),
    startedAt: boundedTimestamp(input.startedAt),
    finishedAt: boundedTimestamp(input.finishedAt),
    actionResults,
    verificationResults,
    summary
  }
}

function normalizeHistoryState(input = {}) {
  const sourceRuns = Array.isArray(input) ? input : input?.runs
  const runs = (Array.isArray(sourceRuns) ? sourceRuns : [])
    .slice(0, MAX_RUNBOOK_HISTORY)
    .map(normalizeRunRecord)
    .filter((item) => item.id)
  return { version: RUNBOOK_VERSION, runs }
}

function loadRunbookHistory(userDataPath) {
  return normalizeHistoryState(
    readJsonFile(historyPath(userDataPath), { version: RUNBOOK_VERSION, runs: [] })
  )
}

function saveRunbookHistory(userDataPath, state) {
  if (!writeJsonFile(historyPath(userDataPath), normalizeHistoryState(state))) {
    throw new Error('保存 Runbook 历史失败')
  }
  return loadRunbookHistory(userDataPath)
}

function appendRunbookHistory(userDataPath, run) {
  const state = loadRunbookHistory(userDataPath)
  const next = normalizeRunRecord(run)
  if (!next.id) throw new Error('Runbook 历史记录缺少 id')
  state.runs = [next, ...state.runs.filter((item) => item.id !== next.id)].slice(
    0,
    MAX_RUNBOOK_HISTORY
  )
  return saveRunbookHistory(userDataPath, state)
}

function listRunbookHistory(userDataPath, options = {}) {
  const requested = Math.floor(finiteNumber(options.limit, MAX_RUNBOOK_HISTORY))
  const limit = Math.min(MAX_RUNBOOK_HISTORY, Math.max(1, requested || MAX_RUNBOOK_HISTORY))
  return loadRunbookHistory(userDataPath).runs.slice(0, limit)
}

function handlerFor(handlers, step) {
  if (!handlers || typeof handlers !== 'object') return null
  if (!step.handlerKey || step.type === 'guided-review') return null
  const byHandlerKey = handlers[step.handlerKey]
  if (typeof byHandlerKey === 'function') return byHandlerKey
  const byType = handlers[step.type]
  return typeof byType === 'function' ? byType : null
}

function handlerOutcome(value) {
  if (value === false || value?.ok === false || value?.status === 'failed') {
    return { status: 'failed', message: boundedString(value?.message, MAX_RUNBOOK_MESSAGE_LENGTH) }
  }
  if (value?.guided === true || value?.status === 'guided') {
    return { status: 'guided', message: boundedString(value?.message, MAX_RUNBOOK_MESSAGE_LENGTH) }
  }
  return { status: 'succeeded', message: boundedString(value?.message, MAX_RUNBOOK_MESSAGE_LENGTH) }
}

async function executePhase({ steps, handlers, event, plan, phase }) {
  const results = []
  for (const step of steps.filter((item) => item.phase === phase).slice(0, MAX_RUNBOOK_STEPS)) {
    const handler = handlerFor(handlers, step)
    if (!handler) {
      results.push(
        normalizeStepResult(
          {
            stepId: step.id,
            phase,
            type: step.type,
            status: 'guided',
            message: '未提供该类型的安全处理器'
          },
          phase
        )
      )
      continue
    }
    try {
      const outcome = handlerOutcome(
        await handler(stableValue(step.input), {
          event: stableValue(event),
          phase,
          planId: plan.planId,
          stepType: step.type
        })
      )
      results.push(
        normalizeStepResult(
          {
            stepId: step.id,
            phase,
            type: step.type,
            ...outcome
          },
          phase
        )
      )
    } catch (error) {
      results.push(
        normalizeStepResult(
          {
            stepId: step.id,
            phase,
            type: step.type,
            status: 'failed',
            message: boundedString(error?.message, MAX_RUNBOOK_MESSAGE_LENGTH) || '处理器执行失败'
          },
          phase
        )
      )
    }
  }
  return results
}

function executeArguments(options, maybeEvent, maybeOptions) {
  if (typeof options === 'string') {
    return { ...(maybeOptions || {}), userDataPath: options, event: maybeEvent }
  }
  return options || {}
}

function runId(plan, startedAt, history) {
  return `run-${startedAt}-${digest({ planId: plan.planId, startedAt, count: history.runs.length })}`
}

async function executeRunbook(options = {}, maybeEvent, maybeOptions) {
  const config = executeArguments(options, maybeEvent, maybeOptions)
  const userDataPath = config.userDataPath
  if (typeof userDataPath !== 'string' || !userDataPath.trim()) throw new Error('缺少 userDataPath')

  const normalizedEvent = normalizeOpsEvent(config.event)
  const plan = buildRunbookPlan(normalizedEvent)
  const startedAtValue = typeof config.now === 'function' ? config.now() : config.now
  const startedAt = boundedTimestamp(startedAtValue) || Date.now()
  const history = loadRunbookHistory(userDataPath)
  const run = {
    id: runId(plan, startedAt, history),
    planId: plan.planId,
    eventId: normalizedEvent.id,
    sourceType: normalizedEvent.sourceType,
    sourceId: normalizedEvent.sourceId,
    confirmed: config.confirmed === true,
    planRejected: false,
    confirmationRequired: plan.requiresConfirmation,
    reason: '',
    startedAt,
    finishedAt: startedAt,
    actionResults: [],
    verificationResults: []
  }

  if (config.plan !== undefined) {
    const validation = validateRunbookPlan(config.plan, normalizedEvent)
    if (!validation.valid) {
      run.planRejected = true
      run.reason = '客户端 Runbook 与服务端重建计划不一致，已拒绝执行'
      run.actionResults = [
        normalizeStepResult(
          {
            stepId: 'plan-validation',
            phase: 'action',
            type: 'guided-review',
            status: 'failed',
            message: run.reason
          },
          'action'
        )
      ]
      run.finishedAt = startedAt
      const summary = summarizeResults(run.actionResults, run.verificationResults)
      const persisted = appendRunbookHistory(userDataPath, { ...run, status: summary.status })
      return {
        runId: run.id,
        planId: plan.planId,
        plan,
        status: 'failed',
        confirmed: run.confirmed,
        confirmationRequired: false,
        planRejected: true,
        reason: run.reason,
        actionResults: run.actionResults,
        verificationResults: [],
        summary,
        history: persisted
      }
    }
  }

  if (plan.requiresConfirmation && config.confirmed !== true) {
    run.reason = '执行 Runbook 前需要明确确认'
    run.actionResults = plan.steps
      .filter((step) => step.phase === 'action')
      .map((step) =>
        normalizeStepResult(
          {
            stepId: step.id,
            phase: 'action',
            type: step.type,
            status: 'guided',
            message: run.reason
          },
          'action'
        )
      )
    run.finishedAt = startedAt
    const summary = summarizeResults(run.actionResults, run.verificationResults)
    const persisted = appendRunbookHistory(userDataPath, { ...run, status: summary.status })
    return {
      runId: run.id,
      planId: plan.planId,
      plan,
      status: summary.status,
      confirmed: false,
      confirmationRequired: true,
      planRejected: false,
      reason: run.reason,
      actionResults: run.actionResults,
      verificationResults: [],
      summary,
      history: persisted
    }
  }

  run.actionResults = await executePhase({
    steps: plan.steps,
    handlers: config.handlers,
    event: normalizedEvent,
    plan,
    phase: 'action'
  })
  run.verificationResults = await executePhase({
    steps: plan.steps,
    handlers: config.handlers,
    event: normalizedEvent,
    plan,
    phase: 'verification'
  })
  run.finishedAt =
    boundedTimestamp(typeof config.now === 'function' ? config.now() : config.now) || startedAt
  const summary = summarizeResults(run.actionResults, run.verificationResults)
  const persisted = appendRunbookHistory(userDataPath, { ...run, status: summary.status })
  return {
    runId: run.id,
    planId: plan.planId,
    plan,
    status: summary.status,
    confirmed: config.confirmed === true,
    confirmationRequired: false,
    planRejected: false,
    reason: '',
    actionResults: run.actionResults,
    verificationResults: run.verificationResults,
    summary,
    history: persisted
  }
}

module.exports = {
  ALLOWED_STEP_TYPES,
  MAX_RUNBOOK_HISTORY,
  MAX_RUNBOOK_STEPS,
  RUNBOOK_HISTORY_FILE,
  RUNBOOK_VERSION,
  SOURCE_STEP_DEFINITIONS,
  appendRunbookHistory,
  buildRunbookPlan,
  executeEventRunbook: executeRunbook,
  executeRunbook,
  historyPath,
  listRunbookHistory,
  loadRunbookHistory,
  normalizeOpsEvent,
  saveRunbookHistory,
  summarizeResults,
  validateRunbookPlan
}
