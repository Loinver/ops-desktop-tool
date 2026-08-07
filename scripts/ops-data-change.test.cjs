const assert = require('node:assert/strict')
const test = require('node:test')

const {
  emitOpsDataChange,
  normalizeOpsDataChange,
  onOpsDataChange
} = require('../src/main/utils/ops-data-change')

test('运维数据变更信号只保留有界白名单字段', () => {
  const payload = normalizeOpsDataChange({
    kind: 'x'.repeat(100),
    sourceType: 'model-monitor',
    sourceId: 'target-1',
    eventId: 'event-1',
    severity: 'critical',
    status: 'failed',
    updatedAt: 123,
    token: 'secret',
    command: 'node --token secret',
    path: '/Users/operator/private'
  })

  assert.deepEqual(payload, {
    kind: 'x'.repeat(40),
    sourceType: 'model-monitor',
    sourceId: 'target-1',
    eventId: 'event-1',
    severity: 'critical',
    status: 'failed',
    updatedAt: 123
  })
})

test('运维数据变更订阅可接收并取消安全信号', () => {
  const changes = []
  const unsubscribe = onOpsDataChange((change) => changes.push(change))
  emitOpsDataChange({ kind: 'updated', sourceType: 'automation', sourceId: 'task-1' })
  unsubscribe()
  emitOpsDataChange({ kind: 'updated', sourceType: 'automation', sourceId: 'task-2' })

  assert.equal(changes.length, 1)
  assert.equal(changes[0].sourceId, 'task-1')
})
