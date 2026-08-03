/**
 * 大模型可用性测试
 *
 * 从 cc-switch 读取中转站配置，对指定模型发一条极短的真实请求，
 * 用 HTTP 状态和响应内容判断该模型是否真的可调用。
 */

const path = require('node:path')
const crypto = require('node:crypto')
const { ipcMain, net, clipboard, app } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { loadProviders } = require('../utils/ccswitch')
const { readJsonFile, writeJsonFile } = require('../utils/json-store')
const {
  completeMonitorRun,
  normalizeMonitorSettings,
  updateMonitorSettings,
} = require('../utils/model-monitor')
const {
  normalizeModelListSettings,
  isModelIncludedBySettings,
  isModelAllowedForProtocol,
} = require('../utils/model-list-settings')
const { loadReleaseHistory, getActiveReleaseProfile } = require('../utils/release-store')
const { getAutoBackupHealth, readAutoBackupSettings } = require('../utils/app-data-backup')
const { buildOpsDashboardData } = require('../utils/ops-dashboard')
const { addOpsEvent, recoverOpsEvent } = require('../utils/ops-automation')

const DEFAULT_TIMEOUT_MS = 30_000
/**
 * 探测用的用户消息。
 * 故意避开「你是谁 / 你是什么模型 / ping / 回复 ok」这类测活与身份问法，
 * 减少中转站风控或模型侧把请求当成探活而特殊处理/拒答。
 * 选一个短、日常、有明确交付物的微任务，便于快速拿到 completion。
 */
const PROBE_TEXT = '把「早上好」翻译成英文，只回译文。'
/** cc-switch 在 Claude Anthropic 路径总会保留的 Claude Code beta 标识。 */
const ANTHROPIC_CLAUDE_CODE_BETA = 'claude-code-20250219'
/** 开启 1M 上下文所需的 beta 标识。 */
const ANTHROPIC_1M_BETA = 'context-1m-2025-08-07'
const ONE_M_MODEL_MARKER_RE = /\s*\[1m\]\s*$/i

/**
 * 部分中转站（AnyRouter 等 one-api 系）会校验请求是否具备 Claude Code 特征：
 * 只带 model/max_tokens/messages 的极简请求会被网关直接拒成 5xx，
 * 而带 system 计费块、metadata、tools 的完整请求可以正常返回。
 * 这里保留一份「拟真」请求模板，仅在极简探测被网关拒绝后才补发一次。
 */
const CLAUDE_CODE_VERSION = '2.1.217.836'
const CLAUDE_CODE_USER_AGENT = `claude-cli/${CLAUDE_CODE_VERSION.split('.').slice(0, 3).join('.')} (external, cli)`
const CLAUDE_CODE_BILLING_SYSTEM = `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}; cc_entrypoint=cli;`
const CLAUDE_CODE_IDENTITY_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude."
const CLAUDE_CODE_PROBE_TOOL = {
  name: 'Bash',
  description: 'Executes a bash command and returns its output.',
  input_schema: {
    type: 'object',
    properties: { command: { type: 'string', description: 'The command to execute' } },
    required: ['command'],
  },
}

/** 拟真请求里的 device_id / session_id 只需稳定且不可回溯，进程内生成一次即可。 */
const CLAUDE_CODE_CLIENT_IDS = (() => {
  const { randomUUID, randomBytes } = require('node:crypto')
  return { deviceId: randomBytes(32).toString('hex'), sessionId: randomUUID() }
})()

/**
 * cc-switch 的 [1M] 只用于本地选择 100 万上下文能力。
 * 发往上游时必须去掉标识，并改用 Anthropic beta header。
 */
function splitOneMModelMarker(value) {
  const raw = String(value || '').trim()
  const beta1m = ONE_M_MODEL_MARKER_RE.test(raw)
  return {
    model: (beta1m ? raw.replace(ONE_M_MODEL_MARKER_RE, '') : raw).trim(),
    beta1m,
  }
}

function mergeAnthropicBetaHeaders(...values) {
  const betas = new Set()
  for (const value of values) {
    for (const beta of String(value || '').split(',')) {
      const normalized = beta.trim()
      if (normalized) betas.add(normalized)
    }
  }
  return [...betas].join(',')
}

/** 缓存最近一次读取的中转站配置，测试时用它取真实 apiKey（不下发到渲染进程） */
let providerCache = new Map()
/** 每次手动批量测试共用一个控制器，以便“停止”立即中止在途网络请求。 */
const modelTestRuns = new Map()

function createAbortError() {
  const error = new Error('Request aborted')
  error.name = 'AbortError'
  return error
}

function cancelledModelResult() {
  return { ok: false, status: 'cancelled', message: '已停止' }
}

function stripTrailingSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '')
}

/** baseUrl 可能已经带 /v1，也可能没有，这里统一拼出目标路径 */
function joinApiPath(baseUrl, suffix) {
  const base = stripTrailingSlash(baseUrl)
  if (/\/v1$/.test(base)) return `${base}/${suffix}`
  return `${base}/v1/${suffix}`
}

