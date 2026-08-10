const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')
const { addOpsEvent, recoverOpsEvent } = require('./ops-automation')

const STATE_VERSION = 1
const MAX_WATCHES = 100
const MAX_HISTORY_ITEMS = 10000
const MAX_HISTORY_PER_SERVICE = 576
const HISTORY_SAMPLE_INTERVAL_MS = 5 * 60_000

function monitorPath(userDataPath) {
  return path.join(userDataPath, 'node-service-monitor.json')
}

function historyPath(userDataPath) {
  return path.join(userDataPath, 'node-service-history.json')
}

function text(input, max = 300) {
  return String(input || '')
    .trim()
    .slice(0, max)
}

function normalizeProtocol(input) {
  const protocol = text(input, 10).toUpperCase()
  if (!['TCP', 'UDP'].includes(protocol)) throw new Error('仅支持关注 TCP 或 UDP 服务')
  return protocol
}

function normalizePort(input) {
  const port = Number.parseInt(String(input), 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('端口必须是 1 到 65535 之间的整数')
  return port
}

function watchId(protocol, port) {
  return `${protocol}:${port}`
}

function eventFingerprint(protocol, port) {
  return `node-service:${protocol.toLowerCase()}:${port}`
}

function normalizeWatch(input = {}) {
  const protocol = normalizeProtocol(input.protocol)
  const port = normalizePort(input.port)
  const now = Date.now()
  return {
    id: watchId(protocol, port),
    protocol,
    port,
    commandLabel: text(input.commandLabel || input.command, 300),
    enabled: input.enabled !== false,
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now,
    lastSeenAt: Number(input.lastSeenAt) || 0,
    lastState: ['online', 'offline', 'unknown'].includes(input.lastState)
      ? input.lastState
      : 'unknown',
    lastPid: Math.max(0, Number(input.lastPid || input.pid) || 0),
    lastAddress: text(input.lastAddress || input.address, 200)
  }
}

function loadNodeServiceMonitorState(userDataPath) {
  const stored = readJsonFile(monitorPath(userDataPath), { version: STATE_VERSION, items: [] })
  const items = []
  const seen = new Set()
  for (const raw of Array.isArray(stored?.items) ? stored.items : []) {
    try {
      const item = normalizeWatch(raw)
      if (!seen.has(item.id)) {
        seen.add(item.id)
        items.push(item)
      }
    } catch {}
  }
  return { version: STATE_VERSION, items: items.slice(0, MAX_WATCHES) }
}

function saveNodeServiceMonitorState(userDataPath, state) {
  const items = (Array.isArray(state?.items) ? state.items : [])
    .slice(0, MAX_WATCHES)
    .map(normalizeWatch)
  if (!writeJsonFile(monitorPath(userDataPath), { version: STATE_VERSION, items })) {
    throw new Error('保存 Node 服务关注列表失败')
  }
  return items
}

function listWatchedNodeServices(userDataPath) {
  return loadNodeServiceMonitorState(userDataPath).items
}

function normalizeHistoryEntry(input = {}) {
  const protocol = normalizeProtocol(input.protocol)
  const port = normalizePort(input.port)
  const serviceId = watchId(protocol, port)
  const state = ['online', 'offline', 'unknown'].includes(input.state) ? input.state : 'unknown'
  const hasCpuMetric = input.cpuPercent !== null && Number.isFinite(Number(input.cpuPercent))
  const hasMemoryMetric = input.memoryBytes !== null && Number.isFinite(Number(input.memoryBytes))
  const metricsAvailable =
    state === 'online' && hasCpuMetric && hasMemoryMetric && input.metricsAvailable !== false
  const metricsStatus =
    state !== 'online' ? 'not-applicable' : metricsAvailable ? 'available' : 'unavailable'
  return {
    id: text(input.id, 120) || `${serviceId}:${Number(input.checkedAt) || Date.now()}`,
    serviceId,
    protocol,
    port,
    state,
    pid: Math.max(0, Number(input.pid) || 0),
    cpuPercent: metricsAvailable ? Math.max(0, Number(input.cpuPercent) || 0) : null,
    memoryBytes: metricsAvailable ? Math.max(0, Number(input.memoryBytes) || 0) : null,
    metricsAvailable,
    metricsStatus,
    commandLabel: text(input.commandLabel || input.command, 300),
    checkedAt: Number(input.checkedAt) || Date.now()
  }
}

function loadNodeServiceHistory(userDataPath) {
  const stored = readJsonFile(historyPath(userDataPath), { version: STATE_VERSION, items: [] })
  const items = []
  for (const raw of Array.isArray(stored?.items) ? stored.items : []) {
    try {
      items.push(normalizeHistoryEntry(raw))
    } catch {}
  }
  return {
    version: STATE_VERSION,
    items: items.sort((a, b) => b.checkedAt - a.checkedAt).slice(0, MAX_HISTORY_ITEMS)
  }
}

function saveNodeServiceHistory(userDataPath, items) {
  const counts = new Map()
  const normalized = []
  for (const raw of Array.isArray(items) ? items : []) {
    let item
    try {
      item = normalizeHistoryEntry(raw)
    } catch {
      continue
    }
    const count = counts.get(item.serviceId) || 0
    if (count >= MAX_HISTORY_PER_SERVICE) continue
    counts.set(item.serviceId, count + 1)
    normalized.push(item)
    if (normalized.length >= MAX_HISTORY_ITEMS) break
  }
  if (!writeJsonFile(historyPath(userDataPath), { version: STATE_VERSION, items: normalized })) {
    throw new Error('保存 Node 服务历史失败')
  }
  return normalized
}

function listNodeServiceHistory(userDataPath, options = {}) {
  const serviceId = text(options.serviceId, 120)
  const since = Math.max(0, Number(options.since) || 0)
  const limit = Math.min(2000, Math.max(1, Number(options.limit) || 500))
  return loadNodeServiceHistory(userDataPath)
    .items.filter(
      (item) => (!serviceId || item.serviceId === serviceId) && (!since || item.checkedAt >= since)
    )
    .slice(0, limit)
}

function recordNodeServiceSamples(userDataPath, watches, entries, checkedAt) {
  const history = loadNodeServiceHistory(userDataPath).items
  const latestByService = new Map()
  for (const item of history) {
    if (!latestByService.has(item.serviceId)) latestByService.set(item.serviceId, item)
  }
  const activeEntries = Array.isArray(entries) ? entries : []
  const next = []
  for (const watch of Array.isArray(watches) ? watches : []) {
    if (!watch.enabled) continue
    const matched = activeEntries.find(
      (entry) =>
        text(entry.protocol, 10).toUpperCase() === watch.protocol &&
        Number(entry.port) === watch.port
    )
    const sample = normalizeHistoryEntry({
      protocol: watch.protocol,
      port: watch.port,
      state: matched ? 'online' : 'offline',
      pid: matched?.pid || 0,
      cpuPercent: matched?.cpuPercent,
      memoryBytes: matched?.memoryBytes,
      metricsAvailable: matched?.metricsAvailable,
      commandLabel: matched?.command || watch.commandLabel,
      checkedAt
    })
    const latest = latestByService.get(sample.serviceId)
    const changed =
      !latest ||
      latest.state !== sample.state ||
      latest.pid !== sample.pid ||
      latest.cpuPercent !== sample.cpuPercent ||
      latest.memoryBytes !== sample.memoryBytes ||
      latest.metricsStatus !== sample.metricsStatus
    if (!changed && sample.checkedAt - latest.checkedAt < HISTORY_SAMPLE_INTERVAL_MS) continue
    next.push(sample)
  }
  if (!next.length) return history
  return saveNodeServiceHistory(userDataPath, [...next, ...history])
}

function watchNodeService(userDataPath, input = {}) {
  const state = loadNodeServiceMonitorState(userDataPath)
  const protocol = normalizeProtocol(input.protocol)
  const port = normalizePort(input.port)
  const id = watchId(protocol, port)
  const existingIndex = state.items.findIndex((item) => item.id === id)
  const existing = existingIndex >= 0 ? state.items[existingIndex] : null
  const now = Date.now()
  const item = normalizeWatch({
    ...existing,
    ...input,
    id,
    protocol,
    port,
    enabled: true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastSeenAt: Number(input.lastSeenAt) || existing?.lastSeenAt || now,
    lastState: input.lastState || 'online',
    lastPid: input.pid || existing?.lastPid,
    lastAddress: input.address || existing?.lastAddress
  })
  if (existingIndex >= 0) state.items.splice(existingIndex, 1, item)
  else state.items.unshift(item)
  saveNodeServiceMonitorState(userDataPath, state)
  recoverOpsEvent(userDataPath, eventFingerprint(protocol, port), {
    message: `Node 服务 ${protocol} ${port} 已重新加入关注并处于运行状态`,
    relatedId: id,
    recoveredAt: now,
    attributes: { protocol, port, currentPid: item.lastPid }
  })
  return item
}

function unwatchNodeService(userDataPath, input = {}) {
  const protocol = normalizeProtocol(input.protocol)
  const port = normalizePort(input.port)
  const id = watchId(protocol, port)
  const state = loadNodeServiceMonitorState(userDataPath)
  const existing = state.items.find((item) => item.id === id)
  state.items = state.items.filter((item) => item.id !== id)
  saveNodeServiceMonitorState(userDataPath, state)
  recoverOpsEvent(userDataPath, eventFingerprint(protocol, port), {
    message: `已取消关注 Node 服务 ${protocol} ${port}，关联异常事件自动关闭`,
    relatedId: id,
    attributes: { protocol, port }
  })
  return existing || null
}

function checkWatchedNodeServices(userDataPath, entries = [], options = {}) {
  const state = loadNodeServiceMonitorState(userDataPath)
  const now = Number(options.now) || Date.now()
  const activeEntries = Array.isArray(entries) ? entries : []
  const changes = []

  for (const item of state.items) {
    if (!item.enabled) continue
    const matched = activeEntries.find((entry) => {
      try {
        return (
          normalizeProtocol(entry.protocol) === item.protocol &&
          normalizePort(entry.port) === item.port
        )
      } catch {
        return false
      }
    })

    if (matched) {
      const wasOffline = item.lastState === 'offline'
      const previousPid = item.lastPid
      item.lastState = 'online'
      item.lastSeenAt = now
      item.updatedAt = now
      item.lastPid = Math.max(0, Number(matched.pid) || 0)
      item.lastAddress = text(matched.address, 200)
      item.commandLabel = text(matched.command, 300) || item.commandLabel
      if (wasOffline) {
        recoverOpsEvent(userDataPath, eventFingerprint(item.protocol, item.port), {
          message: `Node 服务 ${item.protocol} ${item.port} 已恢复监听`,
          relatedId: item.id,
          recoveredAt: now,
          attributes: {
            protocol: item.protocol,
            port: item.port,
            previousPid,
            currentPid: matched.pid,
            command: matched.command || item.commandLabel
          }
        })
        changes.push({ id: item.id, type: 'recovered' })
      }
      continue
    }

    if (item.lastState !== 'offline') {
      const previousPid = item.lastPid
      item.lastState = 'offline'
      item.updatedAt = now
      addOpsEvent(userDataPath, {
        fingerprint: eventFingerprint(item.protocol, item.port),
        sourceType: 'node-service',
        sourceId: item.id,
        severity: 'critical',
        title: `Node 服务异常：${item.protocol} ${item.port} 停止监听`,
        description: item.commandLabel
          ? `关注的服务已停止监听，最近进程：${item.commandLabel}`
          : '关注的 Node 服务已停止监听，请检查进程状态。',
        relatedId: item.id,
        occurredAt: now,
        attributes: {
          protocol: item.protocol,
          port: item.port,
          command: item.commandLabel,
          previousPid,
          currentPid: 0
        }
      })
      changes.push({ id: item.id, type: 'offline' })
    }
  }

  saveNodeServiceMonitorState(userDataPath, state)
  try {
    recordNodeServiceSamples(userDataPath, state.items, activeEntries, now)
  } catch {}
  return { items: state.items, changes, checkedAt: now }
}

module.exports = {
  checkWatchedNodeServices,
  eventFingerprint,
  listNodeServiceHistory,
  listWatchedNodeServices,
  loadNodeServiceHistory,
  loadNodeServiceMonitorState,
  recordNodeServiceSamples,
  saveNodeServiceHistory,
  saveNodeServiceMonitorState,
  unwatchNodeService,
  watchNodeService
}
