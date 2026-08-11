const test = require('node:test')
const assert = require('node:assert/strict')
const { requestCompletionStream } = require('../src/main/utils/ai-ops')
const {
  createSafeTextEmitter,
  parseCompletionStreamEvent
} = require('../src/main/utils/ai-chat-stream')

function provider(overrides = {}) {
  return {
    protocol: 'openai',
    wireApi: 'chat',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'stream-test-key',
    model: 'stream-model',
    ...overrides
  }
}

function streamResponse(chunks, status = 200) {
  const encoder = new TextEncoder()
  return {
    ok: status >= 200 && status < 300,
    status,
    body: (async function* () {
      for (const chunk of chunks) yield encoder.encode(chunk)
    })(),
    text: async () => chunks.join('')
  }
}

const originalFetch = global.fetch

test.afterEach(() => {
  global.fetch = originalFetch
})

test('OpenAI Chat Completions 流式响应会按增量返回并保留模型信息', async () => {
  let request
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) }
    return streamResponse([
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n',
      'data: [DONE]\n\n'
    ])
  }

  const deltas = []
  const result = await requestCompletionStream(provider(), {
    messages: [{ role: 'user', content: '打招呼' }],
    onDelta: (delta) => deltas.push(delta)
  })

  assert.equal(request.url, 'https://api.example.test/v1/chat/completions')
  assert.equal(request.body.stream, true)
  assert.equal(result.content, '你好，世界')
  assert.equal(result.model, 'stream-model')
  assert.equal(deltas.join(''), '你好，世界')
})

test('OpenAI Responses、Anthropic 和 Gemini 增量事件会正确提取文本', () => {
  assert.deepEqual(
    parseCompletionStreamEvent(
      provider({ wireApi: 'responses' }),
      'response.output_text.delta',
      JSON.stringify({ type: 'response.output_text.delta', delta: 'Responses' })
    ).delta,
    'Responses'
  )
  assert.deepEqual(
    parseCompletionStreamEvent(
      provider({ protocol: 'anthropic' }),
      'content_block_delta',
      JSON.stringify({ type: 'content_block_delta', delta: { text: 'Anthropic' } })
    ).delta,
    'Anthropic'
  )
  assert.deepEqual(
    parseCompletionStreamEvent(
      provider({ protocol: 'gemini' }),
      '',
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini' }] } }] })
    ).delta,
    'Gemini'
  )
})

test('流式输出会阻止跨增量拼接的敏感凭证泄露', () => {
  const deltas = []
  const emitter = createSafeTextEmitter({
    onDelta: (delta) => deltas.push(delta),
    redact: (value) => value.replace(/\bsk(?:-proj)?-[A-Za-z0-9_-]{12,}\b/g, '[已脱敏：API Key]')
  })

  emitter.push('说明：')
  emitter.push('sk-proj-abcdefgh')
  emitter.push('ijklmnopqrstuv 会被保护')
  const result = emitter.finish()
  const output = deltas.join('')

  assert.equal(result.content, '说明：[已脱敏：API Key] 会被保护')
  assert.equal(output, result.content)
  assert.doesNotMatch(output, /sk-proj-abcdefghijklmnopqrstuv/)
})

test('OpenAI 流式首选接口返回 404 时会安全回退到另一标准接口', async () => {
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    if (calls.length === 1) return streamResponse(['{"error":{"message":"not found"}}'], 404)
    return streamResponse([
      'data: {"choices":[{"delta":{"content":"fallback"}}]}\n\ndata: [DONE]\n\n'
    ])
  }

  const result = await requestCompletionStream(provider({ wireApi: 'responses' }), {
    messages: [{ role: 'user', content: 'fallback' }]
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://api.example.test/v1/responses')
  assert.equal(calls[1].url, 'https://api.example.test/v1/chat/completions')
  assert.equal(calls[0].body.stream, true)
  assert.equal(result.content, 'fallback')
})

test('外部 AbortSignal 会中止在途请求并返回可识别的取消错误', async () => {
  global.fetch = async (_url, options) => {
    await new Promise((resolve, reject) => {
      options.signal.addEventListener(
        'abort',
        () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        { once: true }
      )
    })
    return streamResponse([])
  }

  const controller = new AbortController()
  const pending = requestCompletionStream(provider(), {
    messages: [{ role: 'user', content: '请取消' }],
    signal: controller.signal
  })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()

  await assert.rejects(pending, (error) => {
    assert.equal(error.code, 'AI_CHAT_CANCELLED')
    assert.match(error.message, /已取消/)
    return true
  })
})
