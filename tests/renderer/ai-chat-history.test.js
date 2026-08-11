import {
  DEFAULT_CHAT_SESSION_TITLE,
  MAX_CHAT_HISTORY_MESSAGES,
  MAX_CHAT_HISTORY_STORAGE_CHARS,
  MAX_CHAT_SESSIONS,
  chatHistoryToMarkdown,
  chatSessionToJson,
  filterChatSessions,
  normalizeChatHistory,
  normalizeChatSessions,
  redactChatContent,
  serializeChatHistory,
  serializeChatSessions
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
    const markdown = chatHistoryToMarkdown(
      [
        { role: 'user', content: '问题', createdAt: 1 },
        { role: 'assistant', content: '回答', createdAt: 2 }
      ],
      3
    )

    expect(markdown).toContain('# AI 对话记录')
    expect(markdown).toContain('## 用户')
    expect(markdown).toContain('## AI 助手')
    expect(markdown).toContain('问题')
    expect(markdown).toContain('回答')
  })

  it('migrates the legacy message array into one active titled session', () => {
    const state = normalizeChatSessions(
      [
        { role: 'user', content: '如何排查生产环境超时？', createdAt: 10 },
        { role: 'assistant', content: '先确认请求链路。', createdAt: 20 }
      ],
      30
    )

    expect(state.sessions).toHaveLength(1)
    expect(state.activeSessionId).toBe(state.sessions[0].id)
    expect(state.sessions[0].title).toBe('如何排查生产环境超时？')
    expect(state.sessions[0].messages).toHaveLength(2)
  })

  it('bounds session count and total serialized storage while preserving the active session', () => {
    const oversizedMessages = Array.from({ length: 40 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `${index}-` + 'x'.repeat(20_000),
      createdAt: index + 1
    }))
    const sessions = Array.from({ length: MAX_CHAT_SESSIONS + 5 }, (_, index) => ({
      id: `session-${index}`,
      title: `会话 ${index}`,
      createdAt: index + 1,
      updatedAt: index + 1,
      messages: index < 3 ? oversizedMessages : []
    }))
    const serialized = serializeChatSessions({
      activeSessionId: 'session-0',
      sessions
    })
    const state = JSON.parse(serialized)

    expect(state.sessions.length).toBeLessThanOrEqual(MAX_CHAT_SESSIONS)
    expect(state.sessions.some((session) => session.id === 'session-0')).toBe(true)
    expect(serialized.length).toBeLessThanOrEqual(MAX_CHAT_HISTORY_STORAGE_CHARS)
  })

  it('searches session titles and message content without changing the source order', () => {
    const sessions = [
      {
        id: 'release',
        title: '发布排障',
        messages: [{ role: 'user', content: '检查 SFTP 主机指纹' }]
      },
      {
        id: 'node',
        title: 'Node 服务',
        messages: [{ role: 'assistant', content: '检查端口监听' }]
      }
    ]

    expect(filterChatSessions(sessions, 'SFTP').map((session) => session.id)).toEqual(['release'])
    expect(filterChatSessions(sessions, '端口').map((session) => session.id)).toEqual(['node'])
    expect(filterChatSessions(sessions, '').map((session) => session.id)).toEqual([
      'release',
      'node'
    ])
  })

  it('exports a normalized JSON session without unsupported fields', () => {
    const exported = JSON.parse(
      chatSessionToJson(
        {
          id: 'session-json',
          title: '',
          createdAt: 1,
          updatedAt: 2,
          extra: 'drop',
          messages: [{ role: 'user', content: 'JSON 问题', extra: 'drop' }]
        },
        3
      )
    )

    expect(exported.format).toBe('ops-desktop-ai-chat')
    expect(exported.version).toBe(1)
    expect(exported.exportedAt).toBe(new Date(3).toISOString())
    expect(exported.session.title).toBe('JSON 问题')
    expect(exported.session).not.toHaveProperty('extra')
    expect(exported.session.messages[0]).not.toHaveProperty('extra')
  })

  it('creates a bounded empty state when stored session data is invalid', () => {
    const state = normalizeChatSessions({ sessions: [{ role: 'invalid' }] }, 100)

    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0].title).toBe(DEFAULT_CHAT_SESSION_TITLE)
    expect(state.sessions[0].messages).toEqual([])
  })

  it('redacts common credentials before local persistence, titles, and export', () => {
    const apiKey = `sk-${'a'.repeat(24)}`
    const source = [{ role: 'user', content: `token=super-secret ${apiKey}` }]
    const messages = normalizeChatHistory(source)
    const state = normalizeChatSessions(source, 100)
    const markdown = chatHistoryToMarkdown(source, 100)
    const exported = chatSessionToJson(state.sessions[0], 100)

    expect(redactChatContent(`Bearer ${'b'.repeat(16)}`)).toBe('Bearer [已脱敏]')
    expect(messages[0].content).toBe('token=[已脱敏] [已脱敏：API Key]')
    expect(state.sessions[0].title).not.toContain('super-secret')
    expect(markdown).not.toContain(apiKey)
    expect(exported).not.toContain(apiKey)
    expect(exported).not.toContain('super-secret')
  })

  it('assigns stable unique ids even when multiple duplicate suffixes already exist', () => {
    const state = normalizeChatSessions(
      {
        sessions: [
          { id: 'duplicate', title: 'A' },
          { id: 'duplicate', title: 'B' },
          { id: 'duplicate-2', title: 'C' },
          { id: 'duplicate', title: 'D' }
        ]
      },
      100
    )

    const ids = state.sessions.map((session) => session.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['duplicate', 'duplicate-2', 'duplicate-2-2']))
  })
})
