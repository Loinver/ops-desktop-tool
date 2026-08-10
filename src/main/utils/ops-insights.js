const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')

const SETTINGS_FILE = 'ops-insights-settings.json'
const MAX_PRICING_ITEMS = 100
const MAX_MODEL_HISTORY = 60
const MAX_EVALUATION_RUNS = 50
const MAX_RELEASE_HISTORY = 50
const MAX_NODE_SERVICES = 100

function text(value, max = 200) {
  return String(value || '')
    .trim()
    .slice(0, max)
}

function boundedNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

function pricingKey(providerId, model) {
  return `${text(providerId, 120)}::${text(model, 180)}`
}

function normalizePricingItem(value = {}) {
  const providerId = text(value.providerId, 120)
  const model = text(value.model, 180)
  if (!providerId || !model) throw new Error('Provider 和模型不能为空')
  return {
    id: pricingKey(providerId, model),
    providerId,
    providerName: text(value.providerName || providerId, 160) || providerId,
    model,
    inputUsdPerMillion: boundedNumber(value.inputUsdPerMillion, 0, 1_000_000),
    outputUsdPerMillion: boundedNumber(value.outputUsdPerMillion, 0, 1_000_000),
    updatedAt: Number(value.updatedAt) || Date.now()
  }
}

function normalizeSettings(value = {}) {
  const pricing = []
  const seen = new Set()
  for (const item of Array.isArray(value?.pricing) ? value.pricing : []) {
    try {
      const normalized = normalizePricingItem(item)
      if (seen.has(normalized.id)) continue
      seen.add(normalized.id)
      pricing.push(normalized)
    } catch {}
    if (pricing.length >= MAX_PRICING_ITEMS) break
  }
  return { version: 1, pricing }
}

function settingsPath(userDataPath) {
  return path.join(userDataPath, SETTINGS_FILE)
}

function loadOpsInsightsSettings(userDataPath) {
  return normalizeSettings(readJsonFile(settingsPath(userDataPath), { version: 1, pricing: [] }))
}

function saveOpsInsightsSettings(userDataPath, input = {}) {
  const current = loadOpsInsightsSettings(userDataPath)
  const items = Array.isArray(input?.pricing) ? input.pricing : [input]
  const byId = new Map(current.pricing.map((item) => [item.id, item]))
  for (const raw of items) {
    const item = normalizePricingItem(raw)
    byId.set(item.id, item)
  }
  const settings = normalizeSettings({ version: 1, pricing: [...byId.values()] })
  if (!writeJsonFile(settingsPath(userDataPath), settings)) throw new Error('保存模型价格配置失败')
  return settings
}

function estimateTokens(value) {
  const length = Array.from(String(value || '')).length
  return length ? Math.max(1, Math.ceil(length / 4)) : 0
}

function round(value, digits = 2) {
  const scale = 10 ** digits
  return Math.round((Number(value) || 0) * scale) / scale
}

function buildModelReliability(modelHistory = []) {
  const groups = new Map()
  for (const snapshot of (Array.isArray(modelHistory) ? modelHistory : []).slice(
    0,
    MAX_MODEL_HISTORY
  )) {
    for (const result of Array.isArray(snapshot?.results) ? snapshot.results : []) {
      const providerId = text(result?.providerId, 120)
      const model = text(result?.model, 180)
      if (!providerId || !model) continue
      const appType = text(result?.appType, 80)
      const key = `${providerId}::${appType}::${model}`
      const group = groups.get(key) || {
        id: key,
        providerId,
        providerName: text(result?.providerName || providerId, 160) || providerId,
        appType,
        model,
        total: 0,
        successful: 0,
        failed: 0,
        durationTotalMs: 0,
        latestStatus: '',
        latestCheckedAt: 0
      }
      group.total += 1
      const ok = result?.status === 'ok' || result?.ok === true
      if (ok) group.successful += 1
      else group.failed += 1
      group.durationTotalMs += Math.max(0, Number(result?.durationMs) || 0)
      const checkedAt = Number(snapshot?.finishedAt || snapshot?.startedAt) || 0
      if (checkedAt >= group.latestCheckedAt) {
        group.latestCheckedAt = checkedAt
        group.latestStatus = ok ? 'ok' : text(result?.status || 'failed', 40)
      }
      groups.set(key, group)
    }
  }
  return [...groups.values()]
    .map((item) => ({
      ...item,
      successRate: item.total ? round((item.successful / item.total) * 100, 1) : 0,
      averageDurationMs: item.total ? Math.round(item.durationTotalMs / item.total) : 0
    }))
    .sort((a, b) => b.latestCheckedAt - a.latestCheckedAt)
    .slice(0, 100)
}

