const crypto = require('node:crypto')
const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')

const AI_USAGE_FILE = 'ai-usage.json'
const MAX_AI_USAGE_RECORDS = 1_000
const MAX_AI_USAGE_DAYS = 365
const MAX_BUDGET_USD = 1_000_000
const MAX_RESERVATION_AGE_MS = 10 * 60 * 1_000

// 仅用于预算保护和趋势估算，不作为供应商账单。未知模型会明确标记为未知成本。
const CHAT_MODEL_PRICES_USD_PER_MILLION = [
  { test: /gpt-4o-mini/i, input: 0.15, output: 0.6 },
  { test: /gpt-4o/i, input: 5, output: 15 },
  { test: /gpt-4\.1-mini/i, input: 0.4, output: 1.6 },
  { test: /gpt-4\.1/i, input: 2, output: 8 },
  { test: /claude-3-5-haiku|claude-3-haiku/i, input: 0.8, output: 4 },
  { test: /claude-3-5-sonnet|claude-3-7-sonnet|claude-3-sonnet/i, input: 3, output: 15 },
  { test: /gemini-1\.5-flash/i, input: 0.075, output: 0.3 },
  { test: /gemini-1\.5-pro/i, input: 3.5, output: 10.5 }
]

const IMAGE_MODEL_PRICES = [
  {
    test: /^gpt-image-2(?:$|[-:])/i,
    textInput: 5,
    imageInput: 8,
    imageOutput: 30,
    output: {
      square: { low: 0.009, medium: 0.034, high: 0.133 },
      rectangle: { low: 0.013, medium: 0.05, high: 0.2 }
    }
  },
  {
    test: /^gpt-image-1\.5(?:$|[-:])/i,
    textInput: 5,
    imageInput: 8,
    imageOutput: 32,
    output: {
      square: { low: 0.009, medium: 0.034, high: 0.133 },
      rectangle: { low: 0.013, medium: 0.05, high: 0.2 }
    }
  },
  {
    test: /^gpt-image-1(?:$|[-:])/i,
    textInput: 5,
    imageInput: 10,
    imageOutput: 40,
    output: {
      square: { low: 0.011, medium: 0.042, high: 0.167 },
      rectangle: { low: 0.016, medium: 0.063, high: 0.25 }
    }
  }
]

const activeBudgetReservations = new Map()

function usagePath(userDataPath) {
  return path.join(userDataPath, AI_USAGE_FILE)
}

function number(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback
}

function optionalNumber(value, max = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : null
}