/** 部分中转站故障时返回的是 HTML 错误页，直接展示会刷屏，这里抽出纯文本 */
function stripHtml(text) {
  return String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractErrorMessage(status, data) {
  if (data && typeof data === 'object') {
    if (typeof data.error === 'string' && data.error) return data.error
    if (data.error?.message) return String(data.error.message)
    if (data.error?.Message) return String(data.error.Message)
    if (data.message) return String(data.message)
    // 阿里云函数计算等网关会返回 PascalCase 响应，例如：
    // { RequestId, Code: 'AccessDenied', Message: 'Current user is in debt.' }。
    // 保留网关给出的具体原因，不能退化成无上下文的「HTTP 403」。
    if (data.Message) return String(data.Message)
    if (Array.isArray(data.error) && data.error[0]?.message) return String(data.error[0].message)
    if (Array.isArray(data.errors) && data.errors[0]?.message) return String(data.errors[0].message)
  }

  if (typeof data === 'string' && data.trim()) {
    const looksLikeHtml = /^\s*(<!doctype|<html|<\?xml)/i.test(data)
    const text = looksLikeHtml ? stripHtml(data) : data.trim()
    if (text) return text.slice(0, 200)
  }

  return `HTTP ${status}`
}

/** 常见网络错误码的中文说明 */
const NETWORK_ERROR_HINTS = {
  ENOTFOUND: '域名无法解析，中转站可能已下线',
  EAI_AGAIN: 'DNS 解析失败，检查网络或 DNS 设置',
  ECONNREFUSED: '连接被拒绝',
  ECONNRESET: '连接被重置，可能被网络拦截',
  ETIMEDOUT: '连接超时',
  CERT_HAS_EXPIRED: 'HTTPS 证书已过期',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'HTTPS 证书校验失败',
  DEPTH_ZERO_SELF_SIGNED_CERT: '使用了自签名证书',
}

/**
 * fetch 抛出的错误统一是 `fetch failed`，真正原因藏在 error.cause 里，
 * 不挖出来的话界面上根本看不出是域名挂了还是被墙了。
 */
function describeNetworkError(error) {
  const cause = error?.cause
  const code = cause?.code || error?.code || ''
  const hint = NETWORK_ERROR_HINTS[code]

  if (hint) return `${hint}（${code}）`
  if (cause?.message) return `网络错误：${cause.message}`
  return `网络错误：${error?.message || '未知'}`
}

async function readBody(response) {
  const text = await response.text()
  if (!text) return ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** 发起一次带超时的请求，返回 {status, data} 或抛出网络错误 */
async function requestOnce(url, options, timeoutMs, externalSignal) {
  const controller = new AbortController()
  const abortFromRun = () => controller.abort()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (externalSignal?.aborted) controller.abort()
  else externalSignal?.addEventListener('abort', abortFromRun, { once: true })
  try {
    // Electron 的 Chromium 网络栈会自动使用操作系统代理；而 Node 的 fetch 不会。
    // 许多 cc-switch 中转站依赖系统代理才能访问，因此主进程优先使用 net.fetch。
    const request = typeof net?.fetch === 'function' ? net.fetch.bind(net) : fetch
    const response = await request(url, { ...options, signal: controller.signal })
    const data = await readBody(response)
    return { status: response.status, ok: response.ok, data }
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', abortFromRun)
  }
}

const RETRY_BACKOFF_MS = 2_000

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(createAbortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * 部分中转站（AnyRouter 等）对并发探测限流，会返回 429。
 * 这种失败与模型本身无关，退避一次再试，避免把限流误报成模型不可用。
 */
async function requestWithRetry(url, options, timeoutMs, externalSignal) {
  const first = await requestOnce(url, options, timeoutMs, externalSignal)
  if (first.status !== 429) return first

  await delay(RETRY_BACKOFF_MS, externalSignal)
  return requestOnce(url, options, timeoutMs, externalSignal)
}

/**
 * 5xx 且响应体没有具体原因，通常是中转站网关判定「不像 Claude Code 客户端」后的兜底错误。
 * 这种情况值得改用拟真请求再试一次。
 */
function shouldRetryAsClientLike(result) {
  return result.status >= 500 || result.status === 403
}

/** gatewayRejected 只用于串联两级探测，不下发到渲染进程。 */
function stripInternalFields(result) {
  const { gatewayRejected: _gatewayRejected, ...rest } = result
  return rest
}

/** Anthropic 协议探测 */
function applyCustomUserAgent(provider, headers) {
  const userAgent = String(provider.customUserAgent || '').trim()
  return userAgent ? { ...headers, 'user-agent': userAgent } : headers
}

/** 与 cc-switch Claude adapter 一致：凭据只写入一个认证头。 */
function buildAnthropicAuthHeaders(provider) {
  const apiKey = String(provider.apiKey || '').trim()
  return provider.anthropicAuthType === 'bearer'
    ? { authorization: `Bearer ${apiKey}` }
    : { 'x-api-key': apiKey }
}

function buildAnthropicProbe(provider, model, baseUrl, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...buildAnthropicAuthHeaders(provider),
    'anthropic-version': '2023-06-01',
  }
  // cc-switch 在 Claude -> Anthropic 路径会重建 anthropic-beta，确保总带
  // claude-code-20250219；[1M] 仅是客户端本地标识，发往上游时去掉模型后缀，
  // 并额外附加 context-1m-2025-08-07。
  const beta = mergeAnthropicBetaHeaders(
    ANTHROPIC_CLAUDE_CODE_BETA,
    provider.anthropicBeta,
    options.anthropicBeta,
    options.beta1m ? ANTHROPIC_1M_BETA : '',
  )
  if (beta) headers['anthropic-beta'] = beta

  if (!options.clientLike) {
    return {
      url: joinApiPath(baseUrl, 'messages'),
      options: {
        method: 'POST',
        headers: applyCustomUserAgent(provider, headers),
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: PROBE_TEXT }],
        }),
      },
    }
  }

  // 拟真变体：补齐中转站用于识别 Claude Code 的请求特征。
  // 实测缺少 system 计费块或 metadata 时，AnyRouter 会在网关层直接拒成 503。
  const clientHeaders = {
    ...headers,
    accept: 'application/json',
    'x-app': 'cli',
    'anthropic-dangerous-direct-browser-access': 'true',
  }
  return {
    url: `${joinApiPath(baseUrl, 'messages')}?beta=true`,
    options: {
      method: 'POST',
      // 中转站没有指定专属 UA 时，用 Claude Code 官方 CLI 的 UA。
      headers: String(provider.customUserAgent || '').trim()
        ? applyCustomUserAgent(provider, clientHeaders)
        : { ...clientHeaders, 'user-agent': CLAUDE_CODE_USER_AGENT },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: [
          { type: 'text', text: CLAUDE_CODE_BILLING_SYSTEM },
          { type: 'text', text: CLAUDE_CODE_IDENTITY_SYSTEM },
        ],
        metadata: {
          user_id: JSON.stringify({
            device_id: CLAUDE_CODE_CLIENT_IDS.deviceId,
            account_uuid: '',
            session_id: CLAUDE_CODE_CLIENT_IDS.sessionId,
          }),
        },
        tools: [CLAUDE_CODE_PROBE_TOOL],
        messages: [{ role: 'user', content: [{ type: 'text', text: PROBE_TEXT }] }],
      }),
    },
  }
}

