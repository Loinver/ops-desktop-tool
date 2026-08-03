/** 模型测试页常量（与主进程约定对齐） */

// 部分中转站（AnyRouter 等）会对并发探测限流，把限流误报成模型不可用。
export const CONCURRENCY = 2

export const FAILED_STATUSES = ['error', 'auth', 'timeout', 'network']

export const RESULT_CACHE_STORAGE_KEY = 'ops-desktop:model-test-results:v2'
export const RESULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 列表与一键测试范围：选中的中转 entry key（id::appType）。null 表示未配置，默认展示并测全部。 */
export const SCOPE_STORAGE_KEY = 'ops-desktop:model-test-scope:v1'

// gateway 表示中转站拒绝轻量探测，既不算可用也不算失败，同样值得缓存。
export const CACHEABLE_RESULT_STATUSES = new Set(['ok', 'gateway', ...FAILED_STATUSES])

export const EMPTY_RESULT = { status: 'idle', message: '', durationMs: 0 }

export const STATUS_TEXT = {
  idle: '未测试',
  testing: '测试中',
  cancelled: '已停止',
  ok: '可用',
  auth: '鉴权失败',
  timeout: '超时',
  network: '网络错误',
  error: '不可用',
  gateway: '无法验证'
}

export const PROTOCOL_LABELS = {
  openai: 'OpenAI 协议',
  anthropic: 'Anthropic 协议',
  gemini: 'Gemini 协议'
}

export const FAMILY_ORDER = [
  'openai',
  'claude',
  'grok',
  'gemini',
  'deepseek',
  'glm',
  'kimi',
  'minimax',
  'agnes',
  'other'
]

export const FAMILY_LABELS = {
  openai: 'OpenAI',
  claude: 'Claude',
  grok: 'Grok',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  glm: 'GLM',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  agnes: 'Agnes',
  other: '其他'
}

export const COPY_FIELD_LABELS = { baseUrl: 'baseUrl', apiKey: 'apiKey' }
