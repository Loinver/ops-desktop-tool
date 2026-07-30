const MAX_MODEL_RULES = 100
const MAX_MODEL_RULE_LENGTH = 160

function normalizeModelRules(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,]/)
  const seen = new Set()
  const rules = []

  for (const raw of source) {
    const rule = String(raw || '').trim().slice(0, MAX_MODEL_RULE_LENGTH)
    if (!rule) continue
    const key = rule.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rules.push(rule)
    if (rules.length >= MAX_MODEL_RULES) break
  }

  return rules
}

function normalizeModelListSettings(value = {}) {
  return {
    mode: value?.mode === 'include' ? 'include' : 'all',
    includeRules: normalizeModelRules(value?.includeRules),
    excludeRules: normalizeModelRules(value?.excludeRules),
  }
}

function wildcardRuleToRegExp(rule) {
  const escaped = String(rule || '')
    .trim()
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

function bareModelId(model) {
  const raw = String(model || '').trim()
  const slash = raw.lastIndexOf('/')
  return slash >= 0 ? raw.slice(slash + 1) : raw
}

function matchesModelRule(model, rule) {
  const matcher = wildcardRuleToRegExp(rule)
  const full = String(model || '').trim()
  return matcher.test(full) || matcher.test(bareModelId(full))
}

function matchesAnyModelRule(model, rules) {
  return normalizeModelRules(rules).some(rule => matchesModelRule(model, rule))
}

function isModelIncludedBySettings(model, value = {}) {
  const settings = normalizeModelListSettings(value)
  if (matchesAnyModelRule(model, settings.excludeRules)) return false
  if (settings.mode === 'all') return true
  return matchesAnyModelRule(model, settings.includeRules)
}

/**
 * 协议兼容性不是模型展示白名单：只阻止端点本身无法调用的组合。
 * 其它型号均交由用户保存的包含/排除规则与实际探测请求决定。
 */
function modelProtocolAffinity(model) {
  const raw = bareModelId(model).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (raw.startsWith('claude')) return 'anthropic'
  if (raw.startsWith('gemini')) return 'gemini'
  if (raw.startsWith('gpt') || raw.startsWith('grok') || raw.includes('image')) return 'openai'
  return 'any'
}

function isModelAllowedForProtocol(protocol, model) {
  const affinity = modelProtocolAffinity(model)
  return affinity === 'any' || affinity === protocol
}

module.exports = {
  MAX_MODEL_RULES,
  MAX_MODEL_RULE_LENGTH,
  normalizeModelRules,
  normalizeModelListSettings,
  matchesModelRule,
  isModelIncludedBySettings,
  modelProtocolAffinity,
  isModelAllowedForProtocol,
}
