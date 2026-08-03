/** 模型名 / 协议 / 结果展示的纯函数 */

import { FAMILY_LABELS, PROTOCOL_LABELS, STATUS_TEXT } from './constants.js'

/** 与主进程对齐：压平大小写与非字母数字字符后比较模型名。 */
export function compactModelName(model) {
  return String(model || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * 与主进程对齐：去掉 org/ 前缀后再做家族判断。
 * 例如 deepseek-ai/deepseek-v4-flash、z-ai/glm-5.2。
 */
export function bareModelName(model) {
  const raw = String(model || '').trim()
  if (!raw) return ''
  const slash = raw.lastIndexOf('/')
  return (slash >= 0 ? raw.slice(slash + 1) : raw).trim()
}

export function compactBareModelName(model) {
  return compactModelName(bareModelName(model))
}

/** 按模型名推断上游端点 / 模型家族，用于端点过滤。 */
export function modelFamily(modelName) {
  // bare id 优先：z-ai/glm-5.2 -> glm52，deepseek-ai/deepseek-v4-flash -> deepseekv4flash。
  // 完整 id 仅作兜底（兼容少数把家族名写在前缀里的命名）。
  const compact = compactBareModelName(modelName)
  const full = compactModelName(modelName)
  if (!compact && !full) return 'other'
  if (compact.startsWith('claude') || full.startsWith('claude')) return 'claude'
  if (compact.startsWith('gpt') || full.startsWith('gpt')) return 'openai'
  if (compact.startsWith('grok') || full.startsWith('grok')) return 'grok'
  if (compact.startsWith('gemini') || full.startsWith('gemini')) return 'gemini'
  if (compact.startsWith('deepseek') || full.includes('deepseek')) return 'deepseek'
  if (compact.startsWith('glm') || full.includes('glm')) return 'glm'
  if (
    compact.includes('kimi') ||
    compact.includes('kimmik') ||
    compact.includes('moonshot') ||
    full.includes('kimi') ||
    full.includes('kimmik') ||
    full.includes('moonshot')
  ) {
    return 'kimi'
  }
  if (compact.startsWith('minimax') || full.includes('minimax')) return 'minimax'
  if (compact.includes('agnes') || full.includes('agnes')) return 'agnes'
  return 'other'
}

export function familyLabel(family) {
  return FAMILY_LABELS[family] || family
}

export function providerKey(item) {
  return `${item.id}::${item.appType}`
}

export function rowKey(pKey, modelId) {
  return `${pKey}::${modelId}`
}

/**
 * /models 和 cc-switch 配置返回的模型项格式并不完全一致。
 * 渲染层统一成字符串模型 id，避免把整个对象通过 IPC 发送成 "[object Object]"。
 */
export function normalizeModelOption(raw) {
  const item = typeof raw === 'string' ? { model: raw } : raw || {}
  const model = String(item.model || item.id || item.name || '').trim()
  if (!model) return null

  const beta1m = Boolean(item.beta1m)
  const id = String(item.id || item.key || `${model}${beta1m ? '|1m' : ''}`)
  return {
    ...item,
    id,
    key: id,
    model,
    label: String(item.label || model),
    beta1m
  }
}

export function normalizeModelOptions(models) {
  const seen = new Set()
  return (Array.isArray(models) ? models : []).map(normalizeModelOption).filter((item) => {
    if (!item || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function protocolLabel(protocol) {
  return PROTOCOL_LABELS[protocol] || protocol || '未知协议'
}

export function protocolDisplay(provider) {
  const parts = []
  if (provider.protocol === 'openai') {
    parts.push(provider.wireApi === 'responses' ? 'Responses API' : 'Chat Completions API')
  } else if (provider.protocol === 'anthropic') {
    parts.push('Messages API')
  } else if (provider.protocol === 'gemini') {
    parts.push('Generate Content API')
  }
  return parts.join(' · ') || provider.protocol
}

export function statusText(result) {
  return STATUS_TEXT[result?.status] || result?.status || ''
}

export function formatDuration(ms) {
  const value = Number(ms || 0)
  if (!value || value < 0) return ''
  if (value < 1000) return `${Math.round(value)} ms`
  if (value < 10000) return `${(value / 1000).toFixed(1)} s`
  return `${Math.round(value / 1000)} s`
}

/** 可用结果的耗时档位，用于表格着色。 */
export function durationTone(ms) {
  const value = Number(ms || 0)
  if (!value || value < 0) return ''
  if (value < 800) return 'fast'
  if (value < 2500) return 'normal'
  return 'slow'
}

export function formatRelativeTime(timestamp) {
  const ts = Number(timestamp || 0)
  if (!ts) return ''
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (sec < 45) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60) || 1} 分钟前`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`
  const days = Math.floor(sec / 86400)
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

export function detailText(result) {
  if (!result || result.status === 'idle') return '—'
  if (result.status === 'testing') return '请求中…'

  const age = formatRelativeTime(result.updatedAt)
  const ageSuffix = age ? ` · 测于 ${age}` : ''

  if (result.status === 'ok') {
    const parts = []
    if (result.endpoint) parts.push(result.endpoint)
    if (result.reply) parts.push(`回复：${result.reply.slice(0, 40)}`)
    return (parts.join(' · ') || '请求成功') + ageSuffix
  }
  if (result.status === 'gateway') {
    return `${result.message || '中转站拒绝轻量探测'}${ageSuffix}`
  }
  const prefix = result.httpStatus ? `HTTP ${result.httpStatus} · ` : ''
  return `${prefix}${result.message || ''}${ageSuffix}`
}

export function normalizeScopeKeys(keys) {
  if (!Array.isArray(keys)) return null
  return [...new Set(keys.map((key) => String(key || '').trim()).filter(Boolean))]
}
