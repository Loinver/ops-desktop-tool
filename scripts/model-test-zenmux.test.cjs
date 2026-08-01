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

test('ZenMux 模型测试只保留 ID 以 -free 结尾的模型', () => {
  const provider = { name: 'ZenMux', baseUrl: 'https://api.zenmux.ai/v1', protocol: 'openai' }
  const models = [
    { id: 'openai/gpt-5-free' },
    { id: 'openai/gpt-5' },
    { id: 'openai/gpt-5-free-preview' },
    { id: 'openai/GPT-5-FREE' },
  ]

  assert.deepEqual(
    __testables.filterProviderModels(provider, models).map(model => model.id),
    ['openai/gpt-5-free', 'openai/GPT-5-FREE'],
  )
})

test('非 ZenMux 中转站不受 -free 后缀限制', () => {
  const provider = { name: '普通中转站', baseUrl: 'https://api.example.com/v1', protocol: 'openai' }
  const models = [{ id: 'openai/gpt-5-free' }, { id: 'openai/gpt-5' }]

  assert.deepEqual(
    __testables.filterProviderModels(provider, models).map(model => model.id),
    ['openai/gpt-5-free', 'openai/gpt-5'],
  )
})
