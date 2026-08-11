const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  estimateAiCostUsd,
  estimateImageOutputCostUsd,
  estimateImageRequestCostUsd,
  estimateImageUsageCostUsd,
  normalizeUsage,
  getAiUsageState,
  saveAiUsageSettings,
  checkAiUsageBudget,
  reserveAiUsageBudget,
  releaseAiUsageBudget,
  recordAiUsage,
  __testables: { reservationCostUsd }
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

test('AI 生图会按官方尺寸质量、批量和最大重试次数估算预留费用', () => {
  assert.equal(estimateImageOutputCostUsd('gpt-image-2', '1024x1024', 'medium', 2), 0.068)
  assert.equal(estimateImageOutputCostUsd('gpt-image-2', 'auto', 'medium', 1), null)
  assert.equal(estimateImageOutputCostUsd('custom-image', '1024x1024', 'medium', 1), null)

  assert.deepEqual(
    estimateImageRequestCostUsd({
      officialProvider: true,
      model: 'gpt-image-2',
      size: '1024x1024',
      quality: 'medium',
      count: 2,
      retryCount: 1
    }),
    {
      estimatedCostUsd: 0.136,
      baseCostUsd: 0.068,
      costKnown: true,
      costSource: 'official-estimate',
      attempts: 2
    }
  )

  const custom = estimateImageRequestCostUsd({
    officialProvider: false,
    model: 'custom-image',
    count: 4,
    retryCount: 2,
    manualCostPerImageUsd: 0.02
  })
  assert.equal(custom.estimatedCostUsd, 0.24)
  assert.equal(custom.costSource, 'manual-per-image')
})

test('AI 生图会优先使用 Provider 返回的文本、图像输入与输出 Token 估算费用', () => {
  const cost = estimateImageUsageCostUsd('gpt-image-2', {
    input_tokens: 1_000,
    output_tokens: 2_000,
    input_tokens_details: { text_tokens: 400, image_tokens: 600 }
  })
  assert.equal(cost, 0.0668)
  assert.equal(estimateImageUsageCostUsd('custom-image', { output_tokens: 2_000 }), null)
})

test('AI 生图费用记录会保留显式估算、图片张数与类型并参与统一汇总', (t) => {
  const userDataPath = tempUserData()
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }))

  recordAiUsage(userDataPath, {
    kind: 'image',
    units: 2,
    providerId: 'openai',
    providerName: 'OpenAI',
    model: 'gpt-image-2',
    estimatedCostUsd: 0.05,
    costKnown: true,
    costSource: 'official-estimate'
  })

  const state = getAiUsageState(userDataPath)
  assert.equal(state.summary.today.imageRequests, 1)
  assert.equal(state.summary.today.images, 2)
  assert.equal(state.summary.today.estimatedCostUsd, 0.05)
  assert.equal(state.records[0].kind, 'image')
  assert.equal(state.records[0].estimatedCostUsd, 0.05)
})

test('AI 预算会在请求前计入本次预计费用并通过预留阻止并发穿透', (t) => {
  const userDataPath = tempUserData()
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }))

  saveAiUsageSettings(userDataPath, { dailyBudgetUsd: 0.1, monthlyBudgetUsd: 1 })
  recordAiUsage(userDataPath, {
    kind: 'image',
    model: 'gpt-image-2',
    estimatedCostUsd: 0.08,
    costKnown: true
  })
  const projected = checkAiUsageBudget(userDataPath, {
    model: 'gpt-image-2',
    estimatedCostUsd: 0.03,
    costKnown: true
  })
  assert.equal(projected.allowed, false)
  assert.equal(projected.code, 'AI_USAGE_BUDGET_EXCEEDED')

  const secondUserDataPath = tempUserData()
  t.after(() => fs.rmSync(secondUserDataPath, { recursive: true, force: true }))
  saveAiUsageSettings(secondUserDataPath, { dailyBudgetUsd: 0.1, monthlyBudgetUsd: 1 })
  const first = reserveAiUsageBudget(secondUserDataPath, {
    reservationId: 'image-1',
    model: 'gpt-image-2',
    estimatedCostUsd: 0.06,
    costKnown: true
  })
  assert.equal(first.allowed, true)
  const concurrent = reserveAiUsageBudget(secondUserDataPath, {
    reservationId: 'image-2',
    model: 'gpt-image-2',
    estimatedCostUsd: 0.05,
    costKnown: true
  })
  assert.equal(concurrent.allowed, false)
  releaseAiUsageBudget(secondUserDataPath, 'image-1')
  const afterRelease = reserveAiUsageBudget(secondUserDataPath, {
    reservationId: 'image-2',
    model: 'gpt-image-2',
    estimatedCostUsd: 0.05,
    costKnown: true
  })
  assert.equal(afterRelease.allowed, true)
  releaseAiUsageBudget(secondUserDataPath, 'image-2')
})

test('AI 生图用量持久化失败时会保留预算预留而不是静默放行', (t) => {
  const root = tempUserData()
  const blockedUserDataPath = path.join(root, 'not-a-directory')
  fs.writeFileSync(blockedUserDataPath, 'occupied')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const reservationId = 'image-persistence-failure'
  const reserved = reserveAiUsageBudget(blockedUserDataPath, {
    reservationId,
    model: 'gpt-image-2',
    estimatedCostUsd: 0.06,
    costKnown: true
  })
  assert.equal(reserved.allowed, true)
  assert.throws(
    () =>
      recordAiUsage(blockedUserDataPath, {
        reservationId,
        kind: 'image',
        model: 'gpt-image-2',
        estimatedCostUsd: 0.04,
        costKnown: true,
        strictPersistence: true
      }),
    /保留本次预算占用/
  )
  assert.equal(reservationCostUsd(blockedUserDataPath), 0.06)
  assert.equal(releaseAiUsageBudget(blockedUserDataPath, reservationId), false)
  assert.equal(releaseAiUsageBudget(blockedUserDataPath, reservationId, { force: true }), true)
})
