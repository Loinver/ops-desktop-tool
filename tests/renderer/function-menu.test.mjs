import { describe, expect, it } from 'vitest'
import { FUNCTION_MENU_GROUPS, FUNCTION_MENU_ITEMS } from '../../src/renderer/config/function-menu.js'

describe('function menu information architecture', () => {
  it('groups AI dialogue and image generation under AI and intelligence', () => {
    const group = FUNCTION_MENU_GROUPS.find(item => item.id === 'intelligence')

    expect(group?.name).toBe('AI 与智能')
    expect(group?.items.map(item => item.id)).toEqual([
      'ai-chat',
      'gpt-image',
      'knowledge-base',
      'ai-models',
    ])
  })

  it('promotes AI capabilities into dedicated menu entries', () => {
    const menuIds = FUNCTION_MENU_ITEMS.map(item => item.id)

    expect(menuIds).toContain('ai-operations')
    expect(menuIds).toContain('knowledge-base')
    expect(menuIds).toContain('ai-models')
    expect(menuIds).toContain('ai-integrations')
    expect(menuIds).not.toContain('ai-ops')
  })

  it('keeps menu ids and paths unique', () => {
    const ids = FUNCTION_MENU_ITEMS.map(item => item.id)
    const paths = FUNCTION_MENU_ITEMS.map(item => item.path)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
