const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')

const STATE_VERSION = 1
const MAX_REASON_LENGTH = 300
const MAX_FUTURE_MS = 30 * 24 * 60 * 60_000
const MAX_DURATION_MS = 7 * 24 * 60 * 60_000

function maintenanceWindowPath(userDataPath) {
  return path.join(userDataPath, 'ops-maintenance-window.json')
}

function defaultMaintenanceWindow() {
  return {
    version: STATE_VERSION,
    enabled: false,
    startAt: 0,
    endAt: 0,
    reason: '',
    updatedAt: 0
  }
}

function boundedText(value, max = MAX_REASON_LENGTH) {
  return String(value || '')
    .trim()
    .slice(0, max)
}

function normalizedTimestamp(value) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.round(timestamp) : 0
}

function normalizeMaintenanceWindow(input = {}, { now = Date.now(), strict = false } = {}) {
  const enabled = input.enabled === true
  const startAt = enabled ? normalizedTimestamp(input.startAt) : 0
  const endAt = enabled ? normalizedTimestamp(input.endAt) : 0
  if (enabled && strict) {
    if (!startAt || !endAt || endAt <= startAt) {
      throw new Error('维护窗口的结束时间必须晚于开始时间')
    }
    if (startAt > now + MAX_FUTURE_MS) throw new Error('维护窗口最多可提前 30 天设置')
    if (endAt - startAt > MAX_DURATION_MS) throw new Error('单个维护窗口最长为 7 天')
    if (endAt <= now) throw new Error('维护窗口结束时间必须晚于当前时间')
  }
  return {
    version: STATE_VERSION,
    enabled,
    startAt,
    endAt,
    reason: enabled ? boundedText(input.reason) : '',
    updatedAt: normalizedTimestamp(input.updatedAt) || Math.round(now)
  }
}

function maintenanceWindowStatus(window, now = Date.now()) {
  const item = normalizeMaintenanceWindow(window, { now })
  if (!item.enabled) return 'disabled'
  if (now < item.startAt) return 'upcoming'
  if (now < item.endAt) return 'active'
  return 'expired'
}

function withMaintenanceStatus(window, now = Date.now()) {
  const item = normalizeMaintenanceWindow(window, { now })
  const status = maintenanceWindowStatus(item, now)
  return {
    ...item,
    status,
    active: status === 'active',
    resumeAt: status === 'active' ? item.endAt : 0,
    scopes: ['model-monitor', 'automation', 'data-backup']
  }
}

function loadMaintenanceWindow(userDataPath, { now = Date.now() } = {}) {
  const stored = readJsonFile(maintenanceWindowPath(userDataPath), defaultMaintenanceWindow())
  try {
    return withMaintenanceStatus(stored, now)
  } catch {
    return withMaintenanceStatus(defaultMaintenanceWindow(), now)
  }
}

function saveMaintenanceWindow(userDataPath, input = {}, { now = Date.now() } = {}) {
  const normalized = normalizeMaintenanceWindow(input, { now, strict: true })
  if (!writeJsonFile(maintenanceWindowPath(userDataPath), normalized)) {
    throw new Error('保存维护窗口失败')
  }
  return withMaintenanceStatus(normalized, now)
}

function activeMaintenanceWindow(userDataPath, { now = Date.now() } = {}) {
  const window = loadMaintenanceWindow(userDataPath, { now })
  return window.active ? window : null
}

module.exports = {
  MAX_DURATION_MS,
  MAX_FUTURE_MS,
  activeMaintenanceWindow,
  defaultMaintenanceWindow,
  loadMaintenanceWindow,
  maintenanceWindowStatus,
  normalizeMaintenanceWindow,
  saveMaintenanceWindow,
  withMaintenanceStatus
}
