/**
 * 临时验证脚本：在非 Electron 环境下跑通 model-test 主进程逻辑
 * 用法：node scripts/verify-model-test.js [providerNameFilter]
 */
const Module = require('node:module')

// 用桩替换 electron，捕获注册的 IPC handler
const handlers = new Map()
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcMain: {
        handle: (channel, fn) => handlers.set(channel, fn),
      },
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const { registerModelTestHandlers } = require('../src/main/ipc/model-test')
const { IPC_CHANNELS } = require('../src/shared/ipc-channels')

registerModelTestHandlers()

const listProviders = handlers.get(IPC_CHANNELS.MODEL_TEST_LIST_PROVIDERS)
const runTest = handlers.get(IPC_CHANNELS.MODEL_TEST_RUN)

const CONCURRENCY = 4
const filter = process.argv[2] || ''

async function main() {
  const listed = await listProviders()
  if (!listed.ok) {
    console.error('读取配置失败：', listed.message)
    process.exit(1)
  }

  const providers = listed.providers.filter(
    p => p.testable && (!filter || p.name.includes(filter) || p.appType === filter),
  )

  const tasks = []
  for (const p of providers) {
    for (const m of p.models) {
      tasks.push({ provider: p, model: m })
    }
  }

  console.log(`共 ${providers.length} 个中转站 / ${tasks.length} 个模型，并发 ${CONCURRENCY}\n`)

  let cursor = 0
  const results = []
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor]
        cursor += 1
        const res = await runTest(null, {
          providerId: task.provider.id,
          appType: task.provider.appType,
          model: task.model.model,
          beta1m: task.model.beta1m,
        })
        results.push({ task, res })
        const icon = res.ok ? '✅' : '❌'
        const detail = res.ok
          ? `${res.durationMs}ms ${res.endpoint}${res.reply ? ' 回复:' + res.reply.slice(0, 20) : ''}`
          : `${res.status} ${res.httpStatus || ''} ${(res.message || '').slice(0, 90)}`
        const name = `${task.provider.appType}/${task.provider.name}`
        const model = task.model.model + (task.model.beta1m ? '[1M]' : '')
        console.log(`${icon} ${name.padEnd(24)} ${model.padEnd(34)} ${detail}`)
      }
    }),
  )

  const ok = results.filter(r => r.res.ok).length
  console.log(`\n汇总：可用 ${ok} / ${results.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
