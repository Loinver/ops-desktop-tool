const DEFAULT_MAX_STREAM_CHARS = 20_000
const DEFAULT_HOLD_BACK_CHARS = 64
const MAX_NON_STREAMING_BODY_CHARS = 1_000_000

function text(value) {
  return typeof value === 'string' ? value : String(value || '')
}

function streamingText(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      return item?.text || item?.content?.text || ''
    })
    .join('')
}

function findSensitiveStart(value) {
  const source = text(value)
  const patterns = [
    /-----BEGIN/i,
    /\bsk(?:-proj)?-/i,
    /\bAIza/i,
    /\bBearer\s+/i,
    /(?:api[_-]?key|token|password|secret|authorization)\s*[:=]/i
  ]
  return patterns.reduce((earliest, pattern) => {
    const index = source.search(pattern)
    return index >= 0 && (earliest < 0 || index < earliest) ? index : earliest
  }, -1)
}

function createSafeTextEmitter({
  onDelta,
  redact = (value) => text(value),
  maxLength = DEFAULT_MAX_STREAM_CHARS,
  holdBackLength = DEFAULT_HOLD_BACK_CHARS
} = {}) {
  let pending = ''
  let raw = ''
  let emitted = ''
  let truncated = false

  function emit(value) {
    if (!value) return
    const safe = text(redact(value))
    if (!safe) return
    emitted += safe
    if (typeof onDelta === 'function') onDelta(safe)
  }

  function push(value) {
    if (truncated) return false
    const incoming = text(value)
    if (!incoming) return true
    const remaining = Math.max(0, maxLength - raw.length)
    const accepted = incoming.slice(0, remaining)
    if (accepted.length < incoming.length) truncated = true
    if (!accepted) return false

    raw += accepted
    pending += accepted
    const sensitiveStart = findSensitiveStart(pending)
    const safeUntil =
      sensitiveStart >= 0 ? sensitiveStart : Math.max(0, pending.length - holdBackLength)
    if (safeUntil > 0) {
      emit(pending.slice(0, safeUntil))
      pending = pending.slice(safeUntil)
    }
    return !truncated
  }

  function finish() {
    emit(pending)
    pending = ''
    const content = text(redact(raw)).slice(0, maxLength)
    return { content, emitted, truncated }
  }

  return {
    push,
    finish,
    get raw() {
      return raw
    },
    get truncated() {
      return truncated
    }
  }
}

function parseSseBlock(block) {
  let event = ''
  const data = []
  let hasData = false
  for (const line of text(block).split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator >= 0 ? line.slice(0, separator) : line
    const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : ''
    if (field === 'event') event = value
    if (field === 'data') {
      hasData = true
      data.push(value)
    }
  }
  return { event, data: data.join('\n'), hasData }
}

async function* responseTextChunks(response) {
  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of response.body) yield chunk
    return
  }
  if (response?.body?.getReader) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const result = await reader.read()
        if (result.done) break
        yield result.value
      }
    } finally {
      reader.releaseLock?.()
    }
    return
  }
  if (typeof response?.text === 'function') yield await response.text()
}

async function readServerSentEvents(response, onEvent) {
  const decoder = new TextDecoder()
  let buffer = ''
  let fallbackBody = ''
  let sawEvents = false

  const dispatch = (block) => {
    const parsed = parseSseBlock(block)
    if (!parsed.hasData) return true
    sawEvents = true
    return onEvent(parsed)
  }

  for await (const chunk of responseTextChunks(response)) {
    const value = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    if (!sawEvents && fallbackBody.length < MAX_NON_STREAMING_BODY_CHARS) {
      fallbackBody += value.slice(0, MAX_NON_STREAMING_BODY_CHARS - fallbackBody.length)
    }
    buffer += value
    while (true) {
      const match = /\r?\n\r?\n/.exec(buffer)
      if (!match) break
      const block = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      if (dispatch(block) === false) return { sawEvents, fallbackBody }
    }
  }
  const finalChunk = decoder.decode()
  buffer += finalChunk
  if (buffer.trim()) dispatch(buffer)
  return { sawEvents, fallbackBody }
}

function parseJsonData(data) {
  if (data === '[DONE]') return { done: true }
  try {
    return JSON.parse(data)
  } catch {
    return {}
  }
}

function extractResponsesOutputText(response) {
  return (Array.isArray(response?.output) ? response.output : [])
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((item) => item?.text || item?.content?.text || '')
    .join('')
}

function parseCompletionStreamEvent(provider, event, data) {
  if (data === '[DONE]') return { done: true }
  const payload = parseJsonData(data)
  if (payload.done) return { done: true }
  if (payload.error) return { error: payload }

  if (provider?.protocol === 'anthropic') {
    if (payload.type === 'message_start') {
      return { model: payload.message?.model, usage: payload.message?.usage }
    }
    if (payload.type === 'content_block_delta') {
      return { delta: streamingText(payload.delta?.text) }
    }
    if (payload.type === 'message_delta') return { usage: payload.usage }
    if (payload.type === 'message_stop') return { done: true }
    return {}
  }

  if (provider?.protocol === 'gemini') {
    return {
      delta: streamingText(
        payload.candidates?.[0]?.content?.parts?.map((item) => item?.text || '') || []
      ),
      model: payload.modelVersion || payload.model,
      usage: payload.usageMetadata,
      done: Boolean(payload.done || payload.candidates?.[0]?.finishReason)
    }
  }

  if (event === 'response.output_text.delta' || payload.type === 'response.output_text.delta') {
    return { delta: streamingText(payload.delta), model: payload.response?.model }
  }
  if (event === 'response.failed' || payload.type === 'response.failed') {
    return { error: payload.response?.error || payload }
  }
  if (event === 'response.completed' || payload.type === 'response.completed') {
    return {
      finalContent: extractResponsesOutputText(payload.response),
      model: payload.response?.model,
      usage: payload.response?.usage,
      done: true
    }
  }
  return {
    delta: streamingText(payload.choices?.[0]?.delta?.content),
    model: payload.model,
    usage: payload.usage,
    done: Boolean(payload.done)
  }
}

module.exports = {
  createSafeTextEmitter,
  findSensitiveStart,
  parseSseBlock,
  readServerSentEvents,
  parseCompletionStreamEvent
}
