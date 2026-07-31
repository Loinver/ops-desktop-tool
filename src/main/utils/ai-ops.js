const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const { readJsonFile, writeJsonFile } = require('./json-store')
const { encryptSecret, readSecretField, maskSecret } = require('./secure-secret')

const MAX_PROVIDERS = 20
const MAX_EVALUATION_CASES = 50
const MAX_EVALUATION_RUNS = 100
const MAX_LOG_ITEMS = 100
const MAX_KNOWLEDGE_DOCUMENTS = 100
const MAX_WORKFLOWS = 100
const MAX_TEXT_LENGTH = 200_000

function filePath(userDataPath, fileName) {
  return path.join(userDataPath, fileName)
}

function string(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function defaultUserDataPath() {
  if (process.env.OPS_USER_DATA) return process.env.OPS_USER_DATA
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'ops-desktop-tool')
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'ops-desktop-tool')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'ops-desktop-tool')
}

function redactSensitiveText(value) {
  let text = String(value || '')
  text = text.replace(/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g, '[已脱敏：私钥]')
  text = text.replace(/\b(sk-[A-Za-z0-9_-]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[已脱敏：API Key]')
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1[已脱敏]')
  text = text.replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[已脱敏]')
  return text
}

function normalizeBaseUrl(value) {
  const raw = string(value, 500).replace(/\/+$/, '')
  if (!raw) throw new Error('请输入 OpenAI 兼容接口地址')
  let parsed
  try { parsed = new URL(raw) } catch { throw new Error('AI 接口地址格式无效') }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('AI 接口地址仅支持 http 或 https')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('AI 接口地址不能包含账号、查询参数或片段')
  return raw
}

function normalizeProvider(input = {}, existing = {}) {
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? existing.baseUrl ?? '')
  const model = string(input.model ?? existing.model, 160)
  if (!model) throw new Error('请输入默认模型')
  return {
    id: string(existing.id || input.id || crypto.randomUUID(), 100),
    name: redactSensitiveText(string(input.name ?? existing.name ?? 'AI Provider', 80)) || 'AI Provider',
    baseUrl,
    model,
    enabled: input.enabled !== false,
    createdAt: Number(existing.createdAt) || Date.now(),
    updatedAt: Date.now(),
  }
}

function providerStatePath(userDataPath) { return filePath(userDataPath, 'ai-providers.json') }
function evaluationStatePath(userDataPath) { return filePath(userDataPath, 'ai-evaluations.json') }
function logStatePath(userDataPath) { return filePath(userDataPath, 'ai-log-analysis.json') }
function knowledgeStatePath(userDataPath) { return filePath(userDataPath, 'ai-knowledge.json') }
function workflowStatePath(userDataPath) { return filePath(userDataPath, 'ai-workflows.json') }

function loadProviderRaw(userDataPath) {
  const value = readJsonFile(providerStatePath(userDataPath), { version: 1, activeProviderId: '', providers: [] })
  const providers = Array.isArray(value?.providers) ? value.providers.slice(0, MAX_PROVIDERS) : []
  const activeProviderId = providers.some(item => item?.id === value?.activeProviderId) ? value.activeProviderId : providers[0]?.id || ''
  return { version: 1, activeProviderId, providers }
}

function safeProvider(provider, safeStorage) {
  let apiKey = ''
  try {
    apiKey = readSecretField({ safeStorage, record: provider, encryptedKey: 'apiKeyEncrypted', legacyKey: 'apiKey' }).value
  } catch {}
  return {
    id: string(provider?.id, 100),
    name: string(provider?.name, 80),
    baseUrl: string(provider?.baseUrl, 500),
    model: string(provider?.model, 160),
    enabled: provider?.enabled !== false,
    createdAt: Number(provider?.createdAt) || 0,
    updatedAt: Number(provider?.updatedAt) || 0,
    hasApiKey: Boolean(apiKey || provider?.apiKeyEncrypted),
    apiKeyMasked: apiKey ? maskSecret(apiKey) : (provider?.apiKeyEncrypted ? '••••••••' : ''),
  }
}

function listProviders({ userDataPath, safeStorage }) {
  const state = loadProviderRaw(userDataPath)
  return { activeProviderId: state.activeProviderId, providers: state.providers.map(item => safeProvider(item, safeStorage)) }
}

function saveProvider({ userDataPath, safeStorage, input = {} }) {
  const state = loadProviderRaw(userDataPath)
  const id = string(input.id, 100)
  const index = state.providers.findIndex(item => item.id === id)
  const existing = index >= 0 ? state.providers[index] : {}
  const provider = normalizeProvider(input, existing)
  const suppliedKey = String(input.apiKey || '').trim()
  if (input.clearApiKey) provider.apiKeyEncrypted = ''
  else if (suppliedKey) provider.apiKeyEncrypted = encryptSecret(safeStorage, suppliedKey)
  else provider.apiKeyEncrypted = existing.apiKeyEncrypted || ''
  delete provider.apiKey
  if (index >= 0) state.providers[index] = provider
  else state.providers.push(provider)
  state.activeProviderId = provider.id
  if (!writeJsonFile(providerStatePath(userDataPath), state)) throw new Error('保存 AI Provider 失败')
  return { activeProviderId: state.activeProviderId, provider: safeProvider(provider, safeStorage) }
}

function deleteProvider({ userDataPath, safeStorage, id }) {
  const state = loadProviderRaw(userDataPath)
  const next = state.providers.filter(item => item.id !== String(id || ''))
  if (next.length === state.providers.length) throw new Error('AI Provider 不存在')
  state.providers = next
  if (state.activeProviderId === id) state.activeProviderId = next[0]?.id || ''
  if (!writeJsonFile(providerStatePath(userDataPath), state)) throw new Error('删除 AI Provider 失败')
  return listProviders({ userDataPath, safeStorage })
}

function activateProvider({ userDataPath, safeStorage, id }) {
  const state = loadProviderRaw(userDataPath)
  if (!state.providers.some(item => item.id === id)) throw new Error('AI Provider 不存在')
  state.activeProviderId = id
  if (!writeJsonFile(providerStatePath(userDataPath), state)) throw new Error('切换 AI Provider 失败')
  return listProviders({ userDataPath, safeStorage })
}

function runtimeProvider({ userDataPath, safeStorage, providerId }) {
  const state = loadProviderRaw(userDataPath)
  const provider = state.providers.find(item => item.id === (providerId || state.activeProviderId))
  if (!provider || provider.enabled === false) throw new Error('请先在 AI Provider 中配置并启用可用模型')
  const apiKey = readSecretField({ safeStorage, record: provider, encryptedKey: 'apiKeyEncrypted', legacyKey: 'apiKey' }).value
  if (!apiKey) throw new Error('当前 AI Provider 未配置 API Key')
  return { ...safeProvider(provider, safeStorage), apiKey }
}

function chatEndpoint(baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  return /\/v1$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

async function requestCompletion(provider, { messages = [], temperature = 0.2, responseFormat } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const body = { model: provider.model, messages, temperature }
    if (responseFormat) body.response_format = responseFormat
    const response = await fetch(chatEndpoint(provider.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const raw = await response.text()
    let data
    try { data = JSON.parse(raw) } catch { data = null }
    if (!response.ok) {
      const detail = string(data?.error?.message || raw, 500) || `HTTP ${response.status}`
      throw new Error(`AI 请求失败：${detail}`)
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI 未返回可用文本')
    return { content: content.trim(), usage: data?.usage || {}, model: data?.model || provider.model }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('AI 请求超时（60 秒）')
    throw error
  } finally { clearTimeout(timer) }
}

function normalizeExpectedKeywords(value) {
  return Array.from(new Set((Array.isArray(value) ? value : String(value || '').split(/[\n,，]/)).map(item => string(item, 100)).filter(Boolean))).slice(0, 20)
}

function normalizeEvaluationCase(value = {}) {
  const prompt = redactSensitiveText(string(value.prompt, 4000))
  if (!prompt) throw new Error('评测用例提示词不能为空')
  return {
    id: string(value.id || crypto.randomUUID(), 100),
    name: string(value.name || '未命名用例', 100) || '未命名用例',
    prompt,
    systemPrompt: redactSensitiveText(string(value.systemPrompt, 2000)),
    expectedKeywords: normalizeExpectedKeywords(value.expectedKeywords),
    expectJson: Boolean(value.expectJson),
    updatedAt: Date.now(),
  }
}

function loadEvaluationState(userDataPath) {
  const value = readJsonFile(evaluationStatePath(userDataPath), { version: 1, cases: [], runs: [] })
  return { version: 1, cases: Array.isArray(value?.cases) ? value.cases.slice(0, MAX_EVALUATION_CASES) : [], runs: Array.isArray(value?.runs) ? value.runs.slice(0, MAX_EVALUATION_RUNS) : [] }
}

function saveEvaluationCases(userDataPath, cases) {
  const state = loadEvaluationState(userDataPath)
  state.cases = (Array.isArray(cases) ? cases : []).slice(0, MAX_EVALUATION_CASES).map(normalizeEvaluationCase)
  if (!writeJsonFile(evaluationStatePath(userDataPath), state)) throw new Error('保存评测用例失败')
  return state.cases
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(raw) } catch { return null }
}

async function runEvaluation({ userDataPath, safeStorage, providerId, caseIds }) {
  const state = loadEvaluationState(userDataPath)
  const selected = Array.isArray(caseIds) && caseIds.length
    ? state.cases.filter(item => caseIds.includes(item.id))
    : state.cases
  if (!selected.length) throw new Error('请先配置至少一个评测用例')
  const provider = runtimeProvider({ userDataPath, safeStorage, providerId })
  const startedAt = Date.now()
  const results = []
  for (const item of selected) {
    const messages = []
    if (item.systemPrompt) messages.push({ role: 'system', content: item.systemPrompt })
    messages.push({ role: 'user', content: item.prompt })
    const start = Date.now()
    try {
      const response = await requestCompletion(provider, { messages, temperature: 0 })
      const answer = response.content
      const lower = answer.toLowerCase()
      const matchedKeywords = item.expectedKeywords.filter(keyword => lower.includes(keyword.toLowerCase()))
      const json = item.expectJson ? extractJson(answer) : {}
      const keywordOk = !item.expectedKeywords.length || matchedKeywords.length === item.expectedKeywords.length
      const jsonOk = !item.expectJson || Boolean(json && typeof json === 'object' && !Array.isArray(json))
      results.push({ id: item.id, name: item.name, ok: keywordOk && jsonOk, durationMs: Date.now() - start, matchedKeywords, expectedKeywords: item.expectedKeywords, jsonOk, answer: redactSensitiveText(answer).slice(0, 8000) })
    } catch (error) {
      results.push({ id: item.id, name: item.name, ok: false, durationMs: Date.now() - start, error: string(error?.message, 500), matchedKeywords: [], expectedKeywords: item.expectedKeywords, jsonOk: false, answer: '' })
    }
  }
  const summary = { total: results.length, passed: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length, averageDurationMs: results.length ? Math.round(results.reduce((sum, item) => sum + item.durationMs, 0) / results.length) : 0 }
  const run = { id: crypto.randomUUID(), providerId: provider.id, providerName: provider.name, model: provider.model, startedAt, finishedAt: Date.now(), summary, results }
  state.runs.unshift(run)
  state.runs = state.runs.slice(0, MAX_EVALUATION_RUNS)
  if (!writeJsonFile(evaluationStatePath(userDataPath), state)) throw new Error('保存评测结果失败')
  return run
}

function analyzeLogText(input) {
  const text = redactSensitiveText(String(input || '').slice(0, MAX_TEXT_LENGTH))
  const lines = text.split(/\r?\n/).filter(Boolean)
  const patterns = [
    ['error', /\b(error|exception|fatal|failed|失败|异常)\b/i],
    ['timeout', /\b(timeout|timed out|超时)\b/i],
    ['permission', /\b(permission denied|access denied|unauthorized|forbidden|权限)\b/i],
    ['network', /\b(connection refused|econnrefused|dns|network|网络)\b/i],
    ['disk', /\b(no space left|disk full|磁盘空间|空间不足)\b/i],
  ]
  const findings = patterns.map(([type, pattern]) => {
    const matches = lines.filter(line => pattern.test(line))
    return { type, count: matches.length, samples: matches.slice(0, 3).map(line => line.slice(0, 500)) }
  }).filter(item => item.count)
  const level = findings.some(item => item.type === 'disk' || item.type === 'permission') ? 'high' : findings.some(item => item.type === 'error' || item.type === 'timeout') ? 'medium' : 'low'
  const headline = findings.length ? `发现 ${findings.reduce((sum, item) => sum + item.count, 0)} 条异常线索` : '未识别到典型异常模式'
  return { rawLength: text.length, lineCount: lines.length, level, headline, findings, excerpt: lines.slice(-80).join('\n').slice(0, 20_000), analyzedAt: Date.now() }
}

function loadLogState(userDataPath) {
  const value = readJsonFile(logStatePath(userDataPath), { version: 1, items: [] })
  return { version: 1, items: Array.isArray(value?.items) ? value.items.slice(0, MAX_LOG_ITEMS) : [] }
}

function saveLogAnalysis(userDataPath, { title, text, aiSummary = '' }) {
  const state = loadLogState(userDataPath)
  const analysis = analyzeLogText(text)
  const item = { id: crypto.randomUUID(), title: redactSensitiveText(string(title || '未命名日志', 120)) || '未命名日志', ...analysis, aiSummary: redactSensitiveText(aiSummary).slice(0, 12_000), createdAt: Date.now() }
  state.items.unshift(item)
  state.items = state.items.slice(0, MAX_LOG_ITEMS)
  if (!writeJsonFile(logStatePath(userDataPath), state)) throw new Error('保存日志分析失败')
  return item
}

function terms(text) {
  const normalized = String(text || '').toLowerCase()
  const items = normalized.match(/[a-z0-9_./:-]{2,}/g) || []
  // 连续中文若只当成一个词，会让“如何回滚正式环境”无法命中“正式环境发布 SOP”。
  // 同时保留原短语和 2–8 字片段，兼顾中文检索与快捷启动名称匹配。
  for (const phrase of normalized.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    items.push(phrase)
    const maxLength = Math.min(8, phrase.length)
    for (let length = 2; length <= maxLength; length += 1) {
      for (let start = 0; start + length <= phrase.length; start += 1) items.push(phrase.slice(start, start + length))
    }
  }
  return Array.from(new Set(items)).slice(0, 500)
}

function normalizeKnowledgeDocument(value = {}) {
  const content = redactSensitiveText(String(value.content || '').trim().slice(0, MAX_TEXT_LENGTH))
  if (!content) throw new Error('知识内容不能为空')
  const tags = Array.from(new Set((Array.isArray(value.tags) ? value.tags : String(value.tags || '').split(/[，,]/))
    .map(item => redactSensitiveText(string(item, 40)))
    .filter(Boolean))).slice(0, 20)
  return { id: string(value.id || crypto.randomUUID(), 100), title: redactSensitiveText(string(value.title || '未命名知识', 160)) || '未命名知识', content, tags, updatedAt: Date.now() }
}

function loadKnowledgeState(userDataPath) {
  const value = readJsonFile(knowledgeStatePath(userDataPath), { version: 1, documents: [] })
  return { version: 1, documents: Array.isArray(value?.documents) ? value.documents.slice(0, MAX_KNOWLEDGE_DOCUMENTS) : [] }
}

function saveKnowledgeDocument(userDataPath, value) {
  const state = loadKnowledgeState(userDataPath)
  const document = normalizeKnowledgeDocument(value)
  const index = state.documents.findIndex(item => item.id === document.id)
  if (index >= 0) state.documents[index] = document
  else state.documents.unshift(document)
  if (!writeJsonFile(knowledgeStatePath(userDataPath), state)) throw new Error('保存知识文档失败')
  return document
}

function deleteKnowledgeDocument(userDataPath, id) {
  const state = loadKnowledgeState(userDataPath)
  state.documents = state.documents.filter(item => item.id !== id)
  if (!writeJsonFile(knowledgeStatePath(userDataPath), state)) throw new Error('删除知识文档失败')
  return state.documents
}

function searchKnowledge(userDataPath, query, limit = 8) {
  const keywords = terms(query)
  if (!keywords.length) return []
  const docs = loadKnowledgeState(userDataPath).documents
  const matches = []
  for (const doc of docs) {
    const title = redactSensitiveText(String(doc.title || '未命名知识'))
    const tags = (Array.isArray(doc.tags) ? doc.tags : []).map(item => redactSensitiveText(String(item || ''))).filter(Boolean)
    const lines = redactSensitiveText(String(doc.content || '')).split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 12) {
      const block = lines.slice(i, i + 12).join('\n')
      const lower = `${title}\n${tags.join(' ')}\n${block}`.toLowerCase()
      const score = keywords.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 1 : 0), 0)
      if (score) matches.push({ documentId: doc.id, title, tags, startLine: i + 1, endLine: Math.min(lines.length, i + 12), score, content: block.slice(0, 2200) })
    }
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(20, Number(limit) || 8)))
}

