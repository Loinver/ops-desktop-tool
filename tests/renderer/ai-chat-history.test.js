import {
  MAX_CHAT_HISTORY_MESSAGES,
  MAX_CHAT_HISTORY_STORAGE_CHARS,
  chatHistoryToMarkdown,
  normalizeChatHistory,
  serializeChatHistory
} from '../../src/renderer/views/ai-chat/chat-history.js'

describe('AI chat history helper', () => {
  it('normalizes untrusted history and keeps only supported message fields', () => {
    const messages = normalizeChatHistory([
      { role: 'system', content: 'ignore me' },
      { role: 'user', content: '  hello  ', createdAt: 'not-a-date', extra: 'drop' },
      { role: 'assistant', content: 'answer', createdAt: 123 },
      { role: 'other', content: 'drop' },
      { role: 'user', content: '   ' }
    ])

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello', createdAt: null })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'answer', createdAt: 123 })
    expect(messages[0]).not.toHaveProperty('extra')
  })

  it('bounds history length and serialized size from the newest messages', () => {
    const messages = Array.from({ length: MAX_CHAT_HISTORY_MESSAGES + 20 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `message-${index}`,
      createdAt: index + 1
    }))
    const normalized = normalizeChatHistory(messages)
    const serialized = serializeChatHistory(messages)

    expect(normalized).toHaveLength(MAX_CHAT_HISTORY_MESSAGES)
    expect(normalized[0].content).toBe('message-20')
    expect(serialized.length).toBeLessThanOrEqual(MAX_CHAT_HISTORY_STORAGE_CHARS)
    expect(JSON.parse(serialized).at(-1).content).toBe('message-119')
  })

  it('exports a readable markdown transcript', () => {
    const markdown = chatHistoryToMarkdown([
      { role: 'user', content: '问题', createdAt: 1 },
      { role: 'assistant', content: '回答', createdAt: 2 }
    ], 3)

    expect(markdown).toContain('# AI 对话记录')
    expect(markdown).toContain('## 用户')
    expect(markdown).toContain('## AI 助手')
    expect(markdown).toContain('问题')
    expect(markdown).toContain('回答')
  })
})
