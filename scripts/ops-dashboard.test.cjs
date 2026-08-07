const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { buildOpsDashboardData } = require('../src/main/utils/ops-dashboard')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcMain: { handle: () => {} },
      net: {},
      clipboard: { writeText: () => {} },
      app: { getPath: () => '/tmp' },
      Notification: class {}
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const { __testables } = require('../src/main/ipc/model-test')
Module._load = originalLoad

const modelHistory = [
  {
    id: 'latest',
    source: 'scheduled',
    label: '定时巡检',
    startedAt: 200,
    finishedAt: 300,
    summary: { total: 4, ok: 2, failed: 1, gateway: 1, durationMs: 100 },
    results: [{ model: 'should-not-cross-ipc' }]
  },
  {
    id: 'older',
    source: 'manual',
    label: '手动测试',
    startedAt: 100,
    finishedAt: 150,
    summary: { total: 2, ok: 2, failed: 0, gateway: 0, durationMs: 50 },
    results: [{ model: 'older-result' }]
  }
]

test('首页模型可用率按最近测试结果聚合', () => {
  const dashboard = buildOpsDashboardData({ modelHistory, generatedAt: 123 })

  assert.equal(dashboard.generatedAt, 123)
  assert.equal(dashboard.model.inspections, 2)
  assert.equal(dashboard.model.availability, 66.7)
})

test('首页趋势包含无法验证数量且按时间正序返回', () => {
  const dashboard = buildOpsDashboardData({ modelHistory })

  assert.deepEqual(dashboard.model.trend, [
    { timestamp: 150, ok: 2, failed: 0, gateway: 0, total: 2 },
    { timestamp: 300, ok: 2, failed: 1, gateway: 1, total: 4 }
  ])
})

test('首页最近巡检只返回展示字段，不携带完整模型结果', () => {
  const dashboard = buildOpsDashboardData({ modelHistory })

  assert.deepEqual(dashboard.model.latest, {
    id: 'latest',
    source: 'scheduled',
    label: '定时巡检',
    startedAt: 200,
    finishedAt: 300,
    summary: { total: 4, ok: 2, failed: 1, gateway: 1, durationMs: 100 }
  })
  assert.equal(Object.hasOwn(dashboard.model.latest, 'results'), false)
})

test('首页最近发布只返回展示字段，不暴露回滚备份信息', () => {
  const releaseHistory = [
    {
      id: 'release-1',
      action: 'deploy',
      status: 'success',
      label: '前端发布',
      message: '发布成功',
      remoteDir: '/srv/app',
      startedAt: 400,
      finishedAt: 500,
      backupPath: '/srv/.ops-release-backups/release-1',
      archiveRoots: ['dist'],
      sourceReleaseId: 'source-release'
    }
  ]
  const dashboard = buildOpsDashboardData({ releaseHistory })

  assert.deepEqual(dashboard.release.latest, [
    {
      id: 'release-1',
      action: 'deploy',
      status: 'success',
      label: '前端发布',
      message: '发布成功',
      remoteDir: '/srv/app',
      startedAt: 400,
      finishedAt: 500
    }
  ])
  assert.equal(Object.hasOwn(dashboard.release.latest[0], 'backupPath'), false)
  assert.equal(Object.hasOwn(dashboard.release.latest[0], 'archiveRoots'), false)
})

test('首页巡检设置只返回目标数量，不返回完整目标列表', () => {
  const dashboard = buildOpsDashboardData({
    monitor: {
      enabled: true,
      intervalMinutes: 30,
      notifyOnFailure: false,
      targets: [{ providerId: 'p1', appType: 'claude', model: 'm1' }],
      lastRunAt: 100,
      nextRunAt: 200
    }
  })

  assert.deepEqual(dashboard.monitor, {
    enabled: true,
    intervalMinutes: 30,
    notifyOnFailure: false,
    lastRunAt: 100,
    nextRunAt: 200,
    targetCount: 1
  })
  assert.equal(Object.hasOwn(dashboard.monitor, 'targets'), false)
})