function dateKey(timestamp = Date.now()) {
  const value = new Date(timestamp)
  const date = Number.isNaN(value.getTime()) ? new Date() : value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

function findChatPrice(model) {
  const value = String(model || '')
  return CHAT_MODEL_PRICES_USD_PER_MILLION.find((item) => item.test.test(value)) || null
}

function findImagePrice(model) {
  const value = String(model || '').trim()
  return IMAGE_MODEL_PRICES.find((item) => item.test.test(value)) || null
}

function estimateAiCostUsd(model, inputTokens, outputTokens) {
  const price = findChatPrice(model)
  if (!price) return null
  return Number(
    (
      (number(inputTokens) / 1_000_000) * price.input +
      (number(outputTokens) / 1_000_000) * price.output
    ).toFixed(8)
  )
}

function imageShape(size) {
  if (size === '1024x1024') return 'square'
  if (size === '1024x1536' || size === '1536x1024') return 'rectangle'
  return ''
}

function estimateImageOutputCostUsd(model, size, quality, count = 1) {
  const price = findImagePrice(model)
  const shape = imageShape(String(size || '').trim())
  const normalizedQuality = String(quality || '')
    .trim()
    .toLowerCase()
  const perImage = price?.output?.[shape]?.[normalizedQuality]
  if (!Number.isFinite(perImage)) return null
  return Number((perImage * Math.max(1, Math.min(Math.trunc(number(count, 1)), 100))).toFixed(8))
}

function estimateImageRequestCostUsd({
  officialProvider = false,
  model = '',
  size = '',
  quality = '',
  count = 1,
  prompt = '',
  mode = 'generate',
  retryCount = 0,
  manualCostPerImageUsd = 0,
  includeRetries = true
} = {}) {
  const imageCount = Math.max(1, Math.min(Math.trunc(number(count, 1)), 100))
  const attempts = includeRetries
    ? Math.max(1, Math.min(Math.trunc(number(retryCount)) + 1, 10))
    : 1
  const manualCost = optionalNumber(manualCostPerImageUsd, MAX_BUDGET_USD)
  if (manualCost !== null && manualCost > 0) {
    const baseCostUsd = Number((manualCost * imageCount).toFixed(8))
    return {
      estimatedCostUsd: Number((baseCostUsd * attempts).toFixed(8)),
      baseCostUsd,
      costKnown: true,
      costSource: 'manual-per-image',
      attempts
    }
  }

  if (!officialProvider) {
    return {
      estimatedCostUsd: null,
      baseCostUsd: null,
      costKnown: false,
      costSource: 'unknown',
      attempts
    }
  }

  const price = findImagePrice(model)
  const outputCostUsd = estimateImageOutputCostUsd(model, size, quality, imageCount)
  if (!price || outputCostUsd === null) {
    return {
      estimatedCostUsd: null,
      baseCostUsd: null,
      costKnown: false,
      costSource: 'unknown',
      attempts
    }
  }

  const promptCostUsd = (estimateTokenCount(prompt) / 1_000_000) * price.textInput
  // 编辑/变体还会产生源图输入费用。供应商不会在请求前给出图像 Token，使用保守预留避免低估。
  const sourceImageReserveUsd =
    mode === 'generate' ? 0 : Math.max(0.04, (outputCostUsd / imageCount) * 0.25)
  const baseCostUsd = Number((outputCostUsd + promptCostUsd + sourceImageReserveUsd).toFixed(8))
  return {
    estimatedCostUsd: Number((baseCostUsd * attempts).toFixed(8)),
    baseCostUsd,
    costKnown: true,
    costSource: mode === 'generate' ? 'official-estimate' : 'official-estimate-with-input-reserve',
    attempts
  }
}

function usageDetails(usage, keys) {
  for (const key of keys) {
    const value = usage?.[key]
    if (value && typeof value === 'object') return value
  }
  return {}
}

function estimateImageUsageCostUsd(model, usage) {
  const price = findImagePrice(model)
  if (!price || !usage || typeof usage !== 'object') return null
  const normalized = normalizeUsage(usage)
  if (normalized.inputTokens <= 0 && normalized.outputTokens <= 0) return null

  const details = usageDetails(usage, ['input_tokens_details', 'inputTokensDetails'])
  const textInputTokens = pickUsageValue(details, ['text_tokens', 'textTokens'])
  const imageInputTokens = pickUsageValue(details, ['image_tokens', 'imageTokens'])
  const categorizedInputTokens = textInputTokens + imageInputTokens
  const uncategorizedInputTokens = Math.max(0, normalized.inputTokens - categorizedInputTokens)
  return Number(
    (
      (textInputTokens / 1_000_000) * price.textInput +
      ((imageInputTokens + uncategorizedInputTokens) / 1_000_000) * price.imageInput +
      (normalized.outputTokens / 1_000_000) * price.imageOutput
    ).toFixed(8)
  )
}

function defaultState() {
  return { version: 1, settings: normalizeSettings(), records: [] }
}

function normalizeRecord(value = {}) {
  const timestamp = number(value.timestamp, Date.now())
  const kind = value.kind === 'image' ? 'image' : 'chat'
  const model =
    String(value.model || 'unknown')
      .trim()
      .slice(0, 160) || 'unknown'
  const usage = normalizeUsage(value.usage || value, {
    inputText: value.inputText,
    outputText: value.outputText
  })
  const explicitCostUsd = optionalNumber(value.estimatedCostUsd, MAX_BUDGET_USD)
  let estimatedCostUsd = null
  if (value.costKnown !== false && explicitCostUsd !== null) estimatedCostUsd = explicitCostUsd
  else if (kind === 'image')
    estimatedCostUsd = estimateImageUsageCostUsd(model, value.usage || value)
  else estimatedCostUsd = estimateAiCostUsd(model, usage.inputTokens, usage.outputTokens)

  return {
    id: String(value.id || crypto.randomUUID()).slice(0, 100),
    timestamp,
    date: dateKey(timestamp),
    kind,
    providerId: String(value.providerId || '')
      .trim()
      .slice(0, 120),
    providerName: String(value.providerName || '')
      .trim()
      .slice(0, 120),
    model,
    units: kind === 'image' ? Math.max(1, Math.min(Math.trunc(number(value.units, 1)), 100)) : 1,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedInputTokens: usage.estimatedInputTokens,
    estimatedOutputTokens: usage.estimatedOutputTokens,
    estimatedCostUsd,
    costKnown: estimatedCostUsd !== null,
    costSource: String(value.costSource || (kind === 'image' ? 'provider-usage' : 'token-estimate'))
      .trim()
      .slice(0, 80)
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
      imageRequests: items.filter((item) => item.kind === 'image').length,
      images: items.reduce((sum, item) => sum + (item.kind === 'image' ? item.units : 0), 0),
      inputTokens: items.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: items.reduce((sum, item) => sum + item.outputTokens, 0),
      totalTokens: items.reduce((sum, item) => sum + item.totalTokens, 0),
      estimatedCostUsd: Number(costValues.reduce((sum, item) => sum + item, 0).toFixed(8)),
      unknownCostRequests: items.length - costValues.length
    }
  }
  const byModel = new Map()
  for (const item of records) {
    const key = `${item.kind}\n${item.providerId}\n${item.providerName}\n${item.model}`
    const current = byModel.get(key) || {
      kind: item.kind,
      providerId: item.providerId,
      providerName: item.providerName,
      model: item.model,
      requests: 0,
      images: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      unknownCostRequests: 0
    }
    current.requests += 1
    current.images += item.kind === 'image' ? item.units : 0
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
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || b.totalTokens - a.totalTokens)
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

function reservationBucket(userDataPath) {
  const key = String(userDataPath || '')
  let bucket = activeBudgetReservations.get(key)
  if (!bucket) {
    bucket = new Map()
    activeBudgetReservations.set(key, bucket)
  }
  const cutoff = Date.now() - MAX_RESERVATION_AGE_MS
  for (const [id, item] of bucket) {
    if (!item.retained && item.createdAt < cutoff) bucket.delete(id)
  }
  return bucket
}

function reservationCostUsd(userDataPath, excludeReservationId = '') {
  let total = 0
  for (const [id, item] of reservationBucket(userDataPath)) {
    if (id !== excludeReservationId && item.costKnown) total += item.estimatedCostUsd
  }
  return Number(total.toFixed(8))
}

function checkAiUsageBudget(
  userDataPath,
  {
    providerId = '',
    model = '',
    override = false,
    estimatedCostUsd,
    costKnown,
    reservationId = ''
  } = {}
) {
  const state = loadState(userDataPath)
  const summary = summarize(state.records)
  const explicitEstimate = optionalNumber(estimatedCostUsd, MAX_BUDGET_USD)
  const requestCostKnown =
    typeof costKnown === 'boolean'
      ? costKnown
      : explicitEstimate !== null || estimateAiCostUsd(model, 1, 1) !== null
  const projectedRequestCostUsd = requestCostKnown ? explicitEstimate || 0 : null
  const reservedCostUsd = reservationCostUsd(userDataPath, reservationId)
  const budgetEnabled = state.settings.dailyBudgetUsd > 0 || state.settings.monthlyBudgetUsd > 0

  if (budgetEnabled && !requestCostKnown && !state.settings.allowUnknownCost && !override) {
    return {
      allowed: false,
      reason:
        '当前请求没有可靠费用估算，无法执行预算保护；请配置费用估算、允许未知费用或手动确认本次继续',
      code: 'AI_USAGE_COST_UNKNOWN',
      providerId,
      model,
      estimatedCostUsd: null,
      reservedCostUsd,
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
    const current = summary[period].estimatedCostUsd + reservedCostUsd
    const projected = current + (projectedRequestCostUsd || 0)
    return limit > 0 && (current >= limit || projected > limit) && !override
  })
  const projection = {
    todayUsd: Number(
      (summary.today.estimatedCostUsd + reservedCostUsd + (projectedRequestCostUsd || 0)).toFixed(8)
    ),
    monthUsd: Number(
      (summary.month.estimatedCostUsd + reservedCostUsd + (projectedRequestCostUsd || 0)).toFixed(8)
    )
  }
  return {
    allowed: !blocked,
    reason: blocked
      ? `${blocked[2]} AI 预算预计费用将超过 $${state.settings[blocked[0]].toFixed(2)}（本次预计 ${
          projectedRequestCostUsd === null ? '未知' : `$${projectedRequestCostUsd.toFixed(4)}`
        }），请调整预算或手动确认本次继续`
      : '',
    code: blocked ? 'AI_USAGE_BUDGET_EXCEEDED' : '',
    providerId,
    model,
    estimatedCostUsd: projectedRequestCostUsd,
    reservedCostUsd,
    projection,
    settings: state.settings,
    summary
  }
}

function reserveAiUsageBudget(userDataPath, options = {}) {
  const reservationId = String(options.reservationId || '')
    .trim()
    .slice(0, 160)
  if (!reservationId) throw new Error('AI 预算预留标识无效')
  const bucket = reservationBucket(userDataPath)
  bucket.delete(reservationId)
  const budget = checkAiUsageBudget(userDataPath, { ...options, reservationId })
  if (budget.allowed) {
    bucket.set(reservationId, {
      createdAt: Date.now(),
      estimatedCostUsd: budget.estimatedCostUsd || 0,
      costKnown: budget.estimatedCostUsd !== null
    })
  }
  return budget
}

function retainAiUsageBudget(userDataPath, reservationId) {
  const id = String(reservationId || '').trim()
  if (!id) return false
  const item = reservationBucket(userDataPath).get(id)
  if (!item) return false
  item.retained = true
  return true
}

function releaseAiUsageBudget(userDataPath, reservationId, { force = false } = {}) {
  const id = String(reservationId || '').trim()
  if (!id) return false
  const bucket = reservationBucket(userDataPath)
  const item = bucket.get(id)
  if (item?.retained && !force) return false
  const removed = bucket.delete(id)
  if (bucket.size === 0) activeBudgetReservations.delete(String(userDataPath || ''))
  return removed
}

function recordAiUsage(
  userDataPath,
  {
    providerId = '',
    providerName = '',
    model = '',
    kind = 'chat',
    units = 1,
    usage,
    inputText = '',
    outputText = '',
    estimatedCostUsd,
    costKnown,
    costSource = '',
    reservationId = '',
    strictPersistence = false
  } = {}
) {
  const state = loadState(userDataPath)
  const record = normalizeRecord({
    providerId,
    providerName,
    model,
    kind,
    units,
    usage,
    inputText,
    outputText,
    estimatedCostUsd,
    costKnown,
    costSource,
    timestamp: Date.now()
  })
  state.records = [record, ...state.records].slice(0, MAX_AI_USAGE_RECORDS)
  const persisted = writeJsonFile(usagePath(userDataPath), state)
  if (!persisted) {
    if (reservationId) retainAiUsageBudget(userDataPath, reservationId)
    if (strictPersistence) {
      throw new Error('保存 AI 用量记录失败，当前进程已保留本次预算占用')
    }
  } else if (reservationId) {
    releaseAiUsageBudget(userDataPath, reservationId)
  }
  return { entry: record, summary: summarize(state.records), settings: state.settings }
}

module.exports = {
  AI_USAGE_FILE,
  MAX_AI_USAGE_RECORDS,
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
  __testables: {
    dateKey,
    normalizeRecord,
    summarize,
    reservationCostUsd
  }
}