function buildEvaluationInsights(evaluationState = {}, settings = {}) {
  const cases = new Map(
    (Array.isArray(evaluationState?.cases) ? evaluationState.cases : []).map((item) => [
      item?.id,
      item
    ])
  )
  const pricing = new Map(
    normalizeSettings(settings).pricing.map((item) => [
      pricingKey(item.providerId, item.model),
      item
    ])
  )
  const groups = new Map()
  for (const run of (Array.isArray(evaluationState?.runs) ? evaluationState.runs : []).slice(
    0,
    MAX_EVALUATION_RUNS
  )) {
    const providerId = text(run?.providerId, 120)
    const model = text(run?.model, 180)
    if (!providerId || !model) continue
    const key = pricingKey(providerId, model)
    const group = groups.get(key) || {
      id: key,
      providerId,
      providerName: text(run?.providerName || providerId, 160) || providerId,
      model,
      runs: 0,
      totalCases: 0,
      passedCases: 0,
      failedCases: 0,
      durationTotalMs: 0,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      latestRunAt: 0
    }
    group.runs += 1
    const results = Array.isArray(run?.results) ? run.results : []
    group.totalCases += results.length
    group.passedCases += results.filter((item) => item?.ok).length
    group.failedCases += results.filter((item) => !item?.ok).length
    group.durationTotalMs += results.reduce(
      (sum, item) => sum + Math.max(0, Number(item?.durationMs) || 0),
      0
    )
    group.latestRunAt = Math.max(group.latestRunAt, Number(run?.finishedAt || run?.startedAt) || 0)
    for (const result of results) {
      const testCase = cases.get(result?.id) || {}
      group.estimatedInputTokens += estimateTokens(
        [testCase?.systemPrompt, testCase?.prompt].filter(Boolean).join('\n')
      )
      group.estimatedOutputTokens += estimateTokens(result?.answer)
    }
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((item) => {
      const rate = pricing.get(item.id)
      const estimatedCostUsd = rate
        ? (item.estimatedInputTokens / 1_000_000) * rate.inputUsdPerMillion +
          (item.estimatedOutputTokens / 1_000_000) * rate.outputUsdPerMillion
        : null
      return {
        ...item,
        passRate: item.totalCases ? round((item.passedCases / item.totalCases) * 100, 1) : 0,
        averageDurationMs: item.totalCases ? Math.round(item.durationTotalMs / item.totalCases) : 0,
        pricing: rate || null,
        estimatedCostUsd: estimatedCostUsd === null ? null : round(estimatedCostUsd, 6)
      }
    })
    .sort((a, b) => b.latestRunAt - a.latestRunAt)
    .slice(0, 100)
}

function releaseRiskLevel(score) {
  if (score >= 75) return 'critical'
  if (score >= 50) return 'high'
  if (score >= 25) return 'medium'
  return 'low'
}

function buildReleaseRisk(releaseHistory = []) {
  const history = (Array.isArray(releaseHistory) ? releaseHistory : []).slice(
    0,
    MAX_RELEASE_HISTORY
  )
  if (!history.length) {
    return {
      score: 0,
      level: 'unknown',
      sampleSize: 0,
      failureRate: 0,
      rollbackRate: 0,
      latestStatus: '',
      factors: ['暂无发布历史，无法形成历史风险参考'],
      disclaimer: '该评分仅基于本机历史记录，不替代发布前检查、健康检查和人工审批。'
    }
  }
  const failed = history.filter((item) => item?.status === 'failed').length
  const rolledBack = history.filter(
    (item) => item?.status === 'rolled-back' || item?.action === 'rollback'
  ).length
  const failureRate = failed / history.length
  const rollbackRate = rolledBack / history.length
  const latestStatus = text(history[0]?.status, 40)
  const recentFailures = history.slice(0, 5).filter((item) => item?.status === 'failed').length
  const largestEntryCount = history.reduce(
    (max, item) => Math.max(max, Math.max(0, Number(item?.entryCount) || 0)),
    0
  )
  let score = failureRate * 35 + rollbackRate * 20 + Math.min(15, recentFailures * 5)
  if (latestStatus === 'failed') score += 20
  else if (latestStatus === 'rolled-back') score += 15
  score += Math.min(10, (largestEntryCount / 20_000) * 10)
  score = Math.round(Math.min(100, score))
  const factors = []
  if (failureRate)
    factors.push(`最近 ${history.length} 次记录失败率 ${round(failureRate * 100, 1)}%`)
  if (rollbackRate) factors.push(`回滚相关记录占比 ${round(rollbackRate * 100, 1)}%`)
  if (recentFailures) factors.push(`最近 5 次记录中有 ${recentFailures} 次失败`)
  if (largestEntryCount >= 5_000) factors.push(`历史最大发布条目数 ${largestEntryCount}`)
  if (!factors.length) factors.push('近期历史记录未发现失败或回滚信号')
  return {
    score,
    level: releaseRiskLevel(score),
    sampleSize: history.length,
    failureRate: round(failureRate * 100, 1),
    rollbackRate: round(rollbackRate * 100, 1),
    latestStatus,
    factors,
    disclaimer: '该评分仅基于本机历史记录，不替代发布前检查、健康检查和人工审批。'
  }
}

function buildNodeInsights(nodeHistory = []) {
  const groups = new Map()
  for (const sample of Array.isArray(nodeHistory) ? nodeHistory : []) {
    const serviceId = text(sample?.serviceId, 160)
    if (!serviceId) continue
    const group = groups.get(serviceId) || {
      serviceId,
      protocol: text(sample?.protocol, 20),
      port: Math.max(0, Number(sample?.port) || 0),
      samples: 0,
      onlineSamples: 0,
      metricSamples: 0,
      unavailableMetricSamples: 0,
      cpuTotal: 0,
      maxCpuPercent: 0,
      memoryTotalBytes: 0,
      maxMemoryBytes: 0,
      latest: null
    }
    const metricsAvailable =
      sample?.state === 'online' &&
      sample?.metricsAvailable !== false &&
      sample?.cpuPercent !== null &&
      sample?.memoryBytes !== null &&
      Number.isFinite(Number(sample?.cpuPercent)) &&
      Number.isFinite(Number(sample?.memoryBytes))
    const cpuPercent = metricsAvailable ? boundedNumber(sample?.cpuPercent, 0, 100_000) : null
    const memoryBytes = metricsAvailable ? boundedNumber(sample?.memoryBytes, 0) : null
    group.samples += 1
    if (sample?.state === 'online') group.onlineSamples += 1
    if (metricsAvailable) {
      group.metricSamples += 1
      group.cpuTotal += cpuPercent
      group.maxCpuPercent = Math.max(group.maxCpuPercent, cpuPercent)
      group.memoryTotalBytes += memoryBytes
      group.maxMemoryBytes = Math.max(group.maxMemoryBytes, memoryBytes)
    } else if (sample?.state === 'online') {
      group.unavailableMetricSamples += 1
    }
    if (!group.latest || Number(sample?.checkedAt) > Number(group.latest?.checkedAt)) {
      group.latest = {
        state: sample?.state === 'online' ? 'online' : 'offline',
        pid: Math.max(0, Number(sample?.pid) || 0),
        cpuPercent,
        memoryBytes,
        metricsAvailable,
        metricsStatus:
          sample?.state !== 'online'
            ? 'not-applicable'
            : metricsAvailable
              ? 'available'
              : 'unavailable',
        checkedAt: Number(sample?.checkedAt) || 0,
        commandLabel: text(sample?.commandLabel, 240)
      }
    }
    groups.set(serviceId, group)
  }
  return [...groups.values()]
    .map((item) => ({
      ...item,
      availability: item.samples ? round((item.onlineSamples / item.samples) * 100, 1) : 0,
      averageCpuPercent: item.metricSamples ? round(item.cpuTotal / item.metricSamples, 1) : null,
      averageMemoryBytes: item.metricSamples
        ? Math.round(item.memoryTotalBytes / item.metricSamples)
        : null
    }))
    .sort((a, b) => Number(b.latest?.checkedAt) - Number(a.latest?.checkedAt))
    .slice(0, MAX_NODE_SERVICES)
}

function buildOpsInsights({
  modelHistory = [],
  evaluationState = {},
  releaseHistory = [],
  nodeHistory = [],
  settings = {},
  generatedAt = Date.now()
} = {}) {
  const normalizedSettings = normalizeSettings(settings)
  return {
    generatedAt: Number(generatedAt) || Date.now(),
    modelReliability: buildModelReliability(modelHistory),
    evaluations: buildEvaluationInsights(evaluationState, normalizedSettings),
    releaseRisk: buildReleaseRisk(releaseHistory),
    nodeServices: buildNodeInsights(nodeHistory),
    settings: normalizedSettings,
    notes: {
      tokenEstimate: 'Token 数按字符数除以 4 粗略估算，仅用于本地趋势和预算参考。',
      releaseRisk: '发布风险是历史参考分，不是上线前确定性预测。',
      nodeAvailability: 'Node 可用率按本机已采集样本计算；未采样时段不计入。'
    }
  }
}

module.exports = {
  buildEvaluationInsights,
  buildModelReliability,
  buildNodeInsights,
  buildOpsInsights,
  buildReleaseRisk,
  estimateTokens,
  loadOpsInsightsSettings,
  normalizePricingItem,
  normalizeSettings,
  pricingKey,
  saveOpsInsightsSettings
}