/** OpenAI Chat Completions 协议探测 */
function buildOpenAIChatProbe(provider, model, baseUrl) {
  return {
    url: joinApiPath(baseUrl, 'chat/completions'),
    options: {
      method: 'POST',
      headers: applyCustomUserAgent(provider, {
        'content-type': 'application/json',
        'authorization': `Bearer ${provider.apiKey}`,
      }),
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: PROBE_TEXT }],
      }),
    },
  }
}

/** OpenAI Responses 协议探测 */
function buildOpenAIResponsesProbe(provider, model, baseUrl) {
  return {
    url: joinApiPath(baseUrl, 'responses'),
    options: {
      method: 'POST',
      headers: applyCustomUserAgent(provider, {
        'content-type': 'application/json',
        'authorization': `Bearer ${provider.apiKey}`,
      }),
      body: JSON.stringify({
        model,
        max_output_tokens: 16,
        input: PROBE_TEXT,
        store: false,
      }),
    },
  }
}

/** Gemini 协议探测 */
function buildGeminiProbe(provider, model, baseUrl) {
  const base = stripTrailingSlash(baseUrl) || 'https://generativelanguage.googleapis.com'
  const root = /\/v1(beta)?$/.test(base) ? base : `${base}/v1beta`
  return {
    url: `${root}/models/${encodeURIComponent(model)}:generateContent`,
    options: {
      method: 'POST',
      headers: applyCustomUserAgent(provider, {
        'content-type': 'application/json',
        'x-goog-api-key': provider.apiKey,
      }),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROBE_TEXT }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    },
  }
}

/**
 * 按协议构造探测请求列表。
 * OpenAI 协议下 responses / chat 两种接口第三方中转站支持情况不一，
 * 所以按 wireApi 排优先级，主接口返回 404/405 时自动退回另一种。
 */
function buildProbes(provider, model, baseUrl, options = {}) {
  if (provider.protocol === 'anthropic') {
    // 极简请求成本最低，先发它；被网关按「非 Claude Code 客户端」拒掉时，
    // 再补一次拟真请求（见 shouldRetryAsClientLike）。
    return [
      { name: 'messages', ...buildAnthropicProbe(provider, model, baseUrl, options) },
      {
        name: 'messages · 拟真',
        clientLike: true,
        ...buildAnthropicProbe(provider, model, baseUrl, { ...options, clientLike: true }),
      },
    ]
  }
  if (provider.protocol === 'gemini') {
    return [{ name: 'generateContent', ...buildGeminiProbe(provider, model, baseUrl) }]
  }
  if (provider.protocol === 'openai') {
    const responses = { name: 'responses', ...buildOpenAIResponsesProbe(provider, model, baseUrl) }
    const chat = { name: 'chat/completions', ...buildOpenAIChatProbe(provider, model, baseUrl) }
    return provider.wireApi === 'responses' ? [responses, chat] : [chat, responses]
  }
  return []
}

const AGENT_ROUTER_CANONICAL_BASE_URL = 'https://co.agentrouter.org'

/**
 * AgentRouter 已迁移到 co.agentrouter.org。旧 agentrouter.org 会拒绝
 * /v1/models 的普通 API 请求，导致页面只能退回 cc-switch 的历史模型。
 * 这里仅在测试/取模型时规范化旧地址，不修改用户的 cc-switch 配置。
 */
function normalizeProviderBaseUrl(provider, baseUrl) {
  const normalized = stripTrailingSlash(baseUrl)
  if (!normalized || !isAgentRouterProvider(provider)) return normalized
  try {
    const url = new URL(normalized)
    if (/^(www\.)?agentrouter\.org$/i.test(url.hostname)) {
      return AGENT_ROUTER_CANONICAL_BASE_URL
    }
  } catch {
    // 无效地址留给后续请求展示原始网络错误。
  }
  return normalized
}

/** 按 cc-switch 的主线路和备用线路顺序生成候选地址。 */
function providerBaseUrls(provider, overrideBaseUrl) {
  return [...new Set(
    [overrideBaseUrl, provider.baseUrl, ...(Array.isArray(provider.endpoints) ? provider.endpoints : [])]
      .map((baseUrl) => normalizeProviderBaseUrl(provider, baseUrl))
      .filter(Boolean),
  )]
}

function formatEndpoint(probeName, baseUrl) {
  return `${probeName} · ${baseUrl}`
}

/** 这些失败通常说明当前线路不可用，值得切换 cc-switch 的备用线路。 */
function shouldTryNextEndpoint(result) {
  if (result.status === 'network' || result.status === 'timeout') return true
  // 网关拒绝轻量探测是中转站的统一策略，换线路结果一样。
  if (result.status === 'gateway') return false
  return result.httpStatus === 404 || result.httpStatus === 405 || result.httpStatus >= 500
}

function listRequestFor(provider, baseUrl) {
  if (provider.protocol === 'gemini') {
    const base = stripTrailingSlash(baseUrl) || 'https://generativelanguage.googleapis.com'
    const root = /\/v1(beta)?$/.test(base) ? base : `${base}/v1beta`
    return {
      url: `${root}/models`,
      options: {
        method: 'GET',
        headers: applyCustomUserAgent(provider, {
          'x-goog-api-key': provider.apiKey,
          'content-type': 'application/json',
        }),
      },
    }
  }

  const headers = provider.protocol === 'anthropic'
    ? {
        ...buildAnthropicAuthHeaders(provider),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      }
    : {
        'authorization': `Bearer ${provider.apiKey}`,
        'content-type': 'application/json',
      }

  return {
    url: joinApiPath(baseUrl, 'models'),
    options: { method: 'GET', headers: applyCustomUserAgent(provider, headers) },
  }
}

