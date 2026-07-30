const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcMain: { handle: () => {} },
      net: {},
      clipboard: { writeText: () => {} },
      app: { getPath: () => '/tmp' },
      Notification: class {},
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const { __testables } = require('../src/main/ipc/model-test')
Module._load = originalLoad

test('停止模型测试会中止 429 重试退避等待', async () => {
  const controller = new AbortController()
  const pending = __testables.delay(10_000, controller.signal)
  controller.abort()
  await assert.rejects(pending, error => error?.name === 'AbortError')
})

test('已取消的模型测试返回已停止状态', async () => {
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(
    await __testables.testModel({}, { signal: controller.signal }),
    { ok: false, status: 'cancelled', message: '已停止' },
  )
})
