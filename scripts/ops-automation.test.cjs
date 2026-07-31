const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  listAutomationTasks,
  listOpsEvents,
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
