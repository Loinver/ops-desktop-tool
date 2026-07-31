const crypto = require('node:crypto')
const net = require('node:net')
const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')

const EVENT_STATE_VERSION = 3
const MAX_EVENTS = 500
const MAX_EVENT_TIMELINE = 40
const MAX_TASKS = 100
const MAX_RUNS_PER_TASK = 50
const MIN_INTERVAL_MINUTES = 5
const MAX_INTERVAL_MINUTES = 7 * 24 * 60

function value(input, max = 500) { return String(input || '').trim().slice(0, max) }
function eventsPath(userDataPath) { return path.join(userDataPath, 'ops-events.json') }
function tasksPath(userDataPath) { return path.join(userDataPath, 'ops-automation-tasks.json') }

function normalizeLevel(level) {
  return ['info', 'warning', 'critical'].includes(level) ? level : 'info'
}
function normalizeEventStatus(status) {
  return ['open', 'acknowledged', 'resolved'].includes(status) ? status : 'open'
}
function normalizeAttributes(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return Object.fromEntries(Object.entries(input).slice(0, 30).map(([key, item]) => {
    const safeKey = value(key, 80)
    if (typeof item === 'number' || typeof item === 'boolean') return [safeKey, item]
    return [safeKey, value(item, 500)]
  }).filter(([key]) => key))
}
function normalizeTimeline(input) {
  if (!Array.isArray(input)) return []
  return input.slice(-MAX_EVENT_TIMELINE).map(item => ({
    id: value(item?.id, 100) || crypto.randomUUID(),
    type: ['opened', 'occurred', 'reopened', 'acknowledged', 'resolved', 'recovered'].includes(item?.type) ? item.type : 'occurred',
    message: value(item?.message, 500),
    createdAt: Number(item?.createdAt) || Date.now(),
  }))
}
function appendTimeline(timeline, type, message, createdAt = Date.now()) {
  return [...normalizeTimeline(timeline), {
    id: crypto.randomUUID(),
    type,
    message: value(message, 500),
    createdAt: Number(createdAt) || Date.now(),
  }].slice(-MAX_EVENT_TIMELINE)
}
function eventFingerprint(input = {}) {
  const explicit = value(input.fingerprint || input.sourceKey, 240)
  if (explicit) return explicit
  const sourceType = value(input.sourceType || input.category, 60) || 'system'
  const sourceId = value(input.sourceId || input.relatedId, 180)
  const title = value(input.title, 160) || 'event'
  return `${sourceType}:${sourceId || title}`.slice(0, 240)
}
function normalizeStoredEvent(input = {}) {
  const status = normalizeEventStatus(input.status)
  const severity = normalizeLevel(input.severity || input.level)
  const sourceType = value(input.sourceType || input.category, 60) || 'system'
  const sourceId = value(input.sourceId || input.relatedId, 180)
  const fingerprint = !input.fingerprint && sourceType === 'automation' && sourceId
    ? `automation:${sourceId}`.slice(0, 240)
    : eventFingerprint({ ...input, sourceType, sourceId })
  const firstOccurredAt = Number(input.firstOccurredAt || input.createdAt || input.updatedAt) || Date.now()
  const lastOccurredAt = Number(input.lastOccurredAt || input.updatedAt || input.createdAt) || firstOccurredAt
  const updatedAt = Number(input.updatedAt) || lastOccurredAt
  return {
    id: value(input.id, 100) || crypto.randomUUID(),
    fingerprint,
    sourceKey: value(input.sourceKey, 240) || fingerprint,
    sourceType,
    sourceId,
    category: sourceType,
    severity,
    level: severity,
    status,
    title: value(input.title, 160) || '运维事件',
    description: value(input.description, 1000),
    resolutionNote: value(input.resolutionNote, 500),
    relatedId: value(input.relatedId, 180) || sourceId,
    attributes: normalizeAttributes(input.attributes),
    occurrenceCount: Math.max(1, Number(input.occurrenceCount) || 1),
    firstOccurredAt,
    lastOccurredAt,
    acknowledgedAt: Number(input.acknowledgedAt) || 0,
    resolvedAt: Number(input.resolvedAt) || (status === 'resolved' ? updatedAt : 0),
    recoveredAt: Number(input.recoveredAt) || 0,
    readAt: Number(input.readAt) || 0,
    createdAt: firstOccurredAt,
    updatedAt,
    timeline: normalizeTimeline(input.timeline),
  }
}
function loadEventState(userDataPath) {
  const stored = readJsonFile(eventsPath(userDataPath), { version: EVENT_STATE_VERSION, items: [] })
  const storedVersion = Number(stored?.version) || 1
  const normalizedItems = Array.isArray(stored?.items)
    ? stored.items.slice(0, MAX_EVENTS).map(item => normalizeStoredEvent({
      ...item,
      readAt: item?.readAt ?? (storedVersion < EVENT_STATE_VERSION && normalizeEventStatus(item?.status) === 'resolved'
        ? Number(item?.updatedAt || item?.resolvedAt || item?.createdAt) || Date.now()
        : 0),
    }))
    : []
  const itemsByFingerprint = new Map()
  for (const item of normalizedItems) {
    const existing = itemsByFingerprint.get(item.fingerprint)
    if (!existing) {
      itemsByFingerprint.set(item.fingerprint, item)
      continue
    }
    const latest = item.updatedAt >= existing.updatedAt ? item : existing
    const earliest = item.firstOccurredAt <= existing.firstOccurredAt ? item : existing
    itemsByFingerprint.set(item.fingerprint, normalizeStoredEvent({
      ...latest,
      id: earliest.id,
      occurrenceCount: existing.occurrenceCount + item.occurrenceCount,
      firstOccurredAt: Math.min(existing.firstOccurredAt, item.firstOccurredAt),
      lastOccurredAt: Math.max(existing.lastOccurredAt, item.lastOccurredAt),
      timeline: [...existing.timeline, ...item.timeline]
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
        .slice(-MAX_EVENT_TIMELINE),
    }))
  }
  const items = [...itemsByFingerprint.values()]
    .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
    .slice(0, MAX_EVENTS)
  return { version: EVENT_STATE_VERSION, items }
}
function saveEventState(userDataPath, state) {
  const items = state.items.slice(0, MAX_EVENTS).map(normalizeStoredEvent)
  if (!writeJsonFile(eventsPath(userDataPath), { version: EVENT_STATE_VERSION, items })) throw new Error('保存运维事件失败')
}
function addOpsEvent(userDataPath, input = {}) {
  const state = loadEventState(userDataPath)
  const fingerprint = eventFingerprint(input)
  const existingIndex = state.items.findIndex(item => item.fingerprint === fingerprint)
  const existing = existingIndex >= 0 ? state.items[existingIndex] : null
  const occurredAt = Number(input.occurredAt || input.createdAt) || Date.now()
  const updatedAt = Date.now()
  const sourceType = value(input.sourceType || input.category || existing?.sourceType, 60) || 'system'
  const sourceId = value(input.sourceId || input.relatedId || existing?.sourceId, 180)
  const severity = normalizeLevel(input.severity || input.level || existing?.severity)
  const requestedStatus = normalizeEventStatus(input.status)
  const status = existing && requestedStatus === 'open' && existing.status !== 'resolved'
    ? existing.status
    : requestedStatus
  const timelineType = existing ? (existing.status === 'resolved' && status !== 'resolved' ? 'reopened' : 'occurred') : (status === 'resolved' ? 'resolved' : 'opened')
  const title = value(input.title, 160) || existing?.title || '运维事件'
  const description = value(input.description, 1000) || existing?.description || ''
  const timelineMessage = value(input.timelineMessage, 500) || description || title
  const normalized = normalizeStoredEvent({
    ...existing,
    id: existing?.id || crypto.randomUUID(),
    fingerprint,
    sourceKey: value(input.sourceKey, 240) || fingerprint,
    sourceType,
    sourceId,
    severity,
    status,
    title,
    description,
    resolutionNote: status === 'resolved' ? value(input.resolutionNote, 500) : '',
    relatedId: value(input.relatedId, 180) || existing?.relatedId || sourceId,
    attributes: { ...existing?.attributes, ...normalizeAttributes(input.attributes) },
    occurrenceCount: existing ? existing.occurrenceCount + 1 : 1,
    firstOccurredAt: existing?.firstOccurredAt || occurredAt,
    lastOccurredAt: occurredAt,
    acknowledgedAt: status === 'acknowledged' ? (existing?.acknowledgedAt || occurredAt) : 0,
    resolvedAt: status === 'resolved' ? occurredAt : 0,
    recoveredAt: status === 'resolved' && input.recovered ? occurredAt : 0,
    readAt: 0,
    updatedAt,
    timeline: appendTimeline(existing?.timeline, timelineType, timelineMessage, occurredAt),
  })
  if (existingIndex >= 0) state.items.splice(existingIndex, 1, normalized)
  else state.items.unshift(normalized)
  state.items.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
  saveEventState(userDataPath, state)
  return normalized
}
function updateOpsEvent(userDataPath, id, status, note = '') {
  const state = loadEventState(userDataPath)
  const item = state.items.find(entry => entry.id === id)
  if (!item) throw new Error('运维事件不存在')
  const nextStatus = normalizeEventStatus(status)
  const updatedAt = Date.now()
  item.status = nextStatus
  item.updatedAt = updatedAt
  item.readAt = updatedAt
  item.acknowledgedAt = nextStatus === 'acknowledged' ? (item.acknowledgedAt || updatedAt) : item.acknowledgedAt
  item.resolvedAt = nextStatus === 'resolved' ? updatedAt : 0
  if (nextStatus !== 'resolved') item.recoveredAt = 0
  item.resolutionNote = nextStatus === 'resolved' ? value(note, 500) : ''
  item.timeline = appendTimeline(item.timeline, nextStatus === 'acknowledged' ? 'acknowledged' : nextStatus === 'resolved' ? 'resolved' : 'reopened', note || (nextStatus === 'acknowledged' ? '用户已确认事件' : nextStatus === 'resolved' ? '用户已将事件标记为已解决' : '用户重新打开事件'), updatedAt)
  saveEventState(userDataPath, state)
  return normalizeStoredEvent(item)
}
function recoverOpsEvent(userDataPath, fingerprint, input = {}) {
  const state = loadEventState(userDataPath)
  const item = state.items.find(entry => entry.fingerprint === value(fingerprint, 240) && entry.status !== 'resolved')
  if (!item) return null
  const recoveredAt = Number(input.recoveredAt || input.occurredAt) || Date.now()
  const message = value(input.message || input.resolutionNote, 500) || '检测结果已恢复正常'
  item.status = 'resolved'
  item.updatedAt = recoveredAt
  item.resolvedAt = recoveredAt
  item.recoveredAt = recoveredAt
  item.readAt = 0
  item.resolutionNote = message
  item.relatedId = value(input.relatedId, 180) || item.relatedId
  item.attributes = { ...item.attributes, ...normalizeAttributes(input.attributes) }
  item.timeline = appendTimeline(item.timeline, 'recovered', message, recoveredAt)
  saveEventState(userDataPath, state)
  return normalizeStoredEvent(item)
}
function markOpsEventsRead(userDataPath, { ids = [], all = false } = {}) {
  const state = loadEventState(userDataPath)
  const selectedIds = new Set(Array.isArray(ids) ? ids.slice(0, MAX_EVENTS).map(id => value(id, 100)).filter(Boolean) : [])
  if (!all && selectedIds.size === 0) return { updated: 0, readAt: 0 }
  const readAt = Date.now()
  let updated = 0
  for (const item of state.items) {
    if (!item.readAt && (all || selectedIds.has(item.id))) {
      item.readAt = readAt
      updated += 1
    }
  }
  if (updated > 0) saveEventState(userDataPath, state)
  return { updated, readAt: updated > 0 ? readAt : 0 }
}

