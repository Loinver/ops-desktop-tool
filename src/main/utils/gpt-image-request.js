const MAX_BATCH_SIZE = 4
const MAX_RETRY_COUNT = 2
const REQUEST_TIMEOUT_MS = 120_000
const VALID_MODES = new Set(['generate', 'edit', 'variation'])
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429])

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

function normalizeRequestId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 128)
}

function normalizeImageRequest(payload = {}) {
  const requestedMode = String(payload.mode || '').trim()
  return {
    requestId: normalizeRequestId(payload.requestId),
    mode: VALID_MODES.has(requestedMode) ? requestedMode : 'generate',
    prompt: String(payload.prompt || '').trim(),
    sourceAssetId: String(payload.sourceAssetId || '').trim(),
    count: boundedInteger(payload.count, 1, 1, MAX_BATCH_SIZE),
    retryCount: boundedInteger(payload.retryCount, 1, 0, MAX_RETRY_COUNT)
  }
}

function isRetryableStatus(status) {
  const value = Number(status)
  return RETRYABLE_STATUSES.has(value) || (value >= 500 && value <= 599)
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

function shouldRetryError(error) {
  if (!error || isAbortError(error)) return false
  if (Number.isFinite(Number(error.status))) return isRetryableStatus(Number(error.status))
  return true
}

function retryDelayMs(attempt) {
  return Math.min(400 * 2 ** Math.max(0, Number(attempt) || 0), 2_000)
}

function sleepWithSignal(ms, signal) {
  if (signal?.aborted) {
    const error = new Error('请求已取消')
    error.name = 'AbortError'
    return Promise.reject(error)
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      },
      Math.max(0, Number(ms) || 0)
    )
    function onAbort() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const error = new Error('请求已取消')
      error.name = 'AbortError'
      reject(error)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function executeWithRetry(task, options = {}) {
  const retries = boundedInteger(options.retries, 0, 0, MAX_RETRY_COUNT)
  const signal = options.signal
  const sleep = options.sleep || sleepWithSignal
  let attempt = 0

  while (true) {
    if (signal?.aborted) {
      const error = new Error('请求已取消')
      error.name = 'AbortError'
      throw error
    }
    try {
      const value = await task({ attempt, signal })
      return { value, attempts: attempt + 1 }
    } catch (error) {
      if (attempt >= retries || !shouldRetryError(error)) throw error
      if (typeof options.onRetry === 'function') options.onRetry(error, attempt + 1)
      await sleep(retryDelayMs(attempt), signal)
      attempt += 1
    }
  }
}

function contentTypeForExtension(extension) {
  const value = String(extension || '').toLowerCase()
  if (value === 'jpg' || value === 'jpeg') return 'image/jpeg'
  if (value === 'webp') return 'image/webp'
  if (value === 'gif') return 'image/gif'
  if (value === 'avif') return 'image/avif'
  return 'image/png'
}

function appendCommonFormFields(form, { model, size, count }) {
  form.append('model', model)
  form.append('n', String(count))
  if (size && size !== 'auto') form.append('size', size)
}

function buildImageHttpRequest({ baseUrl, apiKey, model, size, quality, request, source }) {
  const root = String(baseUrl || '').replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${apiKey}` }

  if (request.mode === 'generate') {
    const body = { model, prompt: request.prompt, n: request.count }
    if (size && size !== 'auto') body.size = size
    if (quality && quality !== 'auto') body.quality = quality
    return {
      url: `${root}/images/generations`,
      options: {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    }
  }

  if (!source?.buffer || !source?.extension) throw new Error('缺少可编辑的本地原图')
  const form = new FormData()
  const extension = String(source.extension).replace(/^\.+/, '') || 'png'
  form.append(
    'image',
    new Blob([source.buffer], { type: contentTypeForExtension(extension) }),
    `source.${extension}`
  )
  appendCommonFormFields(form, { model, size, count: request.count })

  const prompt =
    request.mode === 'variation'
      ? request.prompt || 'Create a visually consistent variation of the source image.'
      : request.prompt
  form.append('prompt', prompt)
  if (quality && quality !== 'auto') form.append('quality', quality)

  return {
    url: `${root}/images/edits`,
    options: { method: 'POST', headers, body: form }
  }
}

module.exports = {
  MAX_BATCH_SIZE,
  MAX_RETRY_COUNT,
  REQUEST_TIMEOUT_MS,
  buildImageHttpRequest,
  contentTypeForExtension,
  executeWithRetry,
  isAbortError,
  isRetryableStatus,
  normalizeImageRequest,
  normalizeRequestId,
  retryDelayMs,
  shouldRetryError,
  sleepWithSignal
}