/**
 * 模型测试只展示当前关注的模型，避免 /models 返回一大批并未配置或不关心的模型。
 * 比较时去掉大小写、连字符、斜杠和点号，以兼容不同中转站的命名风格：
 * `glm-5.2`、`GLM5.2`、`moonshotai/kimi-k3-free` 等。
 */
function compactModelName(model) {
  return String(model || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * 中转站 / HuggingFace 风格的模型 id 常带组织前缀：
 * `deepseek-ai/deepseek-v4-flash`、`z-ai/glm-5.2`。
 * 白名单和家族/协议判断应以最后一段 bare id 为准；
 * 发往上游时仍使用完整 model id。
 */
function bareModelName(model) {
  const raw = String(model || '').trim()
  if (!raw) return ''
  const slash = raw.lastIndexOf('/')
  return (slash >= 0 ? raw.slice(slash + 1) : raw).trim()
}

function compactBareModelName(model) {
  return compactModelName(bareModelName(model))
}

function providerIdentityText(provider) {
  return [
    provider?.name,
    provider?.baseUrl,
    ...(Array.isArray(provider?.endpoints) ? provider.endpoints : []),
  ].join(' ')
}

function isZenMuxProvider(provider) {
  return /zenmux/i.test(providerIdentityText(provider))
}

function isAnyRouterProvider(provider) {
  return /anyrouter/i.test(providerIdentityText(provider))
}

function isAgentRouterProvider(provider) {
  return /agentrouter/i.test(providerIdentityText(provider))
}

function isMofasProvider(provider) {
  return /mofas\.one|魔方/i.test(providerIdentityText(provider))
}

function isHuanchengProvider(provider) {
  return /api\.(hcnsec|iamhc)\.cn|幻城/i.test(providerIdentityText(provider))
}

/**
 * 这些中转站的 cc-switch 配置通常只是客户端本地默认/别名，
 * 模型测试页必须以官方 /models 返回为准，避免显示已下线或别名模型。
 */
function usesOfficialModelsOnly(provider) {
  return isZenMuxProvider(provider)
    || isAnyRouterProvider(provider)
    || isAgentRouterProvider(provider)
    || isMofasProvider(provider)
    || isHuanchengProvider(provider)
}

/**
 * 保留端点协议兼容性，再按中转站规则和用户保存的规则筛选模型。
 * ZenMux 的模型测试只允许测试其模型 ID 明确以 `-free` 结尾的免费模型；
 * 这个内置限制优先于用户的包含规则，避免付费模型进入测试队列。
 */
function filterProviderModels(provider, models, modelListSettings = {}) {
  const list = Array.isArray(models) ? models : []
  return list.filter((item) => {
    const rawModel = typeof item === 'string' ? item : item?.model || item?.id || item?.name
    const model = splitOneMModelMarker(rawModel).model
    if (isZenMuxProvider(provider) && !/-free$/i.test(model)) return false
    // 一个模型仍必须能通过当前端点协议调用，避免把跨生态模型放进测试队列。
    if (!isModelAllowedForProtocol(provider.protocol, compactBareModelName(model))) return false
    return isModelIncludedBySettings(model, modelListSettings)
  })
}

function configuredModelOptions(provider, modelListSettings) {
  const models = filterProviderModels(provider, provider.models, modelListSettings)
  return models
    .map((item) => {
      const parsed = splitOneMModelMarker(
        typeof item === 'string' ? item : item?.model || item?.id || item?.name,
      )
      const model = parsed.model
      if (!model) return null
      const beta1m = Boolean(item?.beta1m) || parsed.beta1m
      const rawId = String(item?.key || item?.id || '').trim()
      const id = beta1m ? `${model}|1m` : (rawId.replace(/\|1m$/i, '') || model)
      const labelBase = String(item?.label || model)
        .replace(/\s*\[1m\]\s*$/i, '')
        .replace(/\s*·\s*1M\s*$/i, '')
        .trim()
      return {
        id,
        model,
        label: labelBase + (beta1m ? ' · 1M' : ''),
        beta1m,
        source: 'cc-switch',
      }
    })
    .filter(Boolean)
}

/**
 * 合并 cc-switch 配置模型与远端 /models。同一个上游模型只保留一行（按基础模型名去重），
 * [1M] 只是同一模型的能力标记：任一来源标了 [1M]，合并后的这一行即视为 1M。
 * configured 先入库，故其模型名/标签优先；remote 仅用于补充新模型或叠加 1M 标记。
 */
function mergeModelOptions(configured, remoteModels) {
  const merged = new Map() // key: 基础模型名（compact）
  const upsert = (raw, defaultSource) => {
    const item = typeof raw === 'string' ? { id: raw } : (raw || {})
    const parsed = splitOneMModelMarker(item.model || item.id || item.name || '')
    const model = parsed.model
    if (!model) return
    const beta1m = Boolean(item.beta1m) || parsed.beta1m
    const baseKey = compactModelName(model)
    const existing = merged.get(baseKey)
    if (existing) {
      // 已有同一模型：仅在需要时把它升级为 1M，不新增行。
      if (beta1m && !existing.beta1m) {
        existing.beta1m = true
        existing.id = `${existing.model}|1m`
        existing.label = existing.label.replace(/\s*·\s*1M\s*$/i, '').trim() + ' · 1M'
      }
      return
    }
    const label = String(item.label || item.display_name || item.displayName || item.name || model)
      .replace(/\s*\[1m\]\s*$/i, '')
      .replace(/\s*·\s*1M\s*$/i, '')
      .trim()
    merged.set(baseKey, {
      id: beta1m ? `${model}|1m` : String(item.id || model).replace(/\|1m$/i, '').trim(),
      model,
      label: label + (beta1m ? ' · 1M' : ''),
      beta1m,
      source: item.source || defaultSource,
    })
  }
  for (const item of configured) upsert(item, 'cc-switch')
  for (const raw of remoteModels) upsert(raw, 'remote')
  return [...merged.values()]
}

/**
 * officialModelsOnly 站点（如 AnyRouter）只用官方 /models，模型名以官方为准；
 * 但 cc-switch 的 [1M] 是可靠的能力标记。这里把官方列表中被 cc-switch 标了 [1M]
 * 的模型「就地」升级为 1M（同一个上游模型只占一行，不新增变体行），
 * 使其测试时带 context-1m beta 头。仅 Anthropic 协议生效。
 */
function applyCcSwitchOneMFlags(provider, models) {
  const oneMModels = Array.isArray(provider.oneMModels) ? provider.oneMModels : []
  if (provider.protocol !== 'anthropic' || oneMModels.length === 0) return models

  const oneMBase = new Set(
    oneMModels
      .map((item) => compactModelName(splitOneMModelMarker(item?.model || item?.id || item?.name || '').model))
      .filter(Boolean),
  )
  return models.map((item) => {
    if (item.beta1m || !oneMBase.has(compactModelName(item.model))) return item
    return {
      ...item,
      beta1m: true,
      id: `${item.model}|1m`,
      label: String(item.label || item.model).replace(/\s*·\s*1M\s*$/i, '').trim() + ' · 1M',
    }
  })
}
function extractReplyPreview(protocol, data) {
  try {
    if (protocol === 'anthropic') {
      const block = data?.content?.find(item => item?.type === 'text')
      return String(block?.text || '').trim()
    }
    if (protocol === 'gemini') {
      const parts = data?.candidates?.[0]?.content?.parts || []
      return String(parts.map(p => p?.text || '').join('')).trim()
    }
    // openai：chat 和 responses 两种结构
    if (data?.choices?.[0]?.message?.content) {
      return String(data.choices[0].message.content).trim()
    }
    if (data?.output_text) return String(data.output_text).trim()
    if (Array.isArray(data?.output)) {
      const text = data.output
        .flatMap(item => item?.content || [])
        .map(item => item?.text || '')
        .join('')
      return String(text).trim()
    }
  } catch {
    // 摘要失败不影响测试结论
  }
  return ''
}

/**
 * 测试单个模型
 * @param {{providerId: string, appType: string, model: string, baseUrl?: string, timeoutMs?: number}} payload
 */
async function testModel(payload = {}, { signal } = {}) {
  if (signal?.aborted) return cancelledModelResult()
  const providerId = String(payload.providerId || '')
  const appType = String(payload.appType || '')
  const parsedModel = splitOneMModelMarker(payload.model)
  const model = parsedModel.model
  const timeoutMs = Number(payload.timeoutMs) > 0 ? Number(payload.timeoutMs) : DEFAULT_TIMEOUT_MS

  const provider = providerCache.get(`${providerId}::${appType}`)
  if (!provider) {
    return { ok: false, status: 'error', message: '中转站配置已失效，请重新加载列表' }
  }
  if (!model) {
    return { ok: false, status: 'error', message: '未指定模型' }
  }
  if (!provider.apiKey) {
    return { ok: false, status: 'error', message: '该中转站未配置 apiKey' }
  }

  const baseUrls = providerBaseUrls(provider, payload.baseUrl)
  if (baseUrls.length === 0) {
    return { ok: false, status: 'error', message: '该中转站未配置 baseUrl' }
  }

  const startedAt = Date.now()
  let lastFailure = null
  // 不依赖渲染层是否正确传 beta1m：模型名本身带 [1M] 时也必须启用。
  const beta1m = Boolean(payload.beta1m) || parsedModel.beta1m

  for (const baseUrl of baseUrls) {
    const probes = buildProbes(provider, model, baseUrl, {
      beta1m,
      anthropicBeta: provider.anthropicBeta,
    })
    if (probes.length === 0) {
      return { ok: false, status: 'error', message: `暂不支持的协议：${provider.protocol}` }
    }

    for (const probe of probes) {
      // 拟真请求只在极简探测被网关拒绝后才发，避免给正常中转站多发一次真实请求。
      if (probe.clientLike && !(lastFailure && lastFailure.gatewayRejected)) continue

      let result
      try {
        result = await requestWithRetry(probe.url, probe.options, timeoutMs, signal)
      } catch (error) {
        if (signal?.aborted) return cancelledModelResult()
        const aborted = error?.name === 'AbortError'
        lastFailure = {
          ok: false,
          status: aborted ? 'timeout' : 'network',
          httpStatus: 0,
          endpoint: formatEndpoint(probe.name, baseUrl),
          message: aborted ? `请求超时（${timeoutMs / 1000}s）` : describeNetworkError(error),
          durationMs: Date.now() - startedAt,
        }
        // 同一线路切换 API 格式没有意义；尝试 cc-switch 的备用线路。
        break
      }

      if (result.ok) {
        if (signal?.aborted) return cancelledModelResult()
        return {
          ok: true,
          status: 'ok',
          httpStatus: result.status,
          endpoint: formatEndpoint(probe.name, baseUrl),
          message: '可用',
          reply: extractReplyPreview(provider.protocol, result.data),
          durationMs: Date.now() - startedAt,
        }
      }

      // 极简探测被网关拒绝时记下标记，让后面的拟真请求有机会执行。
      const gatewayRejected = provider.protocol === 'anthropic'
        && !probe.clientLike
        && shouldRetryAsClientLike(result)

      lastFailure = {
        ok: false,
        // 两级探测都被网关拒绝：说明该中转站要求完整 Claude Code 请求特征，
        // 轻量探测无法验证，不能笼统判成模型不可用。
        status: probe.clientLike && shouldRetryAsClientLike(result)
          ? 'gateway'
          : result.status === 401 || result.status === 403 ? 'auth' : 'error',
        httpStatus: result.status,
        endpoint: formatEndpoint(probe.name, baseUrl),
        message: probe.clientLike && shouldRetryAsClientLike(result)
          ? `该中转站要求完整 Claude Code 请求特征，轻量探测无法验证（${extractErrorMessage(result.status, result.data)}）`
          : extractErrorMessage(result.status, result.data),
        durationMs: Date.now() - startedAt,
        gatewayRejected,
      }

      // 网关拒绝时继续走拟真请求；否则只有「接口不存在」值得换另一种 API 格式。
      if (gatewayRejected) continue
      if (result.status !== 404 && result.status !== 405) break
    }

    // 鉴权、限流和模型参数错误与线路无关，避免对备用线路重复发真实请求。
    if (lastFailure && !shouldTryNextEndpoint(lastFailure)) return stripInternalFields(lastFailure)
  }

  return lastFailure
    ? stripInternalFields(lastFailure)
    : { ok: false, status: 'error', message: '未知错误' }
}

/** 解析 /models 接口返回的模型列表，同时保留模型元数据。 */
function normalizeModelList(data) {
  const rawModels = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data)
        ? data
        : []

  const models = new Map()
  for (const item of rawModels) {
    const raw = typeof item === 'string' ? { id: item } : item
    const id = String(raw?.id || raw?.model || raw?.name || '').trim()
    if (!id || models.has(id)) continue

    models.set(id, {
      ...raw,
      id,
      name: String(raw?.name || raw?.display_name || raw?.displayName || id).trim(),
    })
  }

  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** 获取中转站完整模型列表 */
async function listProviderModels(payload = {}) {
  const providerId = String(payload.providerId || '')
  const appType = String(payload.appType || '')
  const timeoutMs = Number(payload.timeoutMs) > 0 ? Number(payload.timeoutMs) : DEFAULT_TIMEOUT_MS

  const provider = providerCache.get(`${providerId}::${appType}`)
  if (!provider) {
    return { ok: false, error: '中转站配置已失效，请重新加载列表' }
  }
  if (!provider.apiKey) {
    return { ok: false, error: '该中转站未配置 apiKey' }
  }

  const baseUrls = providerBaseUrls(provider, payload.baseUrl)
  if (baseUrls.length === 0) {
    return { ok: false, error: '该中转站未配置 baseUrl' }
  }

  const modelListSettings = loadModelListSettings()
  const officialModelsOnly = usesOfficialModelsOnly(provider)
  const configured = officialModelsOnly ? [] : configuredModelOptions(provider, modelListSettings)
  const startedAt = Date.now()
  let lastFailure = null

  for (const baseUrl of baseUrls) {
    const request = listRequestFor(provider, baseUrl)
    try {
      const result = await requestOnce(request.url, request.options, timeoutMs)
      if (result.ok) {
        const remoteModels = filterProviderModels(provider, normalizeModelList(result.data), modelListSettings)
        const models = mergeModelOptions(configured, remoteModels)

        // 部分中转站必须以官方 /models 为唯一来源，绝不合并 cc-switch 的旧配置；
        // 这样官方已下线或仅用于客户端本地别名的模型不会继续显示或进入测试队列。
        if (officialModelsOnly) {
          // 官方 /models 不含 [1M] 标记；按 cc-switch 就地把对应模型升级为 1M（不新增行）。
          const officialModels = applyCcSwitchOneMFlags(provider, models)
          const migratedAgentRouter = isAgentRouterProvider(provider)
            && /^(https?:\/\/)?(www\.)?agentrouter\.org\/?$/i.test(stripTrailingSlash(provider.baseUrl))
          return {
            ok: true,
            models: officialModels,
            source: 'remote',
            endpoint: baseUrl,
            warning: officialModels.length === 0
              ? '官方模型列表中暂无符合当前筛选规则的模型'
              : migratedAgentRouter
                ? '已使用 AgentRouter 当前官方地址 co.agentrouter.org 获取模型；建议同步更新 cc-switch 的 baseUrl'
                : '',
            durationMs: Date.now() - startedAt,
          }
        }

        if (models.length > 0) {
          return {
            ok: true,
            models,
            source: remoteModels.length > 0 ? 'remote' : 'cc-switch',
            endpoint: baseUrl,
            warning: remoteModels.length === 0 && configured.length > 0
              ? '接口未返回模型列表，已展示 cc-switch 已配置的模型'
              : '',
            durationMs: Date.now() - startedAt,
          }
        }
        lastFailure = {
          error: '接口返回列表中没有符合当前筛选规则的模型，且 cc-switch 中未配置可用模型',
          httpStatus: result.status,
        }
      } else {
        lastFailure = {
          error: extractErrorMessage(result.status, result.data),
          httpStatus: result.status,
        }
      }
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      lastFailure = { error: aborted ? '获取模型列表超时' : describeNetworkError(error), httpStatus: 0 }
    }

    // 仅在当前线路本身不可达或接口不存在时切备用线路。
    if (lastFailure && !shouldTryNextEndpoint({
      status: lastFailure.httpStatus === 0 && /超时/.test(lastFailure.error) ? 'timeout' : 'network',
      httpStatus: lastFailure.httpStatus,
    })) {
      break
    }
  }

  // 并非所有 Anthropic/兼容中转站实现 /models；普通站点仍可直接测试 cc-switch 配置的模型。
  // officialModelsOnly 站点始终使用官方列表，拉取失败时不回退到可能已过期的本地配置。
  if (!officialModelsOnly && configured.length > 0) {
    return {
      ok: true,
      models: configured,
      source: 'cc-switch',
      warning: `无法从 /models 获取列表，已展示 cc-switch 已配置的模型：${lastFailure?.error || '未知错误'}`,
      durationMs: Date.now() - startedAt,
    }
  }

  return {
    ok: false,
    error: lastFailure?.error || '获取模型列表失败',
    httpStatus: lastFailure?.httpStatus || 0,
    durationMs: Date.now() - startedAt,
  }
}


const MAX_MODEL_TEST_HISTORY = 200
let monitorTimer = null
let inspectionRunning = false

function modelHistoryPath() {
  return path.join(app.getPath('userData'), 'model-test-history.json')
}

function monitorSettingsPath() {
  return path.join(app.getPath('userData'), 'model-monitor-settings.json')
}

function modelListSettingsPath() {
  return path.join(app.getPath('userData'), 'model-list-settings.json')
}

function loadModelListSettings() {
  return normalizeModelListSettings(readJsonFile(modelListSettingsPath(), {}))
}

function saveModelListSettings(settings = {}) {
  const next = normalizeModelListSettings(settings)
  if (!writeJsonFile(modelListSettingsPath(), next)) throw new Error('保存模型筛选配置失败')
  return next
}

function loadModelTestHistory() {
  const value = readJsonFile(modelHistoryPath(), [])
  return Array.isArray(value) ? value.slice(0, MAX_MODEL_TEST_HISTORY) : []
}

function saveModelTestSnapshot(snapshot = {}) {
  const results = Array.isArray(snapshot.results) ? snapshot.results.slice(0, 1000).map(item => ({
    providerId: String(item.providerId || ''),
    providerName: String(item.providerName || ''),
    appType: String(item.appType || ''),
    model: String(item.model || ''),
    status: String(item.status || 'error'),
    durationMs: Number(item.durationMs || 0),
    httpStatus: Number(item.httpStatus || 0),
    message: String(item.message || '').slice(0, 500),
  })) : []
  const summary = results.reduce((acc, item) => {
    acc.total += 1
    if (item.status === 'ok') acc.ok += 1
    else if (item.status === 'gateway') acc.gateway += 1
    else acc.failed += 1
    acc.durationMs += item.durationMs
    return acc
  }, { total: 0, ok: 0, failed: 0, gateway: 0, durationMs: 0 })
  const entry = {
    id: String(snapshot.id || crypto.randomUUID()),
    source: snapshot.source === 'scheduled' ? 'scheduled' : 'manual',
    label: String(snapshot.label || (snapshot.source === 'scheduled' ? '定时巡检' : '手动测试')).slice(0, 100),
    startedAt: Number(snapshot.startedAt) || Date.now(),
    finishedAt: Number(snapshot.finishedAt) || Date.now(),
    summary,
    results,
  }
  const history = loadModelTestHistory()
  history.unshift(entry)
  if (!writeJsonFile(modelHistoryPath(), history.slice(0, MAX_MODEL_TEST_HISTORY))) {
    throw new Error('保存模型测试历史失败')
  }
  return entry
}

function loadMonitorSettings() {
  return normalizeMonitorSettings(readJsonFile(monitorSettingsPath(), {}))
}

function saveMonitorSettings(settings = {}) {
  const next = updateMonitorSettings(loadMonitorSettings(), settings)
  if (!writeJsonFile(monitorSettingsPath(), next)) throw new Error('保存巡检设置失败')
  return loadMonitorSettings()
}

async function refreshProviderCache() {
  const result = await loadProviders()
  if (!result.ok) {
    providerCache = new Map()
    return { ok: false, message: result.message }
  }
  const modelListSettings = loadModelListSettings()
  const filteredProviders = result.providers
    .filter(provider => String(provider.apiKey || '').trim())
    .map((provider) => {
      const officialModelsOnly = usesOfficialModelsOnly(provider)
      const filtered = filterProviderModels(provider, provider.models, modelListSettings)
      return {
        ...provider,
        models: officialModelsOnly ? [] : filtered,
        officialModelsOnly,
        oneMModels: filtered.filter(item => item?.beta1m),
      }
    })
  providerCache = new Map(filteredProviders.map(item => [`${item.id}::${item.appType}`, item]))
  return { ok: true, dbPath: result.dbPath, providers: filteredProviders }
}

function modelMonitorFingerprint(item = {}) {
  return `model-monitor:${String(item.providerId || '')}:${String(item.appType || '')}:${String(item.model || '')}`.slice(0, 240)
}

function recordModelInspectionEvents(snapshot, { desktopNotification = true } = {}) {
  const userDataPath = app.getPath('userData')
  for (const result of snapshot.results || []) {
    const fingerprint = modelMonitorFingerprint(result)
    const sourceId = `${result.providerId}:${result.appType}:${result.model}`
    const providerLabel = result.providerName || result.providerId || '未知 Provider'
    const modelLabel = result.model || '未知模型'
    const attributes = {
      providerId: result.providerId,
      providerName: result.providerName,
      appType: result.appType,
      model: result.model,
      snapshotId: snapshot.id,
      httpStatus: result.httpStatus,
      durationMs: result.durationMs,
      desktopNotification,
    }
    if (result.status === 'ok') {
      recoverOpsEvent(userDataPath, fingerprint, {
        message: `${providerLabel} · ${modelLabel} 已恢复可用`,
        relatedId: snapshot.id,
        recoveredAt: snapshot.finishedAt,
        attributes,
      })
      continue
    }
    addOpsEvent(userDataPath, {
      fingerprint,
      sourceType: 'model-monitor',
      sourceId,
      severity: result.status === 'gateway' ? 'warning' : 'critical',
      title: `模型巡检异常：${modelLabel}`,
      description: `${providerLabel} · ${result.message || (result.status === 'gateway' ? '无法验证' : '巡检失败')}`,
      relatedId: snapshot.id,
      occurredAt: snapshot.finishedAt,
      attributes,
    })
  }
  recoverOpsEvent(userDataPath, 'model-monitor:scheduled-runner', {
    message: '模型定时巡检任务已恢复执行',
    relatedId: snapshot.id,
    recoveredAt: snapshot.finishedAt,
    attributes: { desktopNotification },
  })
}

async function runScheduledInspection() {
  if (inspectionRunning) throw new Error('巡检任务正在执行')
  const settings = loadMonitorSettings()
  if (!settings.targets.length) throw new Error('尚未配置巡检目标')
  inspectionRunning = true
  const startedAt = Date.now()
  let completionRecorded = false
  try {
    const loaded = await refreshProviderCache()
    if (!loaded.ok) throw new Error(loaded.message || '读取中转配置失败')
    const results = []
    for (const target of settings.targets) {
      const result = await testModel(target)
      results.push({ ...target, status: result.ok ? 'ok' : result.status || 'error', ...result })
    }
    const snapshot = saveModelTestSnapshot({ source: 'scheduled', label: '定时巡检', startedAt, results })
    // 巡检期间用户可能已在首页关闭巡检或修改设置。完成时必须重新读取最新值，
    // 只回写本次运行时间，避免用任务启动时的旧设置把用户操作覆盖掉。
    const latestSettings = loadMonitorSettings()
    const nextSettings = completeMonitorRun(latestSettings)
    if (!writeJsonFile(monitorSettingsPath(), nextSettings)) throw new Error('更新巡检运行时间失败')
    completionRecorded = true
    try {
      recordModelInspectionEvents(snapshot, { desktopNotification: latestSettings.notifyOnFailure })
    } catch (eventError) {
      console.error('记录模型巡检事件失败:', eventError)
    }
    return snapshot
  } catch (error) {
    // 配置读取或巡检本身失败时也要推进 nextRunAt，否则定时器会每分钟重试，
    // 持续打满中转服务并刷屏日志。
    let failureDesktopNotification = true
    if (!completionRecorded) {
      try {
        const latestSettings = loadMonitorSettings()
        failureDesktopNotification = latestSettings.notifyOnFailure
        const nextSettings = completeMonitorRun(latestSettings)
        if (!writeJsonFile(monitorSettingsPath(), nextSettings)) console.error('更新巡检运行时间失败')
      } catch (recordError) {
        console.error('记录模型巡检失败状态失败:', recordError)
      }
    }
    try {
      addOpsEvent(app.getPath('userData'), {
        fingerprint: 'model-monitor:scheduled-runner',
        sourceType: 'model-monitor',
        sourceId: 'scheduled-runner',
        severity: 'critical',
        title: '模型定时巡检执行失败',
        description: String(error?.message || '未知错误').slice(0, 1000),
        occurredAt: Date.now(),
        attributes: { startedAt, desktopNotification: failureDesktopNotification },
      })
    } catch (eventError) {
      console.error('记录模型巡检失败事件失败:', eventError)
    }
    throw error
  } finally {
    inspectionRunning = false
  }
}

function startMonitorTimer() {
  if (monitorTimer) return
  monitorTimer = setInterval(() => {
    const settings = loadMonitorSettings()
    if (!settings.enabled || inspectionRunning || !settings.targets.length) return
    if (!settings.nextRunAt || settings.nextRunAt <= Date.now()) {
      runScheduledInspection().catch(error => console.error('模型定时巡检失败:', error))
    }
  }, 60_000)
  monitorTimer.unref?.()
}

function dashboardData() {
  const activeProfile = getActiveReleaseProfile()
  return buildOpsDashboardData({
    modelHistory: loadModelTestHistory(),
    // 首页发布指标必须与系统发布页一样，严格限定在当前活动环境。
    releaseHistory: loadReleaseHistory({ profileId: activeProfile?.id }),
    monitor: loadMonitorSettings(),
    backup: {
      health: getAutoBackupHealth(app.getPath('userData')),
      settings: readAutoBackupSettings(app.getPath('userData')),
    },
  })
}

function registerModelTestHandlers() {
  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_LIST_PROVIDERS, async () => {
    const result = await refreshProviderCache()
    if (!result.ok) return result
    const safeProviders = result.providers.map(({ apiKey: _apiKey, oneMModels: _oneMModels, ...rest }) => rest)
    return { ok: true, dbPath: result.dbPath, providers: safeProviders }
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_MODEL_LIST_SETTINGS_GET, async () => ({
    ok: true,
    settings: loadModelListSettings(),
  }))
  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_MODEL_LIST_SETTINGS_SAVE, async (_event, settings = {}) => {
    try { return { ok: true, settings: saveModelListSettings(settings) } }
    catch (error) { return { ok: false, error: error.message } }
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_RUN, async (_event, payload = {}) => {
    const runId = String(payload.runId || '').trim()
    let entry = null
    if (runId) {
      entry = modelTestRuns.get(runId)
      if (!entry) {
        entry = { controller: new AbortController(), activeCount: 0 }
        modelTestRuns.set(runId, entry)
      }
      entry.activeCount += 1
    }
    try {
      return await testModel(payload, { signal: entry?.controller.signal })
    } catch (error) {
      return { ok: false, status: 'error', message: error?.message || '测试失败' }
    } finally {
      if (entry) {
        entry.activeCount -= 1
        if (entry.activeCount <= 0) modelTestRuns.delete(runId)
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_CANCEL, async (_event, runId) => {
    const entry = modelTestRuns.get(String(runId || '').trim())
    entry?.controller.abort()
    return { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_LIST_MODELS, async (_event, payload) => {
    try {
      return await listProviderModels(payload)
    } catch (error) {
      return { ok: false, error: error?.message || '获取模型列表失败' }
    }
  })

  // apiKey 始终只保留在主进程缓存中。点击复制时由主进程写入剪贴板，
  // 不把完整密钥暴露给渲染进程。
  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_COPY_PROVIDER_VALUE, async (_event, payload = {}) => {
    const providerId = String(payload.providerId || '')
    const appType = String(payload.appType || '')
    const field = String(payload.field || '')
    const provider = providerCache.get(`${providerId}::${appType}`)
    if (!provider) return { ok: false, error: '中转站配置已失效，请重新加载列表' }

    const value = field === 'apiKey' ? provider.apiKey : field === 'baseUrl' ? provider.baseUrl : ''
    if (!value) return { ok: false, error: '没有可复制的内容' }

    try {
      clipboard.writeText(value)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error?.message || '复制失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_HISTORY_GET, async () => ({ ok: true, history: loadModelTestHistory() }))
  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_HISTORY_SAVE, async (_event, snapshot = {}) => {
    try { return { ok: true, entry: saveModelTestSnapshot(snapshot) } }
    catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_MONITOR_GET, async () => ({ ok: true, settings: loadMonitorSettings() }))
  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_MONITOR_SAVE, async (_event, settings = {}) => {
    try { return { ok: true, settings: saveMonitorSettings(settings) } }
    catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle(IPC_CHANNELS.MODEL_TEST_MONITOR_RUN, async () => {
    try { return { ok: true, entry: await runScheduledInspection() } }
    catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_DASHBOARD_GET, async () => {
    try { return { ok: true, data: dashboardData() } }
    catch (error) { return { ok: false, error: error.message } }
  })
  startMonitorTimer()

}

module.exports = {
  registerModelTestHandlers,
  __testables: {
    requestOnce,
    requestWithRetry,
    delay,
    testModel,
    cancelledModelResult,
    filterProviderModels,
  },
}
