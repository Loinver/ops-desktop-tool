export const AI_CONTEXT_STORAGE_KEY = 'aiContextAttachmentsV1'
export const MAX_AI_CONTEXT_ATTACHMENTS = 8
export const MAX_AI_CONTEXT_ITEM_LENGTH = 8_000
export const MAX_AI_CONTEXT_TOTAL_LENGTH = 32_000
export const MAX_AI_CONTEXT_SOURCE_LENGTH = 80
export const MAX_AI_CONTEXT_TITLE_LENGTH = 160

function safeText(value, limit) {
  return redactAiContextText(String(value || ''))
    .trim()
    .slice(0, limit)
}

export function redactAiContextText(value) {
  let text = String(value || '')
  text = text.replace(
    /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g,
    '[已脱敏：私钥]'
  )
  text = text.replace(
    /\b(sk-[A-Za-z0-9_-]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g,
    '[已脱敏：API Key]'
  )
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/gi, '$1[已脱敏]')
  text = text.replace(
    /((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*["']?)[^\s"',;]+/gi,
    '$1[已脱敏]'
  )
  return text
}

function newAttachmentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `context-${crypto.randomUUID()}`
  }
  return `context-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function safeTimestamp(value, fallback = Date.now()) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 8)
      .map(([key, item]) => [
        safeText(key, 60),
        /api[_-]?key|token|password|secret|authorization/i.test(key)
          ? '[已脱敏]'
          : item !== null && typeof item !== 'object'
            ? safeText(item, 240)
            : ''
      ])
      .filter(([key, item]) => key && item)
  )
}

export function normalizeAiContextAttachment(value = {}, index = 0, now = Date.now()) {
  const source = safeText(value.source || '本地证据', MAX_AI_CONTEXT_SOURCE_LENGTH)
  const title = safeText(value.title || '未命名证据', MAX_AI_CONTEXT_TITLE_LENGTH)
  const content = safeText(value.content, MAX_AI_CONTEXT_ITEM_LENGTH)
  if (!content) return null
  const id = safeText(value.id || `${source}-${title}-${index}`, 160).replace(
    /[^a-zA-Z0-9:_-]/g,
    ''
  )
  return {
    id: id || newAttachmentId(),
    source,
    title,
    content,
    metadata: normalizeMetadata(value.metadata),
    createdAt: safeTimestamp(value.createdAt, now)
  }
}

export function normalizeAiContextAttachments(value, now = Date.now()) {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.attachments)
      ? value.attachments
      : []
  const seen = new Set()
  const attachments = []
  for (let index = 0; index < source.length; index += 1) {
    const item = normalizeAiContextAttachment(source[index], index, now)
    if (!item) continue
    const dedupeKey = `${item.source}\n${item.title}\n${item.content}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    attachments.push(item)
  }
  return boundAiContextAttachments(attachments)
}

export function boundAiContextAttachments(value) {
  const attachments = Array.isArray(value) ? value : []
  const bounded = attachments.slice(0, MAX_AI_CONTEXT_ATTACHMENTS).map((item) => ({
    ...item,
    metadata: { ...(item.metadata || {}) }
  }))
  let total = bounded.reduce((sum, item) => sum + item.content.length, 0)
  while (total > MAX_AI_CONTEXT_TOTAL_LENGTH && bounded.length) {
    const last = bounded.at(-1)
    const overflow = total - MAX_AI_CONTEXT_TOTAL_LENGTH
    if (last.content.length <= overflow) {
      total -= last.content.length
      bounded.pop()
      continue
    }
    const nextLength = Math.max(0, last.content.length - overflow)
    last.content = last.content.slice(0, nextLength).trim()
    total = bounded.reduce((sum, item) => sum + item.content.length, 0)
  }
  return bounded
}

function resolveStorage(storage) {
  if (storage) return storage
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}

export function readAiContextAttachments(storage) {
  const target = resolveStorage(storage)
  if (!target) return []
  try {
    return normalizeAiContextAttachments(JSON.parse(target.getItem(AI_CONTEXT_STORAGE_KEY) || '[]'))
  } catch {
    return []
  }
}

export function writeAiContextAttachments(value, storage) {
  const target = resolveStorage(storage)
  const attachments = normalizeAiContextAttachments(value)
  if (!target) return attachments
  try {
    target.setItem(AI_CONTEXT_STORAGE_KEY, JSON.stringify(attachments))
  } catch {
    // 上下文附件只做增强能力，存储失败时保留内存状态，不阻断对话。
  }
  return attachments
}

export function addAiContextAttachment(value, storage) {
  const item = normalizeAiContextAttachment(value)
  if (!item) return readAiContextAttachments(storage)
  const current = readAiContextAttachments(storage)
  const seen = new Set()
  const next = [item, ...current].filter((candidate) => {
    const key = `${candidate.source}\n${candidate.title}\n${candidate.content}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return writeAiContextAttachments(next, storage)
}

export function removeAiContextAttachment(id, storage) {
  return writeAiContextAttachments(
    readAiContextAttachments(storage).filter((item) => item.id !== id),
    storage
  )
}

export function clearAiContextAttachments(storage) {
  const target = resolveStorage(storage)
  try {
    target?.removeItem(AI_CONTEXT_STORAGE_KEY)
  } catch {
    // ignore storage policy errors
  }
  return []
}