function loadWorkflowState(userDataPath) {
  const value = readJsonFile(workflowStatePath(userDataPath), { version: 1, history: [] })
  return { version: 1, history: Array.isArray(value?.history) ? value.history.slice(0, MAX_WORKFLOWS) : [] }
}

function planWorkflow({ prompt, quickLaunchItems = [] }) {
  const request = redactSensitiveText(string(prompt, 1000))
  if (!request) throw new Error('请输入想执行的运维操作')
  const steps = []
  const normalized = request.toLowerCase()
  if (/打开|open|访问/.test(normalized)) {
    const requestTerms = terms(request)
    const matched = (Array.isArray(quickLaunchItems) ? quickLaunchItems : [])
      .filter(item => item?.type === 'url' && string(item.target, 2000))
      .map(item => {
        const name = string(item.name, 160).toLowerCase()
        const compactName = name.replace(/\s+/g, '')
        const compactRequest = normalized.replace(/\s+/g, '')
        const haystack = `${name} ${string(item.target, 2000)}`.toLowerCase()
        // 快捷启动名称通常是自然语言短语（如“测试环境后台”）；优先精确包含名称，
        // 再以关键词打分，避免“打开测试环境后台”因多了动作词而无法命中。
        const directNameScore = compactName.length >= 2 && compactRequest.includes(compactName) ? 100 + compactName.length : 0
        const score = directNameScore + requestTerms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0)
        return { item, score }
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map(({ item }) => item)
    for (const item of matched) steps.push({ type: 'open-url', label: `打开网站：${string(item.name, 80)}`, target: string(item.target, 2000), risk: 'low', requiresConfirmation: true })
  }
  if (/发布|部署|deploy/.test(normalized)) steps.push({ type: 'navigate', label: '打开系统发布并生成发布前检查清单', target: '/system-release', risk: 'medium', requiresConfirmation: false })
  if (/模型|评测|测试/.test(normalized)) steps.push({ type: 'navigate', label: '打开模型评测与测试中心', target: '/ai-ops?tab=evaluation', risk: 'low', requiresConfirmation: false })
  if (/日志|故障|排查/.test(normalized)) steps.push({ type: 'navigate', label: '打开日志分析中心', target: '/ai-ops?tab=logs', risk: 'low', requiresConfirmation: false })
  if (!steps.length) steps.push({ type: 'guide', label: '生成操作建议（不会执行系统命令或发布）', target: '', risk: 'low', requiresConfirmation: false })
  return { id: crypto.randomUUID(), prompt: request, steps, requiresConfirmation: steps.some(step => step.requiresConfirmation), createdAt: Date.now() }
}

function saveWorkflowPlan(userDataPath, plan) {
  const state = loadWorkflowState(userDataPath)
  state.history.unshift(plan)
  state.history = state.history.slice(0, MAX_WORKFLOWS)
  writeJsonFile(workflowStatePath(userDataPath), state)
  return plan
}

function readMcpSnapshot(userDataPath = defaultUserDataPath()) {
  const releaseHistory = readJsonFile(filePath(userDataPath, 'release-history.json'), [])
  const modelHistory = readJsonFile(filePath(userDataPath, 'model-test-history.json'), [])
  return {
    releases: Array.isArray(releaseHistory) ? releaseHistory.slice(0, 20).map(item => ({ id: item.id, profileName: redactSensitiveText(string(item.profileName, 120)), status: item.status, label: redactSensitiveText(string(item.label, 200)), finishedAt: item.finishedAt, message: redactSensitiveText(string(item.message, 500)) })) : [],
    modelHealth: Array.isArray(modelHistory) ? modelHistory.slice(0, 10).map(item => ({ id: item.id, label: item.label, finishedAt: item.finishedAt, summary: item.summary })) : [],
  }
}

module.exports = {
  defaultUserDataPath,
  redactSensitiveText,
  listProviders,
  saveProvider,
  deleteProvider,
  activateProvider,
  runtimeProvider,
  requestCompletion,
  loadEvaluationState,
  saveEvaluationCases,
  runEvaluation,
  analyzeLogText,
  loadLogState,
  saveLogAnalysis,
  loadKnowledgeState,
  saveKnowledgeDocument,
  deleteKnowledgeDocument,
  searchKnowledge,
  loadWorkflowState,
  planWorkflow,
  saveWorkflowPlan,
  readMcpSnapshot,
}
