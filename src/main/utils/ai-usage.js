const crypto = require('node:crypto')
const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')

const AI_USAGE_FILE = 'ai-usage.json'
const MAX_AI_USAGE_RECORDS = 1_000
const MAX_AI_USAGE_DAYS = 365
const MAX_BUDGET_USD = 1_000_000

// 仅用于预算保护和趋势估算，不作为供应商账单。未知模型会明确标记为未知成本。
const MODEL_PRICES_USD_PER_MILLION = [
  { test: /gpt-4o-mini/i, input: 0.15, output: 0.6 },
  { test: /gpt-4o/i, input: 5, output: 15 },
  { test: /gpt-4\.1-mini/i, input: 0.4, output: 1.6 },
  { test: /gpt-4\.1/i, input: 2, output: 8 },
  { test: /claude-3-5-haiku|claude-3-haiku/i, input: 0.8, output: 4 },
  { test: /claude-3-5-sonnet|claude-3-7-sonnet|claude-3-sonnet/i, input: 3, output: 15 },
  { test: /gemini-1\.5-flash/i, input: 0.075, output: 0.3 },
  { test: /gemini-1\.5-pro/i, input: 3.5, output: 10.5 }
]

function usagePath(userDataPath) {
  return path.join(userDataPath, AI_USAGE_FILE)
}

function number(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback
}

function dateKey(timestamp = Date.now()) {
  const value = new Date(timestamp)
  return Number.isNaN(value.getTime())
    ? new Date().toISOString().slice(0, 10)
    : value.toISOString().slice(0, 10)
}

function normalizeSettings(value = {}) {
  return {
    dailyBudgetUsd: number(value.dailyBudgetUsd, 0, MAX_BUDGET_USD),
    monthlyBudgetUsd: number(value.monthlyBudgetUsd, 0, MAX_BUDGET_USD),
    allowUnknownCost: Boolean(value.allowUnknownCost)
  }
}

function estimateTokenCount(value) {
  const text = String(value || '').trim()
  return text ? Math.max(1, Math.ceil(text.length / 4)) : 0
}

function pickUsageValue(usage, keys) {
  for (const key of keys) {
    const value = Number(usage?.[key])
    if (Number.isFinite(value) && value >= 0) return Math.round(value)
  }
  return 0
}

function normalizeUsage(usage, { inputText = '', outputText = '' } = {}) {
  const source = usage && typeof usage === 'object' ? usage : {}
  let inputTokens = pickUsageValue(source, [
    'prompt_tokens',
    'input_tokens',
    'promptTokenCount',
    'inputTokenCount',
    'inputTokens'
  ])
  let outputTokens = pickUsageValue(source, [
    'completion_tokens',
    'output_tokens',
    'candidatesTokenCount',
    'outputTokenCount',
    'outputTokens'
  ])
  const totalFromProvider = pickUsageValue(source, [
    'total_tokens',
    'totalTokenCount',
    'totalTokens'
  ])
  const estimatedInputTokens = inputTokens === 0 && Boolean(String(inputText || '').trim())
  const estimatedOutputTokens = outputTokens === 0 && Boolean(String(outputText || '').trim())
  if (estimatedInputTokens) inputTokens = estimateTokenCount(inputText)
  if (estimatedOutputTokens) outputTokens = estimateTokenCount(outputText)
  const totalTokens = totalFromProvider || inputTokens + outputTokens
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedInputTokens,
    estimatedOutputTokens,
    providerUsage: source
  }
}

function findPrice(model) {
  const value = String(model || '')
  return MODEL_PRICES_USD_PER_MILLION.find((item) => item.test.test(value)) || null
}

function estimateAiCostUsd(model, inputTokens, outputTokens) {
  const price = findPrice(model)
  if (!price) return null
  return Number(
    (
      (number(inputTokens) / 1_000_000) * price.input +
      (number(outputTokens) / 1_000_000) * price.output
    ).toFixed(8)
  )
}

function defaultState() {
  return { version: 1, settings: normalizeSettings(), records: [] }
}

function normalizeRecord(value = {}) {
  const timestamp = number(value.timestamp, Date.now())
  const model =
    String(value.model || 'unknown')
      .trim()
      .slice(0, 160) || 'unknown'
  const usage = normalizeUsage(value.usage || value, {
    inputText: value.inputText,
    outputText: value.outputText
  })
  const estimatedCostUsd = estimateAiCostUsd(model, usage.inputTokens, usage.outputTokens)
  return {
    id: String(value.id || crypto.randomUUID()).slice(0, 100),
    timestamp,
    date: dateKey(timestamp),
    providerId: String(value.providerId || '')
      .trim()
      .slice(0, 120),
    providerName: String(value.providerName || '')
      .trim()
      .slice(0, 120),
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedInputTokens: usage.estimatedInputTokens,
    estimatedOutputTokens: usage.estimatedOutputTokens,
    estimatedCostUsd,
    costKnown: estimatedCostUsd !== null
  }
}