function listOpsEvents(userDataPath, { status = '', sourceType = '', category = '', severity = '', level = '', query = '', limit = 100 } = {}) {
  const normalizedStatus = status ? normalizeEventStatus(status) : ''
  const normalizedSourceType = value(sourceType || category, 60)
  const normalizedSeverity = severity || level ? normalizeLevel(severity || level) : ''
  const normalizedQuery = value(query, 200).toLowerCase()
  return loadEventState(userDataPath).items
    .filter(item => !normalizedStatus || item.status === normalizedStatus)
    .filter(item => !normalizedSourceType || item.sourceType === normalizedSourceType)
    .filter(item => !normalizedSeverity || item.severity === normalizedSeverity)
    .filter(item => !normalizedQuery || `${item.title} ${item.description} ${item.sourceType} ${item.sourceId}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)))
}

function normalizeTargetUrl(input) {
  const raw = value(input, 2048)
  let parsed
  try { parsed = new URL(raw) } catch { throw new Error('健康检查地址格式无效') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('健康检查仅支持不含账号密码的 HTTP/HTTPS 地址')
  return parsed.toString()
}
function normalizeTask(input = {}, existing = {}) {
  const type = ['http-health', 'tcp-port'].includes(input.type ?? existing.type) ? (input.type ?? existing.type) : 'http-health'
  const target = type === 'http-health'
    ? normalizeTargetUrl(input.target ?? existing.target)
    : value(input.target ?? existing.target, 255)
  if (!target) throw new Error(type === 'tcp-port' ? '请输入主机地址' : '请输入健康检查地址')
  const port = type === 'tcp-port' ? Math.max(1, Math.min(65535, Number(input.port ?? existing.port) || 0)) : 0
  if (type === 'tcp-port' && !port) throw new Error('请输入有效端口')
  const intervalMinutes = Math.max(MIN_INTERVAL_MINUTES, Math.min(MAX_INTERVAL_MINUTES, Number(input.intervalMinutes ?? existing.intervalMinutes) || 15))
  const enabled = input.enabled === undefined ? existing.enabled !== false : Boolean(input.enabled)
  const now = Date.now()
  return {
    id: value(existing.id || input.id || crypto.randomUUID(), 100),
    title: value(input.title ?? existing.title, 120) || (type === 'http-health' ? 'HTTP 健康检查' : 'TCP 端口检查'),
    type,
    target,
    port,
    expectedStatus: Math.max(100, Math.min(599, Number(input.expectedStatus ?? existing.expectedStatus) || 200)),
    timeoutMs: Math.max(1000, Math.min(60_000, Number(input.timeoutMs ?? existing.timeoutMs) || 8000)),
    intervalMinutes,
    enabled,
    createdAt: Number(existing.createdAt) || now,
    updatedAt: now,
    lastRunAt: Number(existing.lastRunAt) || 0,
    nextRunAt: enabled ? (Number(existing.nextRunAt) || now + intervalMinutes * 60_000) : 0,
    lastResult: existing.lastResult || null,
    runs: Array.isArray(existing.runs) ? existing.runs.slice(0, MAX_RUNS_PER_TASK) : [],
  }
}
function loadAutomationState(userDataPath) {
  const stored = readJsonFile(tasksPath(userDataPath), { version: 1, tasks: [] })
  return { version: 1, tasks: Array.isArray(stored?.tasks) ? stored.tasks.slice(0, MAX_TASKS) : [] }
}
function saveAutomationState(userDataPath, state) {
  if (!writeJsonFile(tasksPath(userDataPath), { version: 1, tasks: state.tasks.slice(0, MAX_TASKS) })) throw new Error('保存自动化任务失败')
}
function listAutomationTasks(userDataPath) { return loadAutomationState(userDataPath).tasks }
function saveAutomationTask(userDataPath, input) {
  const state = loadAutomationState(userDataPath)
  const index = state.tasks.findIndex(item => item.id === value(input?.id, 100))
  const task = normalizeTask(input, index >= 0 ? state.tasks[index] : {})
  if (index >= 0) state.tasks.splice(index, 1, task)
  else state.tasks.unshift(task)
  saveAutomationState(userDataPath, state)
  return task
}
function deleteAutomationTask(userDataPath, id) {
  const state = loadAutomationState(userDataPath)
  const task = state.tasks.find(item => item.id === id)
  const next = state.tasks.filter(item => item.id !== id)
  if (!task) throw new Error('自动化任务不存在')
  state.tasks = next
  saveAutomationState(userDataPath, state)
  recoverOpsEvent(userDataPath, `automation:${id}`, {
    message: `巡检任务“${task.title}”已删除，关联事件自动关闭`,
    relatedId: id,
  })
  return next
}
async function runHttpHealthCheck(task) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), task.timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetch(task.target, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'Ops-Desktop-Health-Check/1.0' } })
    const ok = response.status === task.expectedStatus
    return { ok, statusCode: response.status, durationMs: Date.now() - startedAt, message: ok ? `HTTP ${response.status}` : `期望 HTTP ${task.expectedStatus}，实际 HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, statusCode: 0, durationMs: Date.now() - startedAt, message: error?.name === 'AbortError' ? `请求超时（${task.timeoutMs}ms）` : value(error?.message, 500) || '健康检查失败' }
  } finally { clearTimeout(timer) }
}
function runTcpPortCheck(task) {
  const startedAt = Date.now()
  return new Promise(resolve => {
    const socket = net.createConnection({ host: task.target, port: task.port })
    const done = (ok, message) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve({ ok, statusCode: ok ? 200 : 0, durationMs: Date.now() - startedAt, message })
    }
    socket.setTimeout(task.timeoutMs)
    socket.once('connect', () => done(true, `TCP ${task.target}:${task.port} 可连接`))
    socket.once('timeout', () => done(false, `TCP 连接超时（${task.timeoutMs}ms）`))
    socket.once('error', error => done(false, value(error?.message, 500) || 'TCP 连接失败'))
  })
}
async function runAutomationTask(userDataPath, id) {
  const state = loadAutomationState(userDataPath)
  const task = state.tasks.find(item => item.id === id)
  if (!task) throw new Error('自动化任务不存在')
  const result = task.type === 'tcp-port' ? await runTcpPortCheck(task) : await runHttpHealthCheck(task)
  const completedAt = Date.now()
  const entry = { id: crypto.randomUUID(), ...result, startedAt: completedAt - result.durationMs, finishedAt: completedAt }
  task.lastRunAt = completedAt
  task.nextRunAt = task.enabled ? completedAt + task.intervalMinutes * 60_000 : 0
  task.lastResult = entry
  task.runs = [entry, ...(task.runs || [])].slice(0, MAX_RUNS_PER_TASK)
  saveAutomationState(userDataPath, state)
  const fingerprint = `automation:${task.id}`
  if (!entry.ok) {
    addOpsEvent(userDataPath, {
      fingerprint,
      sourceType: 'automation',
      sourceId: task.id,
      severity: 'warning',
      title: `巡检失败：${task.title}`,
      description: entry.message,
      relatedId: task.id,
      occurredAt: completedAt,
      attributes: {
        taskType: task.type,
        target: task.type === 'tcp-port' ? `${task.target}:${task.port}` : task.target,
        durationMs: entry.durationMs,
        statusCode: entry.statusCode,
      },
    })
  } else {
    recoverOpsEvent(userDataPath, fingerprint, {
      message: `巡检恢复：${entry.message}`,
      relatedId: task.id,
      recoveredAt: completedAt,
      attributes: { durationMs: entry.durationMs, statusCode: entry.statusCode },
    })
  }
  return { task, result: entry }
}
async function runDueAutomationTasks(userDataPath) {
  const tasks = listAutomationTasks(userDataPath).filter(task => task.enabled && task.nextRunAt && task.nextRunAt <= Date.now())
  const results = []
  for (const task of tasks.slice(0, 10)) {
    try { results.push(await runAutomationTask(userDataPath, task.id)) } catch (error) { results.push({ task, result: { ok: false, message: value(error?.message, 500) } }) }
  }
  return results
}
function eventSummary(userDataPath) {
  const items = loadEventState(userDataPath).items
  const active = items.filter(item => item.status !== 'resolved')
  return {
    total: items.length,
    active: active.length,
    open: items.filter(item => item.status === 'open').length,
    acknowledged: items.filter(item => item.status === 'acknowledged').length,
    resolved: items.filter(item => item.status === 'resolved').length,
    recovered: items.filter(item => item.recoveredAt > 0).length,
    unread: items.filter(item => !item.readAt).length,
    unreadCritical: items.filter(item => !item.readAt && item.severity === 'critical').length,
    critical: active.filter(item => item.severity === 'critical').length,
    warning: active.filter(item => item.severity === 'warning').length,
  }
}

module.exports = {
  addOpsEvent,
  deleteAutomationTask,
  eventSummary,
  listAutomationTasks,
  listOpsEvents,
  loadAutomationState,
  loadEventState,
  markOpsEventsRead,
  recoverOpsEvent,
  runAutomationTask,
  runDueAutomationTasks,
  runHttpHealthCheck,
  saveAutomationTask,
  updateOpsEvent,
}
