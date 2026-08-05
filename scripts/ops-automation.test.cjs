const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  addOpsEvent,
  eventSummary,
  listAutomationTasks,
  listOpsEvents,
  loadEventState,
  markOpsEventsRead,
  onOpsEventChange,
  recoverOpsEvent,
  runAutomationTask,
  runHttpHealthCheck,
  saveAutomationTask,
  updateOpsEvent,
} = require('../src/main/utils/ops-automation')

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-automation-test-'))
}

test('自动化任务校验、运行记录与失败事件', async () => {
  const userDataPath = createTempDir()
  const originalFetch = global.fetch
  try {
    assert.throws(
      () => saveAutomationTask(userDataPath, { type: 'http-health', target: 'ftp://example.com' }),
      /HTTP\/HTTPS/,
    )
    assert.throws(
      () => saveAutomationTask(userDataPath, { type: 'http-health', target: 'https://user:password@example.com' }),
      /不含账号密码/,
    )

    global.fetch = async () => ({ status: 200 })
    const health = await runHttpHealthCheck({ target: 'https://example.test/health', expectedStatus: 200, timeoutMs: 1000 })
    assert.equal(health.ok, true)
    assert.equal(health.statusCode, 200)

    const saved = saveAutomationTask(userDataPath, {
      title: '不可用 TCP 检查',
      type: 'tcp-port',
      target: '127.0.0.1',
      port: 1,
      intervalMinutes: 5,
      timeoutMs: 1000,
    })
    assert.equal(listAutomationTasks(userDataPath).length, 1)

    const failed = await runAutomationTask(userDataPath, saved.id)
    assert.equal(failed.result.ok, false)
    assert.equal(failed.task.lastResult.ok, false)

    const [event] = listOpsEvents(userDataPath, { status: 'open' })
    assert.ok(event)
    assert.equal(event.category, 'automation')
    assert.equal(event.relatedId, saved.id)
    assert.equal(updateOpsEvent(userDataPath, event.id, 'acknowledged').status, 'acknowledged')
    assert.equal(updateOpsEvent(userDataPath, event.id, 'resolved').status, 'resolved')
  } finally {
    global.fetch = originalFetch
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})


test('统一事件按指纹去重、累计次数并自动恢复', () => {
  const userDataPath = createTempDir()
  try {
    const first = addOpsEvent(userDataPath, {
      fingerprint: 'model-monitor:p1:claude:m1',
      sourceType: 'model-monitor',
      sourceId: 'p1:claude:m1',
      severity: 'warning',
      title: '模型巡检异常：m1',
      description: '第一次失败',
      occurredAt: 100,
    })
    const repeated = addOpsEvent(userDataPath, {
      fingerprint: 'model-monitor:p1:claude:m1',
      sourceType: 'model-monitor',
      sourceId: 'p1:claude:m1',
      severity: 'critical',
      title: '模型巡检异常：m1',
      description: '第二次失败',
      occurredAt: 200,
    })

    assert.equal(first.id, repeated.id)
    assert.equal(repeated.occurrenceCount, 2)
    assert.equal(repeated.firstOccurredAt, 100)
    assert.equal(repeated.lastOccurredAt, 200)
    assert.equal(repeated.severity, 'critical')
    assert.equal(listOpsEvents(userDataPath).length, 1)

    const recovered = recoverOpsEvent(userDataPath, repeated.fingerprint, {
      message: '模型已恢复可用',
      recoveredAt: 300,
    })
    assert.equal(recovered.status, 'resolved')
    assert.equal(recovered.recoveredAt, 300)
    assert.equal(recovered.resolutionNote, '模型已恢复可用')
    assert.equal(recovered.timeline.at(-1).type, 'recovered')
    assert.deepEqual(eventSummary(userDataPath), {
      total: 1,
      active: 0,
      open: 0,
      acknowledged: 0,
      resolved: 1,
      recovered: 1,
      unread: 1,
      unreadCritical: 1,
      critical: 0,
      warning: 0,
    })

    const reopened = addOpsEvent(userDataPath, {
      fingerprint: repeated.fingerprint,
      sourceType: 'model-monitor',
      sourceId: 'p1:claude:m1',
      severity: 'warning',
      title: '模型巡检异常：m1',
      description: '恢复后再次失败',
      occurredAt: 400,
    })
    assert.equal(reopened.id, first.id)
    assert.equal(reopened.status, 'open')
    assert.equal(reopened.occurrenceCount, 3)
    assert.equal(reopened.recoveredAt, 0)
    assert.equal(reopened.timeline.at(-1).type, 'reopened')
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})


test('统一事件支持单条和全部已读，重复发生后重新变为未读', () => {
  const userDataPath = createTempDir()
  try {
    const first = addOpsEvent(userDataPath, {
      fingerprint: 'release:prod',
      sourceType: 'release',
      sourceId: 'prod',
      severity: 'critical',
      title: '生产发布失败',
    })
    const second = addOpsEvent(userDataPath, {
      fingerprint: 'automation:health',
      sourceType: 'automation',
      sourceId: 'health',
      severity: 'warning',
      title: '健康检查失败',
    })
    assert.equal(eventSummary(userDataPath).unread, 2)
    assert.equal(eventSummary(userDataPath).unreadCritical, 1)

    const single = markOpsEventsRead(userDataPath, { ids: [first.id] })
    assert.equal(single.updated, 1)
    assert.ok(single.readAt > 0)
    assert.ok(listOpsEvents(userDataPath).find(item => item.id === first.id).readAt > 0)
    assert.equal(eventSummary(userDataPath).unread, 1)

    const all = markOpsEventsRead(userDataPath, { all: true })
    assert.equal(all.updated, 1)
    assert.equal(eventSummary(userDataPath).unread, 0)

    const repeated = addOpsEvent(userDataPath, {
      fingerprint: 'release:prod',
      sourceType: 'release',
      sourceId: 'prod',
      severity: 'critical',
      title: '生产发布再次失败',
    })
    assert.equal(repeated.id, first.id)
    assert.equal(repeated.readAt, 0)
    assert.equal(eventSummary(userDataPath).unread, 1)
    assert.equal(eventSummary(userDataPath).unreadCritical, 1)
    assert.ok(listOpsEvents(userDataPath).find(item => item.id === second.id).readAt > 0)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('标记事件已读会广播变更，供 Dock 等桌面入口同步未读数', () => {
  const userDataPath = createTempDir()
  const changes = []
  const stopListening = onOpsEventChange(change => changes.push(change))
  try {
    const item = addOpsEvent(userDataPath, {
      fingerprint: 'system:dock-badge',
      sourceType: 'system',
      severity: 'warning',
      title: 'Dock 未读同步测试',
    })
    changes.length = 0
    markOpsEventsRead(userDataPath, { ids: [item.id] })
    assert.equal(changes.length, 1)
    assert.equal(changes[0].kind, 'read')
    assert.equal(changes[0].item.id, item.id)
    assert.ok(changes[0].item.readAt > 0)
  } finally {
    stopListening()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('旧版事件数据读取时迁移为统一事件模型', () => {
  const userDataPath = createTempDir()
  try {
    fs.writeFileSync(path.join(userDataPath, 'ops-events.json'), JSON.stringify({
      version: 1,
      items: [{
        id: 'legacy-event',
        sourceKey: 'legacy:key',
        category: 'release',
        level: 'critical',
        status: 'open',
        title: '旧事件',
        description: '旧结构仍需兼容',
        relatedId: 'release-1',
        createdAt: 100,
        updatedAt: 200,
      }],
    }))

    const state = loadEventState(userDataPath)
    assert.equal(state.version, 3)
    assert.equal(state.items[0].fingerprint, 'legacy:key')
    assert.equal(state.items[0].sourceType, 'release')
    assert.equal(state.items[0].severity, 'critical')
    assert.equal(state.items[0].sourceId, 'release-1')
    assert.equal(state.items[0].occurrenceCount, 1)
    assert.equal(state.items[0].firstOccurredAt, 100)
    assert.equal(state.items[0].lastOccurredAt, 200)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('自动化巡检恢复正常后自动关闭关联事件', async () => {
  const userDataPath = createTempDir()
  const originalFetch = global.fetch
  try {
    const task = saveAutomationTask(userDataPath, {
      title: '站点健康检查',
      type: 'http-health',
      target: 'https://example.test/health',
      expectedStatus: 200,
      intervalMinutes: 5,
      timeoutMs: 1000,
    })
    global.fetch = async () => ({ status: 503 })
    await runAutomationTask(userDataPath, task.id)
    let [event] = listOpsEvents(userDataPath)
    assert.equal(event.fingerprint, `automation:${task.id}`)
    assert.equal(event.status, 'open')

    global.fetch = async () => ({ status: 200 })
    await runAutomationTask(userDataPath, task.id)
    ;[event] = listOpsEvents(userDataPath)
    assert.equal(event.status, 'resolved')
    assert.ok(event.recoveredAt > 0)
    assert.match(event.resolutionNote, /巡检恢复/)
  } finally {
    global.fetch = originalFetch
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('旧版自动化事件按任务标识合并', () => {
  const userDataPath = createTempDir()
  try {
    fs.writeFileSync(path.join(userDataPath, 'ops-events.json'), JSON.stringify({
      version: 1,
      items: [
        { id: 'run-1', sourceKey: 'automation:task-1:run-1', category: 'automation', level: 'warning', status: 'open', title: '巡检失败', relatedId: 'task-1', createdAt: 100, updatedAt: 100 },
        { id: 'run-2', sourceKey: 'automation:task-1:run-2', category: 'automation', level: 'warning', status: 'open', title: '巡检失败', relatedId: 'task-1', createdAt: 200, updatedAt: 200 },
      ],
    }))

    const items = loadEventState(userDataPath).items
    assert.equal(items.length, 1)
    assert.equal(items[0].fingerprint, 'automation:task-1')
    assert.equal(items[0].occurrenceCount, 2)
    assert.equal(items[0].firstOccurredAt, 100)
    assert.equal(items[0].lastOccurredAt, 200)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})
