const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')

const PREFERENCES_VERSION = 1
const KNOWN_SOURCES = [
  'release',
  'model-monitor',
  'model',
  'automation',
  'log',
  'copilot',
  'node-service',
  'data-backup',
  'system'
]
const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  version: PREFERENCES_VERSION,
  desktopEnabled: true,
  soundEnabled: true,
  showWhenFocused: false,
  notifyRecoveries: true,
  repeatIntervalMinutes: 15,
  quietHours: Object.freeze({ enabled: false, start: '22:00', end: '08:00' }),
  severities: Object.freeze({ critical: true, warning: true, info: false }),
  sources: Object.freeze(Object.fromEntries(KNOWN_SOURCES.map((source) => [source, true])))
})

function preferencesPath(userDataPath) {
  return path.join(userDataPath, 'ops-notification-preferences.json')
}

function normalizeTime(value, fallback) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/)
  if (!match) return fallback
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours <= 23 && minutes <= 59 ? `${match[1]}:${match[2]}` : fallback
}

function normalizeNotificationPreferences(input = {}, current = DEFAULT_NOTIFICATION_PREFERENCES) {
  const currentQuietHours = current?.quietHours || DEFAULT_NOTIFICATION_PREFERENCES.quietHours
  const inputQuietHours = input?.quietHours || {}
  const currentSeverities = current?.severities || DEFAULT_NOTIFICATION_PREFERENCES.severities
  const inputSeverities = input?.severities || {}
  const currentSources = current?.sources || DEFAULT_NOTIFICATION_PREFERENCES.sources
  const inputSources = input?.sources || {}
  const sources = {}

  for (const source of KNOWN_SOURCES) {
    sources[source] =
      source in inputSources ? inputSources[source] !== false : currentSources[source] !== false
  }

  return {
    version: PREFERENCES_VERSION,
    desktopEnabled:
      'desktopEnabled' in input ? input.desktopEnabled !== false : current.desktopEnabled !== false,
    soundEnabled:
      'soundEnabled' in input ? input.soundEnabled !== false : current.soundEnabled !== false,
    showWhenFocused:
      'showWhenFocused' in input
        ? input.showWhenFocused === true
        : current.showWhenFocused === true,
    notifyRecoveries:
      'notifyRecoveries' in input
        ? input.notifyRecoveries !== false
        : current.notifyRecoveries !== false,
    repeatIntervalMinutes: Math.max(
      1,
      Math.min(1440, Number(input.repeatIntervalMinutes ?? current.repeatIntervalMinutes) || 15)
    ),
    quietHours: {
      enabled:
        'enabled' in inputQuietHours
          ? inputQuietHours.enabled === true
          : currentQuietHours.enabled === true,
      start: normalizeTime(inputQuietHours.start, normalizeTime(currentQuietHours.start, '22:00')),
      end: normalizeTime(inputQuietHours.end, normalizeTime(currentQuietHours.end, '08:00'))
    },
    severities: {
      critical:
        'critical' in inputSeverities
          ? inputSeverities.critical !== false
          : currentSeverities.critical !== false,
      warning:
        'warning' in inputSeverities
          ? inputSeverities.warning !== false
          : currentSeverities.warning !== false,
      info:
        'info' in inputSeverities ? inputSeverities.info === true : currentSeverities.info === true
    },
    sources
  }
}

function loadNotificationPreferences(userDataPath) {
  return normalizeNotificationPreferences(readJsonFile(preferencesPath(userDataPath), {}))
}

function saveNotificationPreferences(userDataPath, changes = {}) {
  const next = normalizeNotificationPreferences(changes, loadNotificationPreferences(userDataPath))
  if (!writeJsonFile(preferencesPath(userDataPath), next)) throw new Error('保存通知偏好失败')
  return next
}

function minutesOfDay(time) {
  const [hours, minutes] = String(time).split(':').map(Number)
  return hours * 60 + minutes
}

