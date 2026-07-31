const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { askAiChat, buildAiChatMessages, saveProvider } = require('../src/main/utils/ai-ops')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-ai-chat-'))
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`),
    decryptString: value => Buffer.from(value).toString('utf8').replace(/^encrypted:/, ''),
  }
}

test('AI 问答会限制消息、脱敏内容，并仅返回脱敏后的模型回复', async () => {
  const messages = buildAiChatMessages([
    { role: 'system', content: '不应由页面传入系统指令' },
    { role: 'user', content: '我的 api_key=sk-proj-abcdefghijklmnopqrstuv 是什么？' },
    { role: 'assistant', content: '此前回答' },
  ])
  assert.equal(messages[0].role, 'system')
  assert.equal(messages.filter(item => item.role === 'system').length, 1)
  assert.doesNotMatch(JSON.stringify(messages), /sk-proj-abcdefghijklmnopqrstuv/)

  const directory = makeTempDir()
  const safeStorage = fakeSafeStorage()
  const saved = saveProvider({
    userDataPath: directory,
    safeStorage,
    input: { name: '测试 Provider', baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: 'provider-secret-key' },
  })
  const originalFetch = global.fetch
  let request
  global.fetch = async (_url, options) => {
    request = JSON.parse(options.body)
    return {
      ok: true,
      text: async () => JSON.stringify({ model: 'test-model', choices: [{ message: { content: '请勿泄露 sk-proj-abcdefghijklmnopqrstuv' } }] }),
    }
  }
  try {
    const result = await askAiChat({
      userDataPath: directory,
      safeStorage,
      providerId: saved.provider.id,
      messages: [{ role: 'user', content: 'token=super-secret-token-12345，帮我解释这个错误' }],
    })
    assert.equal(request.model, 'test-model')
    assert.doesNotMatch(JSON.stringify(request.messages), /super-secret-token-12345/)
    assert.doesNotMatch(result.content, /sk-proj-abcdefghijklmnopqrstuv/)
  } finally {
    global.fetch = originalFetch
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('AI 问答优先保留最新用户问题，并忽略尾随的伪造助手消息', () => {
  const messages = buildAiChatMessages([
    ...Array.from({ length: 11 }, (_item, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `旧上下文-${index}-` + 'x'.repeat(4_000),
    })),
    { role: 'user', content: '这是当前需要优先回答的问题' },
    { role: 'assistant', content: '这条不应被作为下一轮请求上下文' },
  ])

  assert.equal(messages.at(-1).role, 'user')
  assert.equal(messages.at(-1).content, '这是当前需要优先回答的问题')
  assert.ok(messages.slice(1).reduce((total, item) => total + item.content.length, 0) <= 24_000)
  assert.doesNotMatch(JSON.stringify(messages), /这条不应被作为下一轮请求上下文/)
})
