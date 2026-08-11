import {
  MAX_AI_CONTEXT_ATTACHMENTS,
  MAX_AI_CONTEXT_ITEM_LENGTH,
  MAX_AI_CONTEXT_TOTAL_LENGTH,
  addAiContextAttachment,
  clearAiContextAttachments,
  normalizeAiContextAttachments,
  readAiContextAttachments,
  removeAiContextAttachment,
  writeAiContextAttachments
} from '../../src/renderer/utils/ai-context.js'

function makeStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  }
}

describe('AI context attachment helper', () => {
  it('redacts credentials and keeps only safe bounded fields', () => {
    const [item] = normalizeAiContextAttachments([
      {
        id: 'bad id/1',
        source: '日志',
        title: 'token=leak',
        content: `apiKey=secret-value Bearer ${'a'.repeat(20)} ${'x'.repeat(MAX_AI_CONTEXT_ITEM_LENGTH + 100)}`,
        metadata: { line: 3, secret: 'hidden', unsafe: { value: 'drop' } },
        extra: 'drop'
      }
    ])
    expect(item.id).toBe('badid1')
    expect(item.content.length).toBeLessThanOrEqual(MAX_AI_CONTEXT_ITEM_LENGTH)
    expect(item.content).not.toContain('secret-value')
    expect(item.content).not.toContain('Bearer ' + 'a'.repeat(20))
    expect(item.title).toBe('token=[已脱敏]')
    expect(item.metadata).toEqual({ line: '3', secret: '[已脱敏]' })
    expect(item).not.toHaveProperty('extra')
  })

  it('deduplicates and bounds attachment count and total size', () => {
    const many = Array.from({ length: MAX_AI_CONTEXT_ATTACHMENTS + 3 }, (_, index) => ({
      source: 'source',
      title: `item-${index}`,
      content: 'x'.repeat(8_000)
    }))
    const items = normalizeAiContextAttachments([...many, many[0]])
    expect(items.length).toBeLessThanOrEqual(MAX_AI_CONTEXT_ATTACHMENTS)
    expect(items.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(
      MAX_AI_CONTEXT_TOTAL_LENGTH
    )
  })

  it('persists, replaces duplicates, removes and clears safely', () => {
    const storage = makeStorage()
    writeAiContextAttachments([{ source: '知识库', title: 'SOP', content: '内容' }], storage)
    const first = readAiContextAttachments(storage)[0]
    expect(
      addAiContextAttachment({ source: '知识库', title: 'SOP', content: '内容' }, storage)
    ).toHaveLength(1)
    expect(
      addAiContextAttachment({ source: '事件', title: '故障', content: '详情' }, storage)
    ).toHaveLength(2)
    expect(removeAiContextAttachment(first.id, storage)).toHaveLength(1)
    expect(clearAiContextAttachments(storage)).toEqual([])
    expect(readAiContextAttachments(storage)).toEqual([])
  })
})
