export const CHAT_SESSIONS_STORAGE_KEY = 'aiChatSessionsV1'
export const LEGACY_CHAT_HISTORY_STORAGE_KEY = 'aiChatHistory'
export const MAX_CHAT_SESSIONS = 24
export const MAX_CHAT_HISTORY_MESSAGES = 100
export const MAX_CHAT_HISTORY_MESSAGE_LENGTH = 20_000
export const MAX_CHAT_HISTORY_STORAGE_CHARS = 1_500_000
export const MAX_CHAT_SESSION_TITLE_LENGTH = 80
export const DEFAULT_CHAT_SESSION_TITLE = '新对话'

function safeRole(value) {
  return value === 'assistant' ? 'assistant' : value === 'user' ? 'user' : ''
}

function safeTimestamp(value, fallback = null) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback
}

function safeId(value, fallback) {
  const id = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 160)
  return id || fallback
}

export function redactChatContent(value) {
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

function compactText(value, limit) {
  return redactChatContent(value).trim().replace(/\s+/g, ' ').slice(0, limit)
}

function newSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `chat-${crypto.randomUUID()}`
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function normalizeChatHistory(value) {
  const messages = Array.isArray(value) ? value : []
  return messages
    .map((message) => {
      const role = safeRole(message?.role)
      const content = redactChatContent(message?.content)
        .trim()
        .slice(0, MAX_CHAT_HISTORY_MESSAGE_LENGTH)
      if (!role || !content) return null
      return {
        id: safeId(message?.id, `${role}-${Math.random().toString(16).slice(2)}`),
        role,
        content,
        createdAt: safeTimestamp(message?.createdAt)
      }
    })
    .filter(Boolean)
    .slice(-MAX_CHAT_HISTORY_MESSAGES)
}

export function serializeChatHistory(value) {
  let messages = normalizeChatHistory(value)
  let serialized = JSON.stringify(messages)
  while (serialized.length > MAX_CHAT_HISTORY_STORAGE_CHARS && messages.length > 1) {
    messages = messages.slice(1)
    serialized = JSON.stringify(messages)
  }
  return serialized
}

export function deriveChatSessionTitle(value, fallback = DEFAULT_CHAT_SESSION_TITLE) {
  const messages = normalizeChatHistory(value)
  const firstUserMessage = messages.find((message) => message.role === 'user')
  return compactText(firstUserMessage?.content, MAX_CHAT_SESSION_TITLE_LENGTH) || fallback
}

export function normalizeChatSession(value = {}, index = 0, now = Date.now()) {
  const messages = normalizeChatHistory(value?.messages)
  const createdAt = safeTimestamp(value?.createdAt, messages[0]?.createdAt || now)
  const lastMessageAt = [...messages].reverse().find((message) => message.createdAt)?.createdAt
  const updatedAt = Math.max(
    createdAt,
    safeTimestamp(value?.updatedAt, lastMessageAt || createdAt),
    lastMessageAt || 0
  )
  return {
    id: safeId(value?.id, `${newSessionId()}-${index}`),
    title:
      compactText(value?.title, MAX_CHAT_SESSION_TITLE_LENGTH) || deriveChatSessionTitle(messages),
    createdAt,
    updatedAt,
    messages
  }
}

export function createChatSession(value = {}, now = Date.now()) {
  return normalizeChatSession(
    {
      id: value?.id || newSessionId(),
      title: value?.title || DEFAULT_CHAT_SESSION_TITLE,
      createdAt: value?.createdAt || now,
      updatedAt: value?.updatedAt || now,
      messages: value?.messages || []
    },
    0,
    now
  )
}

export function normalizeChatSessions(value, now = Date.now()) {
  const legacyMessages = Array.isArray(value) ? value : null
  const source = legacyMessages
    ? legacyMessages.length
      ? [{ messages: legacyMessages }]
      : []
    : Array.isArray(value?.sessions)
      ? value.sessions
      : []
  const requestedActiveId = legacyMessages ? '' : safeId(value?.activeSessionId, '')
  const seenIds = new Set()
  let sessions = source.map((item, index) => {
    const session = normalizeChatSession(item, index, now)
    const baseId = session.id
    let duplicateNumber = 2
    while (seenIds.has(session.id)) {
      const suffix = `-${duplicateNumber}`
      session.id = `${baseId.slice(0, 160 - suffix.length)}${suffix}`
      duplicateNumber += 1
    }
    seenIds.add(session.id)
    return session
  })

  if (!sessions.length) sessions = [createChatSession({}, now)]
  sessions.sort((left, right) => right.updatedAt - left.updatedAt)

  let activeSession = sessions.find((session) => session.id === requestedActiveId)
  let limited = sessions.slice(0, MAX_CHAT_SESSIONS)
  if (activeSession && !limited.some((session) => session.id === activeSession.id)) {
    limited = [...limited.slice(0, MAX_CHAT_SESSIONS - 1), activeSession]
    limited.sort((left, right) => right.updatedAt - left.updatedAt)
  }
  activeSession = limited.find((session) => session.id === requestedActiveId) || limited[0]

  return {
    version: 1,
    activeSessionId: activeSession.id,
    sessions: limited
  }
}

export function serializeChatSessions(value) {
  const state = normalizeChatSessions(value)
  let serialized = JSON.stringify(state)

  while (serialized.length > MAX_CHAT_HISTORY_STORAGE_CHARS && state.sessions.length > 1) {
    let removableIndex = -1
    for (let index = state.sessions.length - 1; index >= 0; index -= 1) {
      if (state.sessions[index].id !== state.activeSessionId) {
        removableIndex = index
        break
      }
    }
    if (removableIndex < 0) break
    state.sessions.splice(removableIndex, 1)
    serialized = JSON.stringify(state)
  }

  while (serialized.length > MAX_CHAT_HISTORY_STORAGE_CHARS) {
    const candidate = [...state.sessions].reverse().find((session) => session.messages.length > 1)
    if (!candidate) break
    candidate.messages = candidate.messages.slice(1)
    serialized = JSON.stringify(state)
  }

  return serialized
}

export function filterChatSessions(value, query) {
  const sessions = Array.isArray(value) ? value : []
  const normalizedQuery = compactText(query, 200).toLocaleLowerCase('zh-CN')
  if (!normalizedQuery) return sessions
  return sessions.filter((session) => {
    const haystack = [
      session?.title,
      ...(Array.isArray(session?.messages)
        ? session.messages.map((message) => message?.content)
        : [])
    ]
      .join('\n')
      .toLocaleLowerCase('zh-CN')
    return haystack.includes(normalizedQuery)
  })
}

export function chatHistoryToMarkdown(value, exportedAt = Date.now(), title = 'AI 对话记录') {
  const messages = normalizeChatHistory(value)
  const safeTitle = compactText(title, MAX_CHAT_SESSION_TITLE_LENGTH) || 'AI 对话记录'
  const body = messages
    .map((message) => {
      const role = message.role === 'user' ? '用户' : 'AI 助手'
      const time = message.createdAt ? new Date(message.createdAt).toLocaleString('zh-CN') : ''
      return `## ${role}${time ? ` · ${time}` : ''}\n\n${message.content}`
    })
    .join('\n\n')
  return `# ${safeTitle}\n\n导出时间：${new Date(exportedAt).toLocaleString('zh-CN')}\n\n${body}\n`
}

export function chatSessionToJson(value, exportedAt = Date.now()) {
  const session = normalizeChatSession(value)
  return JSON.stringify(
    {
      format: 'ops-desktop-ai-chat',
      version: 1,
      exportedAt: new Date(exportedAt).toISOString(),
      session
    },
    null,
    2
  )
}
