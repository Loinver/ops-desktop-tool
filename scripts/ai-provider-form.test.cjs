const test = require('node:test')
const assert = require('node:assert/strict')

test('Provider 保存前校验会指出必填项，并允许编辑已有 Provider 时保留凭证', async () => {
  const { validateProviderForm } = await import('../src/renderer/utils/ai-provider-form.mjs')

  assert.equal(validateProviderForm({}), '请输入 Provider 名称')
  assert.equal(validateProviderForm({ name: '本地模型' }), '请输入 AI 接口地址')
  assert.equal(validateProviderForm({ name: '本地模型', baseUrl: 'http://127.0.0.1:11434/v1' }), '请输入默认模型')
  assert.equal(validateProviderForm({ name: '本地模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3' }), '新建 Provider 时请输入 API Key')
  assert.equal(validateProviderForm({ name: '本地模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3', apiKey: 'secret' }), '')
  assert.equal(validateProviderForm({ id: 'existing-provider', name: '本地模型', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3' }), '')
})
