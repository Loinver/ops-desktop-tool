export const MAX_CHAT_HISTORY_MESSAGES = 100
export const MAX_CHAT_HISTORY_MESSAGE_LENGTH = 20_000
export const MAX_CHAT_HISTORY_STORAGE_CHARS = 1_500_000

function safeRole(value) {
  return value === 'assistant' ? 'assistant' : value === 'user' ? 'user' : ''
}

function safeTimestamp(value) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
}

export function normalizeChatHistory(value) {
  const messages = Array.isArray(value) ? value : []
  return messages
    .map((message) => {
      const role = safeRole(message?.role)
      const content = String(message?.content || '')
        .trim()
        .slice(0, MAX_CHAT_HISTORY_MESSAGE_LENGTH)
      if (!role || !content) return null
      return {
        id: String(message?.id || `${role}-${Math.random().toString(16).slice(2)}`).slice(0, 160),
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

export function chatHistoryToMarkdown(value, exportedAt = Date.now()) {
  const messages = normalizeChatHistory(value)
  const body = messages
    .map((message) => {
      const role = message.role === 'user' ? '用户' : 'AI 助手'
      const time = message.createdAt ? new Date(message.createdAt).toLocaleString('zh-CN') : ''
      return `## ${role}${time ? ` · ${time}` : ''}\n\n${message.content}`
    })
    .join('\n\n')
  return `# AI 对话记录\n\n导出时间：${new Date(exportedAt).toLocaleString('zh-CN')}\n\n${body}\n`
}
