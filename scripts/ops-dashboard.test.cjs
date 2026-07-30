const test = require('node:test')
const assert = require('node:assert/strict')
const { buildOpsDashboardData } = require('../src/main/utils/ops-dashboard')

const modelHistory = [
  {
    id: 'latest',
    source: 'scheduled',
    label: '定时巡检',
    startedAt: 200,
    finishedAt: 300,
    summary: { total: 4, ok: 2, failed: 1, gateway: 1, durationMs: 100 },
    results: [{ model: 'should-not-cross-ipc' }],
  },
  {
    id: 'older',
    source: 'manual',
    label: '手动测试',
    startedAt: 100,
    finishedAt: 150,
    summary: { total: 2, ok: 2, failed: 0, gateway: 0, durationMs: 50 },
    results: [{ model: 'older-result' }],
  },
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
    { timestamp: 300, ok: 2, failed: 1, gateway: 1, total: 4 },
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
    summary: { total: 4, ok: 2, failed: 1, gateway: 1, durationMs: 100 },
  })
  assert.equal(Object.hasOwn(dashboard.model.latest, 'results'), false)
})

test('首页最近发布只返回展示字段，不暴露回滚备份信息', () => {
  const releaseHistory = [{
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
    sourceReleaseId: 'source-release',
  }]
  const dashboard = buildOpsDashboardData({ releaseHistory })

  assert.deepEqual(dashboard.release.latest, [{
    id: 'release-1',
    action: 'deploy',
    status: 'success',
    label: '前端发布',
    message: '发布成功',
    remoteDir: '/srv/app',
    startedAt: 400,
    finishedAt: 500,
  }])
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
      nextRunAt: 200,
    },
  })

  assert.deepEqual(dashboard.monitor, {
    enabled: true,
    intervalMinutes: 30,
    notifyOnFailure: false,
    lastRunAt: 100,
    nextRunAt: 200,
    targetCount: 1,
  })
  assert.equal(Object.hasOwn(dashboard.monitor, 'targets'), false)
})

test('首页发布成功与失败指标不把回滚记录算作发布', () => {
  const dashboard = buildOpsDashboardData({
    releaseHistory: [
      { id: 'rollback', action: 'rollback', status: 'success' },
      { id: 'deploy-ok', action: 'deploy', status: 'success' },
      { id: 'deploy-failed', action: 'deploy', status: 'failed' },
    ],
  })

  assert.deepEqual(dashboard.release, {
    total: 3,
    success: 1,
    failed: 1,
    latest: [
      { id: 'rollback', action: 'rollback', status: 'success', label: '', message: '', remoteDir: '', startedAt: 0, finishedAt: 0 },
      { id: 'deploy-ok', action: 'deploy', status: 'success', label: '', message: '', remoteDir: '', startedAt: 0, finishedAt: 0 },
      { id: 'deploy-failed', action: 'deploy', status: 'failed', label: '', message: '', remoteDir: '', startedAt: 0, finishedAt: 0 },
    ],
  })
})
