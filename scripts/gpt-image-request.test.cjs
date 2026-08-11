const assert = require('node:assert/strict')
const test = require('node:test')
const {
  buildImageHttpRequest,
  executeWithRetry,
  isRetryableStatus,
  normalizeImageRequest
} = require('../src/main/utils/gpt-image-request')

test('AI 生图请求会限制批量数量、重试次数和请求标识', () => {
  assert.deepEqual(
    normalizeImageRequest({
      requestId: ' batch/<unsafe> ',
      mode: 'edit',
      prompt: ' 修改图片 ',
      sourceAssetId: 'asset-id',
      count: 99,
      retryCount: 9
    }),
    {
      requestId: 'batchunsafe',
      mode: 'edit',
      prompt: '修改图片',
      sourceAssetId: 'asset-id',
      count: 4,
      retryCount: 2
    }
  )
})

test('文生图请求使用 JSON 并携带批量、尺寸和质量参数', () => {
  const request = buildImageHttpRequest({
    baseUrl: 'https://example.com/v1',
    apiKey: 'secret',
    model: 'image-model',
    size: '1024x1024',
    quality: 'high',
    request: normalizeImageRequest({ requestId: 'r1', prompt: '画一台服务器', count: 3 })
  })

  assert.equal(request.url, 'https://example.com/v1/images/generations')
  assert.equal(request.options.headers.Authorization, 'Bearer secret')
  assert.equal(request.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.options.body), {
    model: 'image-model',
    prompt: '画一台服务器',
    n: 3,
    size: '1024x1024',
    quality: 'high'
  })
})

test('编辑与变体只上传主进程读取的图片数据，并统一使用现代图片编辑端点', async () => {
  const source = { buffer: Buffer.from('local-image'), extension: 'png' }
  const edit = buildImageHttpRequest({
    baseUrl: 'https://example.com/v1',
    apiKey: 'secret',
    model: 'image-model',
    size: '1024x1024',
    quality: 'medium',
    source,
    request: normalizeImageRequest({
      requestId: 'edit-1',
      mode: 'edit',
      prompt: '改成夜景',
      sourceAssetId: 'asset',
      count: 2
    })
  })
  assert.equal(edit.url, 'https://example.com/v1/images/edits')
  assert.equal(edit.options.body.get('prompt'), '改成夜景')
  assert.equal(edit.options.body.get('quality'), 'medium')
  assert.equal(edit.options.body.get('n'), '2')
  assert.deepEqual(Buffer.from(await edit.options.body.get('image').arrayBuffer()), source.buffer)

  const variation = buildImageHttpRequest({
    baseUrl: 'https://example.com/v1',
    apiKey: 'secret',
    model: 'image-model',
    size: 'auto',
    quality: 'high',
    source,
    request: normalizeImageRequest({
      requestId: 'variation-1',
      mode: 'variation',
      prompt: '该描述仅用于本地记录',
      sourceAssetId: 'asset'
    })
  })
  assert.equal(variation.url, 'https://example.com/v1/images/edits')
  assert.equal(variation.options.body.get('prompt'), '该描述仅用于本地记录')
  assert.equal(variation.options.body.get('quality'), 'high')
  assert.equal(variation.options.body.has('size'), false)
})

test('临时 HTTP 与网络错误会在上限内重试，鉴权错误不会重试', async () => {
  assert.equal(isRetryableStatus(429), true)
  assert.equal(isRetryableStatus(503), true)
  assert.equal(isRetryableStatus(401), false)

  let attempts = 0
  const result = await executeWithRetry(
    async () => {
      attempts += 1
      if (attempts < 3) {
        const error = new Error('temporary')
        error.status = 503
        throw error
      }
      return 'ok'
    },
    { retries: 2, sleep: async () => {} }
  )
  assert.equal(result.value, 'ok')
  assert.equal(result.attempts, 3)

  let authAttempts = 0
  await assert.rejects(
    executeWithRetry(
      async () => {
        authAttempts += 1
        const error = new Error('unauthorized')
        error.status = 401
        throw error
      },
      { retries: 2, sleep: async () => {} }
    ),
    /unauthorized/
  )
  assert.equal(authAttempts, 1)
})

test('取消信号会终止自动重试等待', async () => {
  const controller = new AbortController()
  let attempts = 0
  await assert.rejects(
    executeWithRetry(
      async () => {
        attempts += 1
        controller.abort()
        throw new Error('network')
      },
      { retries: 2, signal: controller.signal }
    ),
    (error) => error?.name === 'AbortError'
  )
  assert.equal(attempts, 1)
})
