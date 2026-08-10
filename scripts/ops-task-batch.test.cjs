const assert = require('node:assert/strict')
const test = require('node:test')
const {
  executeAutomationTaskBatch,
  normalizeTaskBatchRequest
} = require('../src/main/utils/ops-task-batch')

test('批量任务请求只接受固定动作、有限 ID 和显式确认', () => {
  assert.deepEqual(
    normalizeTaskBatchRequest({ action: 'run', taskIds: ['task-1', 'task-2'], confirmed: true }),
    { action: 'run', taskIds: ['task-1', 'task-2'], confirmed: true }
  )
  assert.throws(
    () => normalizeTaskBatchRequest({ action: 'delete', taskIds: ['task-1'], confirmed: true }),
    /不支持/
  )
  assert.throws(
    () => normalizeTaskBatchRequest({ action: 'run', taskIds: ['task-1'], confirmed: false }),
    /必须完成确认/
  )
  assert.throws(
    () => normalizeTaskBatchRequest({ action: 'run', taskIds: ['task-1;rm'], confirmed: true }),
    /标识无效/
  )
  assert.throws(
    () =>
      normalizeTaskBatchRequest({
        action: 'run',
        taskIds: Array.from({ length: 11 }, (_, index) => `task-${index}`),
        confirmed: true
      }),
    /最多处理 10 个/
  )
})

test('批量任务在主进程重查 ID、串行执行并在首个失败后停止', async () => {
  const calls = []
  const result = await executeAutomationTaskBatch({
    userDataPath: '/tmp/test',
    input: { action: 'run', taskIds: ['task-1', 'task-2', 'task-3'], confirmed: true },
    listTasks: () => [
      { id: 'task-1', enabled: true },
      { id: 'task-2', enabled: true },
      { id: 'task-3', enabled: true }
    ],
    runTask: async (_path, id) => {
      calls.push(id)
      return { result: { ok: id !== 'task-2', message: id === 'task-2' ? 'failed' : 'ok' } }
    },
    now: (() => {
      let value = 100
      return () => value++
    })(),
    randomUUID: () => 'batch-1'
  })

  assert.deepEqual(calls, ['task-1', 'task-2'])
  assert.equal(result.batchId, 'batch-1')
  assert.equal(result.status, 'failed')
  assert.equal(result.processedCount, 2)
  assert.equal(result.succeededCount, 1)
  assert.equal(result.failedCount, 1)
})

test('暂停和恢复批量操作只修改 enabled 并跳过已处于目标状态的任务', async () => {
  const saved = []
  const result = await executeAutomationTaskBatch({
    userDataPath: '/tmp/test',
    input: { action: 'pause', taskIds: ['task-1', 'task-2'], confirmed: true },
    listTasks: () => [
      { id: 'task-1', enabled: true, title: 'one' },
      { id: 'task-2', enabled: false, title: 'two' }
    ],
    saveTask: (_path, task) => saved.push(task),
    randomUUID: () => 'batch-2'
  })

  assert.deepEqual(saved, [{ id: 'task-1', enabled: false, title: 'one' }])
  assert.equal(result.succeededCount, 1)
  assert.equal(result.skippedCount, 1)
})
