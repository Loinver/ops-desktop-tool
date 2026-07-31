const test = require('node:test')
const assert = require('node:assert/strict')
const {
  completeMonitorRun,
  countMonitorAnomalies,
  normalizeMonitorSettings,
  updateMonitorSettings,
} = require('../src/main/utils/model-monitor')

const target = {
  providerId: 'p1',
  providerName: 'Provider 1',
  appType: 'claude',
  model: 'm1',
  beta1m: false,
}

test('巡检完成不会重新启用用户刚关闭的定时巡检', () => {
  const completedAt = 1_800_000_000_000
  const settings = {
    enabled: false,
    intervalMinutes: 15,
    notifyOnFailure: false,
    targets: [target],
    nextRunAt: 123,
  }

  assert.deepEqual(completeMonitorRun(settings, completedAt), {
    ...settings,
    lastRunAt: completedAt,
    nextRunAt: 0,
  })
})

test('巡检仍启用时按最新间隔安排下一次运行', () => {
  const completedAt = 1_800_000_000_000
  const settings = {
    enabled: true,
    intervalMinutes: 30,
    notifyOnFailure: true,
    targets: [target],
    lastRunAt: 0,
    nextRunAt: 123,
  }

  assert.deepEqual(completeMonitorRun(settings, completedAt), {
    ...settings,
    lastRunAt: completedAt,
    nextRunAt: completedAt + 30 * 60_000,
  })
})

test('没有有效巡检目标时不能启用定时巡检', () => {
  assert.throws(
    () => updateMonitorSettings({ enabled: false, targets: [] }, { enabled: true }, 1_800_000_000_000),
    /请先在模型可靠性页配置巡检目标/,
  )
})

test('清空巡检目标时自动关闭已启用的定时巡检', () => {
  const savedAt = 1_800_000_000_000
  const current = {
    enabled: true,
    intervalMinutes: 30,
    notifyOnFailure: true,
    targets: [target],
    lastRunAt: 100,
    nextRunAt: 1_900_000_000_000,
  }

  assert.deepEqual(updateMonitorSettings(current, { targets: [] }, savedAt), {
    ...current,
    enabled: false,
    targets: [],
    nextRunAt: 0,
  })
})

test('历史脏数据在没有巡检目标时会规范化为关闭', () => {
  assert.deepEqual(normalizeMonitorSettings({
    enabled: true,
    intervalMinutes: 15,
    notifyOnFailure: false,
    targets: [],
    lastRunAt: 100,
    nextRunAt: 200,
  }), {
    enabled: false,
    intervalMinutes: 15,
    notifyOnFailure: false,
    targets: [],
    lastRunAt: 100,
    nextRunAt: 0,
  })
})

test('仅修改通知设置时保留下一次巡检时间', () => {
  const current = {
    enabled: true,
    intervalMinutes: 30,
    notifyOnFailure: true,
    targets: [target],
    lastRunAt: 100,
    nextRunAt: 1_900_000_000_000,
  }

  assert.deepEqual(updateMonitorSettings(current, { notifyOnFailure: false }, 1_800_000_000_000), {
    ...current,
    notifyOnFailure: false,
  })
})

test('修改巡检间隔时重新安排下一次巡检', () => {
  const savedAt = 1_800_000_000_000
  const current = {
    enabled: true,
    intervalMinutes: 30,
    notifyOnFailure: true,
    targets: [target],
    lastRunAt: 100,
    nextRunAt: 1_900_000_000_000,
  }

  assert.deepEqual(updateMonitorSettings(current, { intervalMinutes: 45 }, savedAt), {
    ...current,
    intervalMinutes: 45,
    nextRunAt: savedAt + 45 * 60_000,
  })
})

test('异常数量同时包含失败和无法验证结果', () => {
  assert.equal(countMonitorAnomalies({ failed: 2, gateway: 3 }), 5)
  assert.equal(countMonitorAnomalies({ failed: -1, gateway: 'bad' }), 0)
})