test('首页发布成功与失败指标不把回滚记录算作发布', () => {
  const dashboard = buildOpsDashboardData({
    releaseHistory: [
      { id: 'rollback', action: 'rollback', status: 'success' },
      { id: 'deploy-ok', action: 'deploy', status: 'success' },
      { id: 'deploy-failed', action: 'deploy', status: 'failed' }
    ]
  })

  assert.deepEqual(dashboard.release, {
    total: 3,
    success: 1,
    failed: 1,
    latest: [
      {
        id: 'rollback',
        action: 'rollback',
        status: 'success',
        label: '',
        message: '',
        remoteDir: '',
        startedAt: 0,
        finishedAt: 0
      },
      {
        id: 'deploy-ok',
        action: 'deploy',
        status: 'success',
        label: '',
        message: '',
        remoteDir: '',
        startedAt: 0,
        finishedAt: 0
      },
      {
        id: 'deploy-failed',
        action: 'deploy',
        status: 'failed',
        label: '',
        message: '',
        remoteDir: '',
        startedAt: 0,
        finishedAt: 0
      }
    ]
  })
})

test('首页备份摘要只返回健康状态与时间，不暴露路径、密码或问题详情', () => {
  const dashboard = buildOpsDashboardData({
    backup: {
      health: {
        status: 'warning',
        summary: '1 个自动备份文件已缺失，可在历史中清理记录',
        lastSuccessfulAt: 100,
        missingCount: 1,
        freeBytes: 1024,
        issues: [{ id: 'missing-files', message: '不应发送完整问题详情' }]
      },
      settings: {
        enabled: true,
        nextRunAt: 200,
        outputDirectory: '/private/backup-directory',
        passwordEncrypted: 'secret-ciphertext'
      }
    }
  })

  assert.deepEqual(dashboard.backup, {
    enabled: true,
    status: 'warning',
    summary: '1 个自动备份文件已缺失，可在历史中清理记录',
    lastSuccessfulAt: 100,
    nextRunAt: 200,
    missingCount: 1,
    freeBytes: 1024
  })
  assert.equal(Object.hasOwn(dashboard.backup, 'outputDirectory'), false)
  assert.equal(Object.hasOwn(dashboard.backup, 'passwordEncrypted'), false)
  assert.equal(Object.hasOwn(dashboard.backup, 'issues'), false)
})

test('首页事件摘要与最近事件仅返回稳定安全字段', () => {
  const dashboard = buildOpsDashboardData({
    eventTotals: {
      total: 9,
      active: 8,
      open: 6,
      acknowledged: 2,
      resolved: 1,
      recovered: 3,
      unread: 4,
      unreadCritical: 2,
      critical: 2,
      warning: 3
    },
    events: [
      {
        id: 'resolved',
        status: 'resolved',
        updatedAt: 999,
        attributes: { secret: 'must-not-cross-ipc' },
        timeline: [{ message: 'must-not-cross-ipc' }],
        fingerprint: 'must-not-cross-ipc'
      },
      {
        id: 'latest',
        sourceType: 'automation',
        sourceId: 'task-1',
        severity: 'warning',
        status: 'open',
        title: '巡检失败',
        description: '健康检查失败',
        occurrenceCount: 4,
        lastOccurredAt: 600,
        updatedAt: 700,
        attributes: { secret: 'must-not-cross-ipc' },
        timeline: [{ message: 'must-not-cross-ipc' }],
        fingerprint: 'must-not-cross-ipc'
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `event-${index + 1}`,
        status: 'acknowledged',
        updatedAt: 600 - index
      }))
    ]
  })

  assert.deepEqual(dashboard.events.summary, {
    total: 9,
    active: 8,
    open: 6,
    acknowledged: 2,
    resolved: 1,
    recovered: 3,
    unread: 4,
    unreadCritical: 2,
    critical: 2,
    warning: 3
  })
  assert.equal(dashboard.events.latest.length, 6)
  assert.deepEqual(
    dashboard.events.latest.map((item) => item.id),
    ['latest', 'event-1', 'event-2', 'event-3', 'event-4', 'event-5']
  )
  assert.deepEqual(dashboard.events.latest[0], {
    id: 'latest',
    sourceType: 'automation',
    sourceId: 'task-1',
    severity: 'warning',
    status: 'open',
    title: '巡检失败',
    occurrenceCount: 4,
    lastOccurredAt: 600,
    updatedAt: 700
  })
  assert.equal(Object.hasOwn(dashboard.events.latest[0], 'description'), false)
  assert.equal(Object.hasOwn(dashboard.events.latest[0], 'attributes'), false)
  assert.equal(Object.hasOwn(dashboard.events.latest[0], 'timeline'), false)
  assert.equal(Object.hasOwn(dashboard.events.latest[0], 'fingerprint'), false)
  assert.equal(
    dashboard.events.latest.some((item) => item.id === 'resolved'),
    false
  )
})

