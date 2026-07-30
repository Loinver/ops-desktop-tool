const assert = require('node:assert/strict')
const test = require('node:test')
const {
  normalizeModelListSettings,
  normalizeModelRules,
  matchesModelRule,
  isModelIncludedBySettings,
  isModelAllowedForProtocol,
} = require('../src/main/utils/model-list-settings')

test('模型筛选规则会去空、去重并支持换行或逗号输入', () => {
  assert.deepEqual(
    normalizeModelRules(' gpt-5.6-*\nclaude-* , GPT-5.6-* \n'),
    ['gpt-5.6-*', 'claude-*'],
  )
})

test('模型筛选规则匹配完整模型 ID 与组织前缀后的 bare ID', () => {
  assert.equal(matchesModelRule('openai/gpt-5.6-sol', 'gpt-5.6-*'), true)
  assert.equal(matchesModelRule('z-ai/glm-5.2', 'glm-*'), true)
  assert.equal(matchesModelRule('claude-opus-4-6', 'gpt-*'), false)
})

test('默认获取全部模型；仅获取模式与排除规则可以限定返回模型', () => {
  const defaults = normalizeModelListSettings({})
  assert.deepEqual(defaults, { mode: 'all', includeRules: [], excludeRules: [] })
  assert.equal(isModelIncludedBySettings('vendor/gpt-5.6-sol', defaults), true)

  const settings = {
    mode: 'include',
    includeRules: ['gpt-*', 'claude-opus-*'],
    excludeRules: ['*-deprecated'],
  }
  assert.equal(isModelIncludedBySettings('vendor/gpt-5.6-sol', settings), true)
  assert.equal(isModelIncludedBySettings('claude-opus-4-6', settings), true)
  assert.equal(isModelIncludedBySettings('gpt-5.6-deprecated', settings), false)
  assert.equal(isModelIncludedBySettings('glm-5.2', settings), false)
})


test('协议兼容性仅排除端点无法调用的模型组合', () => {
  assert.equal(isModelAllowedForProtocol('openai', 'claude-opus-4-6'), false)
  assert.equal(isModelAllowedForProtocol('anthropic', 'openai/gpt-5.6-sol'), false)
  assert.equal(isModelAllowedForProtocol('gemini', 'gemini-2.5-pro'), true)
  assert.equal(isModelAllowedForProtocol('anthropic', 'vendor/deepseek-v4'), true)
})
