import {
  CACHEABLE_RESULT_STATUSES,
  RESULT_CACHE_STORAGE_KEY,
  RESULT_CACHE_TTL_MS,
  SCOPE_STORAGE_KEY
} from '../constants.js'
import { normalizeScopeKeys, providerKey } from '../modelUtils.js'

/**
 * 管理模型连通性结果与巡检范围的本地持久化。
 * 缓存只保存最小诊断结论，并在中转站线路配置变化时自动失效。
 */
export function useModelTestPersistence({ results, selectedScopeKeys }) {
  let cachedProviderFingerprints = {}

  function normalizeCachedResult(value) {
    if (!value || !CACHEABLE_RESULT_STATUSES.has(value.status)) return null
    const updatedAt = Number(value.updatedAt || 0)
    if (!updatedAt || Date.now() - updatedAt > RESULT_CACHE_TTL_MS) return null

    return {
      status: value.status,
      message: String(value.message || ''),
      httpStatus: Number(value.httpStatus || 0),
      endpoint: String(value.endpoint || ''),
      durationMs: Number(value.durationMs || 0),
      updatedAt
    }
  }

  function providerCacheFingerprint(provider) {
    // 仅使用渲染进程本来就能看到的非敏感线路字段；绝不把 apiKey 写入 localStorage。
    return JSON.stringify({
      id: String(provider?.id || ''),
      appType: String(provider?.appType || ''),
      protocol: String(provider?.protocol || ''),
      baseUrl: String(provider?.baseUrl || ''),
      fallbackBaseUrl: String(provider?.fallbackBaseUrl || ''),
      anthropicAuthType: String(provider?.anthropicAuthType || ''),
      customUserAgent: String(provider?.customUserAgent || '')
    })
  }

  function syncCachedResultsWithProviders(nextProviders) {
    const nextFingerprints = {}
    const providerKeys = new Set()
    for (const provider of nextProviders || []) {
      const key = providerKey(provider)
      providerKeys.add(key)
      nextFingerprints[key] = providerCacheFingerprint(provider)
    }

    let changed = false
    for (const key of Object.keys(results)) {
      const matchedProviderKey = [...providerKeys].find((providerKeyValue) =>
        key.startsWith(`${providerKeyValue}::`)
      )
      // 当前不存在的中转站、以及线路配置发生变化的中转站，均不能复用旧结果。
      if (
        !matchedProviderKey ||
        cachedProviderFingerprints[matchedProviderKey] !== nextFingerprints[matchedProviderKey]
      ) {
        delete results[key]
        changed = true
      }
    }

    const fingerprintsChanged =
      JSON.stringify(cachedProviderFingerprints) !== JSON.stringify(nextFingerprints)
    cachedProviderFingerprints = nextFingerprints
    if (changed || fingerprintsChanged) persistCachedResults()
  }

  function restoreCachedResults() {
    try {
      const raw = window.localStorage.getItem(RESULT_CACHE_STORAGE_KEY)
      const stored = raw ? JSON.parse(raw) : null
      const entries = stored && typeof stored.results === 'object' ? stored.results : {}
      cachedProviderFingerprints =
        stored && typeof stored.providerFingerprints === 'object' ? stored.providerFingerprints : {}
      let hasExpired = false

      for (const [key, value] of Object.entries(entries)) {
        const result = normalizeCachedResult(value)
        if (result) results[key] = result
        else hasExpired = true
      }

      if (hasExpired) persistCachedResults()
    } catch {
      // localStorage 不可用或旧缓存损坏时，直接从空状态开始即可。
      cachedProviderFingerprints = {}
    }
  }

  function persistCachedResults() {
    try {
      const cached = {}
      for (const [key, value] of Object.entries(results)) {
        const result = normalizeCachedResult(value)
        if (!result) continue
        // 不持久化真实回复内容，缓存只保存连通结论和最小诊断信息。
        cached[key] = result
      }
      window.localStorage.setItem(
        RESULT_CACHE_STORAGE_KEY,
        JSON.stringify({
          version: 2,
          providerFingerprints: cachedProviderFingerprints,
          results: cached
        })
      )
    } catch {
      // 隐私模式、磁盘空间不足等场景不应影响正常测试。
    }
  }

  function setResult(key, result) {
    results[key] = result
    if (CACHEABLE_RESULT_STATUSES.has(result.status)) persistCachedResults()
  }

  function restoreScopeSettings() {
    try {
      const raw = window.localStorage.getItem(SCOPE_STORAGE_KEY)
      if (!raw) {
        selectedScopeKeys.value = null
        return
      }
      const stored = JSON.parse(raw)
      // selectedKeys 为 null/缺省：未配置；为数组：已配置（可为空数组表示一键不测任何项）
      if (!stored || !Object.prototype.hasOwnProperty.call(stored, 'selectedKeys')) {
        selectedScopeKeys.value = null
        return
      }
      if (stored.selectedKeys == null) {
        selectedScopeKeys.value = null
        return
      }
      selectedScopeKeys.value = new Set(normalizeScopeKeys(stored.selectedKeys) || [])
    } catch {
      selectedScopeKeys.value = null
    }
  }

  function persistScopeSettings() {
    try {
      const payload =
        selectedScopeKeys.value == null
          ? { version: 1, selectedKeys: null }
          : {
              version: 1,
              selectedKeys: [...selectedScopeKeys.value]
            }
      window.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // localStorage 不可用时不阻断页面，仅无法持久化范围。
    }
  }

  return {
    restoreCachedResults,
    persistCachedResults,
    syncCachedResultsWithProviders,
    setResult,
    restoreScopeSettings,
    persistScopeSettings
  }
}
