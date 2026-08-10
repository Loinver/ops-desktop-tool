const crypto = require('node:crypto')
const { listAutomationTasks, runAutomationTask, saveAutomationTask } = require('./ops-automation')

const MAX_BATCH_TASKS = 10
const ACTIONS = new Set(['run', 'pause', 'resume'])

function boundedId(value) {
  const id = String(value || '').trim()
  if (!id || id.length > 120 || !/^[\w:.-]+$/u.test(id)) throw new Error('批量任务标识无效')
  return id
}

function normalizeTaskBatchRequest(input = {}) {
  const action = String(input.action || '').trim()
  if (!ACTIONS.has(action)) throw new Error('不支持的批量任务操作')
  if (input.confirmed !== true) throw new Error('批量任务执行前必须完成确认')
  if (!Array.isArray(input.taskIds) || !input.taskIds.length) throw new Error('请选择批量任务')
  if (input.taskIds.length > MAX_BATCH_TASKS)
    throw new Error(`单次最多处理 ${MAX_BATCH_TASKS} 个任务`)
  const taskIds = [...new Set(input.taskIds.map(boundedId))]
  if (taskIds.length !== input.taskIds.length) throw new Error('批量任务标识不能重复')
  return { action, taskIds, confirmed: true }
}

async function executeAutomationTaskBatch({
  userDataPath,
  input,
  listTasks = listAutomationTasks,
  runTask = runAutomationTask,
  saveTask = saveAutomationTask,
  now = () => Date.now(),
  randomUUID = crypto.randomUUID
} = {}) {
  if (!userDataPath) throw new Error('批量任务缺少数据目录')
  const request = normalizeTaskBatchRequest(input)
  const tasks = new Map(listTasks(userDataPath).map((task) => [String(task.id), task]))
  const selected = request.taskIds.map((id) => {
    const task = tasks.get(id)
    if (!task) throw new Error(`自动化任务不存在：${id}`)
    return task
  })
  const startedAt = now()
  const results = []
  for (const task of selected) {
    try {
      if (request.action === 'run') {
        const executed = await runTask(userDataPath, task.id)
        if (executed?.result?.ok === false) throw new Error(executed.result.message || '巡检失败')
      } else {
        const enabled = request.action === 'resume'
        if (Boolean(task.enabled) === enabled) {
          results.push({
            taskId: task.id,
            status: 'skipped',
            message: enabled ? '已启用' : '已暂停'
          })
          continue
        }
        saveTask(userDataPath, { ...task, enabled })
      }
      results.push({ taskId: task.id, status: 'succeeded', message: '处理完成' })
    } catch (error) {
      results.push({
        taskId: task.id,
        status: 'failed',
        message: String(error?.message || '处理失败').slice(0, 500)
      })
      break
    }
  }
  const failed = results.find((item) => item.status === 'failed')
  return {
    batchId: randomUUID(),
    action: request.action,
    status: failed ? 'failed' : 'succeeded',
    requestedCount: selected.length,
    processedCount: results.length,
    succeededCount: results.filter((item) => item.status === 'succeeded').length,
    skippedCount: results.filter((item) => item.status === 'skipped').length,
    failedCount: failed ? 1 : 0,
    results,
    startedAt,
    finishedAt: now()
  }
}

module.exports = {
  MAX_BATCH_TASKS,
  executeAutomationTaskBatch,
  normalizeTaskBatchRequest
}
