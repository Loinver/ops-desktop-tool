const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isWithinQuietHours,
  loadNotificationPreferences,
  notificationContent,
  notificationDecision,
  saveNotificationPreferences,
} = require('../src/main/utils/ops-notification-preferences')
const {
  addOpsEvent,
  onOpsEventChange,
  recoverOpsEvent,
} = require('../src/main/utils/ops-automation')

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-notification-'))
}

function warningChange(overrides = {}) {
  return {
    kind: 'opened',
    item: {
      id: 'event-1',
      fingerprint: 'node-service:tcp:3000',
      sourceType: 'node-service',
      severity: 'warning',
      title: 'Node 服务离线',
      description: 'TCP 3000 未监听',
      attributes: {},
      ...overrides,
    },
  }
}

test('通知偏好使用安全默认值并支持增量持久化', () => {
  const userDataPath = createTempDir()
  try {
    const initial = loadNotificationPreferences(userDataPath)
    assert.equal(initial.desktopEnabled, true)
    assert.equal(initial.severities.info, false)
    assert.equal(initial.sources['node-service'], true)
    assert.equal(initial.sources['data-backup'], true)

    const saved = saveNotificationPreferences(userDataPath, {
      soundEnabled: false,
      repeatIntervalMinutes: 30,
      quietHours: { enabled: true, start: '23:30', end: '07:15' },
      severities: { info: true },
      sources: { copilot: false, 'data-backup': false },
    })
    assert.equal(saved.soundEnabled, false)
    assert.equal(saved.repeatIntervalMinutes, 30)
    assert.equal(saved.quietHours.start, '23:30')
    assert.equal(saved.severities.critical, true)
    assert.equal(saved.severities.info, true)
    assert.equal(saved.sources.copilot, false)
    assert.equal(saved.sources['data-backup'], false)
    assert.deepEqual(loadNotificationPreferences(userDataPath), saved)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('免打扰时段支持日内和跨午夜范围', () => {
  const dayRange = { ...DEFAULT_NOTIFICATION_PREFERENCES, quietHours: { enabled: true, start: '09:00', end: '12:00' } }
  assert.equal(isWithinQuietHours(dayRange, new Date(2026, 6, 31, 10, 0)), true)
  assert.equal(isWithinQuietHours(dayRange, new Date(2026, 6, 31, 13, 0)), false)

  const overnight = { ...DEFAULT_NOTIFICATION_PREFERENCES, quietHours: { enabled: true, start: '22:00', end: '08:00' } }
  assert.equal(isWithinQuietHours(overnight, new Date(2026, 6, 31, 23, 0)), true)
  assert.equal(isWithinQuietHours(overnight, new Date(2026, 7, 1, 7, 59)), true)
  assert.equal(isWithinQuietHours(overnight, new Date(2026, 7, 1, 12, 0)), false)
})

test('通知决策遵循严重度、来源、前台、恢复和重复间隔设置', () => {
  const now = new Date(2026, 6, 31, 14, 0).getTime()
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, quietHours: { enabled: false, start: '22:00', end: '08:00' } }
  const allowed = notificationDecision({ change: warningChange(), preferences, now })
  assert.equal(allowed.notify, true)

  assert.equal(notificationDecision({ change: warningChange(), preferences, now, isFocused: true }).reason, 'focused')
  assert.equal(notificationDecision({ change: warningChange({ severity: 'info' }), preferences, now }).reason, 'severity-disabled')
  assert.equal(notificationDecision({
    change: warningChange(),
    preferences: { ...preferences, sources: { ...preferences.sources, 'node-service': false } },
    now,
  }).reason, 'source-disabled')
  assert.equal(notificationDecision({
    change: { ...warningChange(), kind: 'recovered' },
    preferences: { ...preferences, notifyRecoveries: false },
    now,
  }).reason, 'recovery-disabled')
  assert.equal(notificationDecision({
    change: warningChange({ attributes: { desktopNotification: false } }),
    preferences,
    now,
  }).reason, 'event-disabled')
  assert.equal(notificationDecision({
    change: warningChange(),
    preferences,
    now,
    lastNotifiedAt: now - 5 * 60_000,
  }).reason, 'throttled')
})

test('桌面通知内容区分异常和恢复', () => {
  const incident = notificationContent(warningChange())
  assert.match(incident.title, /告警事件/)
  assert.match(incident.title, /Node 服务/)
  assert.match(incident.body, /Node 服务离线/)

  const recovered = notificationContent({
    ...warningChange({ resolutionNote: 'TCP 3000 已恢复监听' }),
    kind: 'recovered',
  })
  assert.match(recovered.title, /事件已恢复/)
  assert.match(recovered.body, /已恢复监听/)
})

test('统一事件在新增和恢复时发布通知生命周期变更', () => {
  const userDataPath = createTempDir()
  const changes = []
  const unsubscribe = onOpsEventChange(change => changes.push(change))
  try {
    addOpsEvent(userDataPath, {
      fingerprint: 'automation:test',
      sourceType: 'automation',
      severity: 'warning',
      title: '巡检异常',
    })
    recoverOpsEvent(userDataPath, 'automation:test', { message: '巡检恢复' })
    assert.deepEqual(changes.map(item => item.kind), ['opened', 'recovered'])
    assert.equal(changes[0].item.title, '巡检异常')
    assert.equal(changes[1].item.status, 'resolved')
  } finally {
    unsubscribe()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})
