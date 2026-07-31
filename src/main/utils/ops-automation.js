const crypto = require('node:crypto')
const net = require('node:net')
const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')

const MAX_EVENTS = 500
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
function loadEventState(userDataPath) {
  const stored = readJsonFile(eventsPath(userDataPath), { version: 1, items: [] })
  return { version: 1, items: Array.isArray(stored?.items) ? stored.items.slice(0, MAX_EVENTS) : [] }
}
function saveEventState(userDataPath, state) {
  if (!writeJsonFile(eventsPath(userDataPath), { version: 1, items: state.items.slice(0, MAX_EVENTS) })) throw new Error('保存运维事件失败')
}
function addOpsEvent(userDataPath, input = {}) {
  const state = loadEventState(userDataPath)
  const sourceKey = value(input.sourceKey, 180)
  const timestamp = Number(input.createdAt) || Date.now()
  const existingIndex = sourceKey ? state.items.findIndex(item => item.sourceKey === sourceKey) : -1
  const normalized = {
    id: existingIndex >= 0 ? state.items[existingIndex].id : crypto.randomUUID(),
    sourceKey,
    category: value(input.category, 40) || 'system',
    level: normalizeLevel(input.level),
    status: existingIndex >= 0 ? normalizeEventStatus(state.items[existingIndex].status) : normalizeEventStatus(input.status),
    title: value(input.title, 160) || '运维事件',
    description: value(input.description, 1000),
    relatedId: value(input.relatedId, 160),
    createdAt: existingIndex >= 0 ? Number(state.items[existingIndex].createdAt) || timestamp : timestamp,
    updatedAt: Date.now(),
  }
  if (existingIndex >= 0) state.items.splice(existingIndex, 1, { ...state.items[existingIndex], ...normalized })
  else state.items.unshift(normalized)
  state.items.sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
  saveEventState(userDataPath, state)
  return normalized
}
function updateOpsEvent(userDataPath, id, status) {
  const state = loadEventState(userDataPath)
  const item = state.items.find(entry => entry.id === id)
  if (!item) throw new Error('运维事件不存在')
  item.status = normalizeEventStatus(status)
  item.updatedAt = Date.now()
  saveEventState(userDataPath, state)
  return item
}
function listOpsEvents(userDataPath, { status = '', limit = 100 } = {}) {
  const normalizedStatus = status ? normalizeEventStatus(status) : ''
  return loadEventState(userDataPath).items
    .filter(item => !normalizedStatus || item.status === normalizedStatus)
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 100)))
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
  const next = state.tasks.filter(item => item.id !== id)
  if (next.length === state.tasks.length) throw new Error('自动化任务不存在')
  state.tasks = next
  saveAutomationState(userDataPath, state)
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
  // 成功运行保留在任务历史中；只有异常写入事件中心，避免高频巡检淹没待处理告警。
  if (!entry.ok) {
    addOpsEvent(userDataPath, {
      sourceKey: `automation:${task.id}:${entry.id}`,
      category: 'automation',
      level: 'warning',
      title: `巡检失败：${task.title}`,
      description: entry.message,
      relatedId: task.id,
      createdAt: completedAt,
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
  const items = listOpsEvents(userDataPath, { limit: 200 })
  return {
    total: items.length,
    open: items.filter(item => item.status === 'open').length,
    critical: items.filter(item => item.status === 'open' && item.level === 'critical').length,
    warning: items.filter(item => item.status === 'open' && item.level === 'warning').length,
  }
}

module.exports = {
  addOpsEvent,
  deleteAutomationTask,
  eventSummary,
  listAutomationTasks,
  listOpsEvents,
  loadAutomationState,
  runAutomationTask,
  runDueAutomationTasks,
  runHttpHealthCheck,
  saveAutomationTask,
  updateOpsEvent,
}
