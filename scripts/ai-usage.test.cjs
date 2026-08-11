const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  estimateAiCostUsd,
  normalizeUsage,
  getAiUsageState,
  saveAiUsageSettings,
  checkAiUsageBudget,
  recordAiUsage
} = require('../src/main/utils/ai-usage')

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-ai-usage-'))
}

test('AI 使用量会兼容 OpenAI、Anthropic 与 Gemini Token 字段并在缺失时估算', () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 120, completion_tokens: 30 }), {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    estimatedInputTokens: false,
    estimatedOutputTokens: false,
    providerUsage: { prompt_tokens: 120, completion_tokens: 30 }
  })
  assert.equal(normalizeUsage({ input_tokens: 8, output_tokens: 5 }).totalTokens, 13)
  assert.equal(normalizeUsage({ promptTokenCount: 9, candidatesTokenCount: 6 }).totalTokens, 15)
  const estimated = normalizeUsage({}, { inputText: 'a'.repeat(40), outputText: 'b'.repeat(20) })
  assert.equal(estimated.inputTokens, 10)
  assert.equal(estimated.outputTokens, 5)
  assert.equal(estimated.estimatedInputTokens, true)
  assert.equal(estimated.estimatedOutputTokens, true)
})

test('AI 使用量会按模型估算成本、分 Provider 汇总并安全持久化', (t) => {
  const userDataPath = tempUserData()
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }))

  assert.equal(estimateAiCostUsd('gpt-4o-mini', 1_000, 500), 0.00045)
  assert.equal(estimateAiCostUsd('unknown-local-model', 1_000, 500), null)

  recordAiUsage(userDataPath, {
    providerId: 'provider-1',
    providerName: 'Primary',
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 1_000, completion_tokens: 500 }
  })
  recordAiUsage(userDataPath, {
    providerId: 'provider-2',
    providerName: 'Local',
    model: 'unknown-local-model',
    inputText: 'input',
    outputText: 'output'
  })

  const state = getAiUsageState(userDataPath)
  assert.equal(state.summary.today.requests, 2)
  assert.equal(state.summary.today.estimatedCostUsd, 0.00045)
  assert.equal(state.summary.today.unknownCostRequests, 1)
  assert.equal(state.summary.byModel.length, 2)
  assert.equal(state.records.length, 2)
  assert.equal(fs.statSync(path.join(userDataPath, 'ai-usage.json')).mode & 0o777, 0o600)
})

test('AI 预算达到日限额或月限额后阻止请求，并允许单次手动覆盖', (t) => {
  const userDataPath = tempUserData()
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }))

  saveAiUsageSettings(userDataPath, { dailyBudgetUsd: 0.0004, monthlyBudgetUsd: 1 })
  recordAiUsage(userDataPath, {
    providerId: 'provider-1',
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 1_000, completion_tokens: 500 }
  })

  const blocked = checkAiUsageBudget(userDataPath, {
    providerId: 'provider-1',
    model: 'gpt-4o-mini'
  })
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.code, 'AI_USAGE_BUDGET_EXCEEDED')
  assert.match(blocked.reason, /今日 AI 预算/)

  const overridden = checkAiUsageBudget(userDataPath, {
    providerId: 'provider-1',
    model: 'gpt-4o-mini',
    override: true
  })
  assert.equal(overridden.allowed, true)

  const unknown = checkAiUsageBudget(userDataPath, {
    providerId: 'provider-2',
    model: 'unknown-local-model'
  })
  assert.equal(unknown.allowed, false)
  assert.equal(unknown.code, 'AI_USAGE_COST_UNKNOWN')
})
