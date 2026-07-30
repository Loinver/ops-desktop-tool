const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { IPC_CHANNELS } = require('../src/shared/ipc-channels')

const preloadSource = fs.readFileSync(
  path.join(__dirname, '../src/main/preload.js'),
  'utf8',
)

test('sandbox preload 覆盖所有主进程 IPC 通道', () => {
  for (const [name, channel] of Object.entries(IPC_CHANNELS)) {
    assert.match(preloadSource, new RegExp(`\\b${name}\\s*:\\s*['\"]${channel}['\"]`))
  }
})

test('preload 不加载本地 CommonJS 模块', () => {
  assert.doesNotMatch(preloadSource, /require\(['"]\.\.?\//)
})