function isWithinQuietHours(preferences, now = new Date()) {
  const quietHours = preferences?.quietHours
  if (!quietHours?.enabled) return false
  const start = minutesOfDay(normalizeTime(quietHours.start, '22:00'))
  const end = minutesOfDay(normalizeTime(quietHours.end, '08:00'))
  if (start === end) return false
  const current = now.getHours() * 60 + now.getMinutes()
  return start < end ? current >= start && current < end : current >= start || current < end
}

function notificationKind(change = {}) {
  if (change.kind === 'recovered') return 'recovered'
  if (['opened', 'reopened', 'occurred'].includes(change.kind)) return change.kind
  return ''
}

function notificationDecision({
  change = {},
  preferences,
  now = Date.now(),
  isFocused = false,
  lastNotifiedAt = 0
} = {}) {
  const prefs = normalizeNotificationPreferences(preferences || {})
  const item = change.item || {}
  const kind = notificationKind(change)
  const severity = ['critical', 'warning', 'info'].includes(item.severity) ? item.severity : 'info'
  const source = String(item.sourceType || item.category || 'system')

  if (!prefs.desktopEnabled) return { notify: false, reason: 'disabled' }
  if (item.attributes?.desktopNotification === false)
    return { notify: false, reason: 'event-disabled' }
  if (!kind) return { notify: false, reason: 'unsupported-kind' }
  if (kind === 'recovered' && !prefs.notifyRecoveries)
    return { notify: false, reason: 'recovery-disabled' }
  if (prefs.severities[severity] === false) return { notify: false, reason: 'severity-disabled' }
  if (prefs.sources[source] === false) return { notify: false, reason: 'source-disabled' }
  if (!prefs.showWhenFocused && isFocused) return { notify: false, reason: 'focused' }
  if (isWithinQuietHours(prefs, new Date(now))) return { notify: false, reason: 'quiet-hours' }

  const key = `${String(item.fingerprint || item.id || item.title || 'event')}:${kind === 'recovered' ? 'recovered' : 'incident'}`
  const repeatIntervalMs = prefs.repeatIntervalMinutes * 60_000
  if (lastNotifiedAt > 0 && now - lastNotifiedAt < repeatIntervalMs) {
    return { notify: false, reason: 'throttled', key }
  }
  return { notify: true, reason: 'allowed', key }
}

const SOURCE_LABELS = {
  release: '系统发布',
  'model-monitor': '模型巡检',
  model: '模型测试',
  automation: '自动化巡检',
  log: '日志分析',
  copilot: 'AI Copilot',
  'node-service': 'Node 服务',
  'data-backup': '本地数据备份',
  system: '系统'
}

function notificationContent(change = {}) {
  const item = change.item || {}
  const recovered = change.kind === 'recovered'
  const source =
    SOURCE_LABELS[item.sourceType || item.category] || item.sourceType || item.category || '系统'
  const severityLabel =
    item.severity === 'critical'
      ? '严重事件'
      : item.severity === 'warning'
        ? '告警事件'
        : '运维事件'
  const title = recovered ? `事件已恢复 · ${source}` : `${severityLabel} · ${source}`
  const headline = String(
    item.title || (recovered ? '检测结果已恢复正常' : '发现新的运维事件')
  ).trim()
  const detail = String(
    recovered ? item.resolutionNote || item.description : item.description || ''
  ).trim()
  return {
    title: title.slice(0, 120),
    body: `${headline}${detail && detail !== headline ? `\n${detail}` : ''}`.slice(0, 500)
  }
}

module.exports = {
  DEFAULT_NOTIFICATION_PREFERENCES,
  KNOWN_SOURCES,
  isWithinQuietHours,
  loadNotificationPreferences,
  normalizeNotificationPreferences,
  notificationContent,
  notificationDecision,
  preferencesPath,
  saveNotificationPreferences
}
