const assert = require('node:assert/strict')
const test = require('node:test')
const { killByPid, killByPort, __testables } = require('../src/main/port-manager')

test('Windows 普通结束使用 taskkill 结束完整进程树', async () => {
  const calls = []
  const result = await killByPid(4321, 'SIGTERM', {
    platform: 'win32',
    runCommand: async (command, args) => calls.push({ command, args })
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [{ command: 'taskkill', args: ['/PID', '4321', '/T'] }])
  assert.equal(result.killed[0].method, 'taskkill')
  assert.equal(result.killed[0].processTree, true)
  assert.equal(result.killed[0].forced, false)
})

test('Windows 强制结束会向 taskkill 追加 /F', async () => {
  const calls = []
  await __testables.terminateProcess(4321, 'SIGKILL', {
    platform: 'win32',
    runCommand: async (command, args) => calls.push({ command, args })
  })

  assert.deepEqual(calls, [{ command: 'taskkill', args: ['/PID', '4321', '/T', '/F'] }])
})

test('Windows 按端口结束会去重 PID 并逐一结束进程树', async () => {
  const calls = []
  const result = await killByPort(3000, 'SIGKILL', {
    platform: 'win32',
    portUsageResult: {
      ok: true,
      entries: [{ pid: 101 }, { pid: 101 }, { pid: 202 }]
    },
    runCommand: async (command, args) => calls.push({ command, args })
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls, [
    { command: 'taskkill', args: ['/PID', '101', '/T', '/F'] },
    { command: 'taskkill', args: ['/PID', '202', '/T', '/F'] }
  ])
})

test('非 Windows 平台仍使用进程信号', async () => {
  const calls = []
  const result = await __testables.terminateProcess(99, 'SIGTERM', {
    platform: 'linux',
    killProcess: (pid, signal) => calls.push({ pid, signal })
  })

  assert.deepEqual(calls, [{ pid: 99, signal: 'SIGTERM' }])
  assert.deepEqual(result, {
    method: 'signal',
    processTree: false,
    forced: false
  })
})