test('首页自动化摘要只按启用任务的最近结果分类', () => {
  const dashboard = buildOpsDashboardData({
    automationTasks: [
      { enabled: true, lastResult: { ok: true }, nextRunAt: 500 },
      { enabled: true, lastResult: { ok: false }, nextRunAt: 300 },
      { enabled: true, lastResult: null, nextRunAt: 700 },
      { enabled: false, lastResult: { ok: true }, nextRunAt: 100 },
      { enabled: false, lastResult: { ok: false }, nextRunAt: 200 }
    ]
  })

  assert.deepEqual(dashboard.automation, {
    total: 5,
    enabled: 3,
    healthy: 1,
    failing: 1,
    pending: 1,
    nextRunAt: 300
  })
})

test('首页 Node 服务摘要只统计启用关注项并聚合最近检查时间', () => {
  const dashboard = buildOpsDashboardData({
    nodeServices: [
      { enabled: true, lastState: 'online', updatedAt: 100, lastSeenAt: 800 },
      { enabled: true, lastState: 'offline', updatedAt: 500, lastSeenAt: 300 },
      { enabled: true, lastState: 'unknown', updatedAt: 0, lastSeenAt: 250 },
      { enabled: false, lastState: 'online', updatedAt: 9000, lastSeenAt: 10_000 }
    ]
  })

  assert.deepEqual(dashboard.nodeServices, {
    total: 4,
    enabled: 3,
    online: 1,
    offline: 1,
    unknown: 1,
    lastCheckedAt: 800
  })
})

test('首页 IPC 聚合使用同一 userData 路径接入事件、任务、Node 服务和备份', () => {
  const calls = []
  const result = __testables.dashboardData({
    getUserDataPath: () => '/tmp/ops-user-data',
    getActiveProfile: () => ({ id: 'production' }),
    loadModelHistory: () => ['model-history'],
    loadReleaseRecords: (options) => {
      calls.push(['release', options])
      return ['release-history']
    },
    loadMonitor: () => ({ enabled: true }),
    getBackupHealth: (userDataPath) => {
      calls.push(['backup-health', userDataPath])
      return { status: 'healthy' }
    },
    getBackupSettings: (userDataPath) => {
      calls.push(['backup-settings', userDataPath])
      return { enabled: true }
    },
    listEvents: (userDataPath, options) => {
      calls.push(['events', userDataPath, options])
      return ['event']
    },
    getEventTotals: (userDataPath) => {
      calls.push(['event-totals', userDataPath])
      return { active: 1 }
    },
    listTasks: (userDataPath) => {
      calls.push(['automation', userDataPath])
      return ['task']
    },
    listNodeServices: (userDataPath) => {
      calls.push(['node-services', userDataPath])
      return ['service']
    },
    buildDashboard: (input) => input
  })

  assert.deepEqual(result, {
    modelHistory: ['model-history'],
    releaseHistory: ['release-history'],
    monitor: { enabled: true },
    backup: {
      health: { status: 'healthy' },
      settings: { enabled: true }
    },
    events: ['event'],
    eventTotals: { active: 1 },
    automationTasks: ['task'],
    nodeServices: ['service']
  })
  assert.deepEqual(calls, [
    ['release', { profileId: 'production' }],
    ['backup-health', '/tmp/ops-user-data'],
    ['backup-settings', '/tmp/ops-user-data'],
    ['events', '/tmp/ops-user-data', { limit: 500 }],
    ['event-totals', '/tmp/ops-user-data'],
    ['automation', '/tmp/ops-user-data'],
    ['node-services', '/tmp/ops-user-data']
  ])
})

test('首页新增摘要缺省字段均为零值', () => {
  const dashboard = buildOpsDashboardData()

  assert.deepEqual(dashboard.events, {
    summary: {
      total: 0,
      active: 0,
      open: 0,
      acknowledged: 0,
      resolved: 0,
      recovered: 0,
      unread: 0,
      unreadCritical: 0,
      critical: 0,
      warning: 0
    },
    latest: []
  })
  assert.deepEqual(dashboard.automation, {
    total: 0,
    enabled: 0,
    healthy: 0,
    failing: 0,
    pending: 0,
    nextRunAt: 0
  })
  assert.deepEqual(dashboard.nodeServices, {
    total: 0,
    enabled: 0,
    online: 0,
    offline: 0,
    unknown: 0,
    lastCheckedAt: 0
  })
})