function loadState(userDataPath) {
  const value = readJsonFile(usagePath(userDataPath), defaultState())
  const records = Array.isArray(value?.records)
    ? value.records.map((item) => normalizeRecord(item)).filter((item) => item.timestamp > 0)
    : []
  const cutoff = Date.now() - MAX_AI_USAGE_DAYS * 24 * 60 * 60 * 1_000
  return {
    version: 1,
    settings: normalizeSettings(value?.settings),
    records: records.filter((item) => item.timestamp >= cutoff).slice(0, MAX_AI_USAGE_RECORDS)
  }
}

function summarize(records, now = Date.now()) {
  const today = dateKey(now)
  const month = today.slice(0, 7)
  const summarizeGroup = (items) => {
    const costValues = items.map((item) => item.estimatedCostUsd).filter((item) => item !== null)
    return {
      requests: items.length,
      inputTokens: items.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: items.reduce((sum, item) => sum + item.outputTokens, 0),
      totalTokens: items.reduce((sum, item) => sum + item.totalTokens, 0),
      estimatedCostUsd: Number(costValues.reduce((sum, item) => sum + item, 0).toFixed(8)),
      unknownCostRequests: items.length - costValues.length
    }
  }
  const byModel = new Map()
  for (const item of records) {
    const key = `${item.providerId}\n${item.providerName}\n${item.model}`
    const current = byModel.get(key) || {
      providerId: item.providerId,
      providerName: item.providerName,
      model: item.model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      unknownCostRequests: 0
    }
    current.requests += 1
    current.inputTokens += item.inputTokens
    current.outputTokens += item.outputTokens
    current.totalTokens += item.totalTokens
    current.estimatedCostUsd += item.estimatedCostUsd || 0
    current.unknownCostRequests += item.costKnown ? 0 : 1
    byModel.set(key, current)
  }
  const dayRecords = records.filter((item) => item.date === today)
  const monthRecords = records.filter((item) => item.date.startsWith(month))
  return {
    today: summarizeGroup(dayRecords),
    month: summarizeGroup(monthRecords),
    byModel: Array.from(byModel.values())
      .map((item) => ({ ...item, estimatedCostUsd: Number(item.estimatedCostUsd.toFixed(8)) }))
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 50),
    recent: records.slice(0, 20)
  }
}

function getAiUsageState(userDataPath) {
  const state = loadState(userDataPath)
  return {
    settings: state.settings,
    summary: summarize(state.records),
    records: state.records.slice(0, 20)
  }
}

function saveAiUsageSettings(userDataPath, settings) {
  const state = loadState(userDataPath)
  state.settings = normalizeSettings(settings)
  if (!writeJsonFile(usagePath(userDataPath), state)) throw new Error('保存 AI 预算设置失败')
  return getAiUsageState(userDataPath)
}

function checkAiUsageBudget(userDataPath, { providerId = '', model = '', override = false } = {}) {
  const state = loadState(userDataPath)
  const summary = summarize(state.records)
  const budgetEnabled = state.settings.dailyBudgetUsd > 0 || state.settings.monthlyBudgetUsd > 0
  const unknownModelCost = estimateAiCostUsd(model, 1, 1) === null
  if (budgetEnabled && unknownModelCost && !state.settings.allowUnknownCost && !override) {
    return {
      allowed: false,
      reason: '当前模型没有内置价格，无法执行预算保护；请允许未知价格模型或手动确认本次继续',
      code: 'AI_USAGE_COST_UNKNOWN',
      providerId,
      model,
      settings: state.settings,
      summary
    }
  }
  const checks = [
    ['dailyBudgetUsd', 'today', '今日'],
    ['monthlyBudgetUsd', 'month', '本月']
  ]
  const blocked = checks.find(([setting, period]) => {
    const limit = state.settings[setting]
    return limit > 0 && summary[period].estimatedCostUsd >= limit && !override
  })
  return {
    allowed: !blocked,
    reason: blocked
      ? `${blocked[2]} AI 预算已达到 $${state.settings[blocked[0]].toFixed(2)}，请调整预算或手动确认本次继续`
      : '',
    code: blocked ? 'AI_USAGE_BUDGET_EXCEEDED' : '',
    providerId,
    model,
    settings: state.settings,
    summary
  }
}

function recordAiUsage(
  userDataPath,
  { providerId = '', providerName = '', model = '', usage, inputText = '', outputText = '' } = {}
) {
  const state = loadState(userDataPath)
  const record = normalizeRecord({
    providerId,
    providerName,
    model,
    usage,
    inputText,
    outputText,
    timestamp: Date.now()
  })
  state.records = [record, ...state.records].slice(0, MAX_AI_USAGE_RECORDS)
  writeJsonFile(usagePath(userDataPath), state)
  return { entry: record, summary: summarize(state.records), settings: state.settings }
}

module.exports = {
  AI_USAGE_FILE,
  MAX_AI_USAGE_RECORDS,
  estimateAiCostUsd,
  normalizeUsage,
  getAiUsageState,
  saveAiUsageSettings,
  checkAiUsageBudget,
  recordAiUsage
}
