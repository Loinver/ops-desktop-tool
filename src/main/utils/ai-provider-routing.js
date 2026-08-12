const fs = require('node:fs')
const path = require('node:path')

const STATE_VERSION = 1
const ROUTING_STATE_FILENAME = 'ai-provider-routing.json'
const MAX_ROUTE_HISTORY = 50
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  preferLocal: true,
  maxAttempts: 2,
  cooldownMinutes: 5
})
const DEFAULT_ROUTING_SETTINGS = DEFAULT_SETTINGS

const ROUTE_OUTCOMES = new Set(['success', 'failure', 'cancelled', 'stopped'])
const STOP_REASONS = new Set(['cancelled', 'partial-output', 'failover-disabled', 'exhausted'])

function boundedInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(numeric)))
}

function normalizeSettings(value = {}) {
  return {
    enabled: value?.enabled === true,
    preferLocal: value?.preferLocal !== false,
    maxAttempts: boundedInteger(value?.maxAttempts, DEFAULT_SETTINGS.maxAttempts, 1, 3),
    cooldownMinutes: boundedInteger(value?.cooldownMinutes, DEFAULT_SETTINGS.cooldownMinutes, 1, 60)
  }
}

function mergeSettings(base, override) {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...(base && typeof base === 'object' ? base : {}),
    ...(override && typeof override === 'object' ? override : {})
  })
}

function timestampOrNull(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return fallback
  return Math.floor(numeric)
}

function safeProviderId(value) {
  const raw = String(value ?? '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
    .trim()
    .slice(0, 160)
  if (!raw) return ''
  if (/-----BEGIN|sk-[a-z0-9_-]{8,}|(?:api[_-]?key|authorization|bearer)\s*[:=]/i.test(raw)) {
    return 'unknown'
  }
  return raw
}

function safeErrorCode(value) {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
  if (!raw) return null
  if (/^[A-Z][A-Z0-9_.:-]{0,63}$/.test(raw)) return raw
  return 'PROVIDER_ERROR'
}

function errorCodeFrom(error) {
  if (error && typeof error === 'object') {
    const explicitCode = safeErrorCode(error.code)
    if (explicitCode) return explicitCode
    const status = Number(error.status)
    if (Number.isInteger(status) && status >= 400 && status <= 599) return `HTTP_${status}`
  }
  return 'PROVIDER_ERROR'
}

function statePath(userDataPath) {
  if (typeof userDataPath !== 'string' || !userDataPath.trim()) return null
  return path.join(userDataPath, ROUTING_STATE_FILENAME)
}

function normalizeHealthEntry(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    consecutiveFailures: boundedInteger(source.consecutiveFailures, 0, 0, 1000000),
    cooldownUntil: timestampOrNull(source.cooldownUntil),
    lastFailureAt: timestampOrNull(source.lastFailureAt),
    lastSuccessAt: timestampOrNull(source.lastSuccessAt),
    lastErrorCode: safeErrorCode(source.lastErrorCode)
  }
}

function normalizeRouteRecord(value, fallbackAt = 0) {
  const source = value && typeof value === 'object' ? value : {}
  const providerId = safeProviderId(source.providerId ?? source.id)
  if (!providerId) return null

  const outcome = ROUTE_OUTCOMES.has(source.outcome) ? source.outcome : 'failure'
  const stoppedReason = STOP_REASONS.has(source.stoppedReason) ? source.stoppedReason : undefined
  const record = {
    at: timestampOrNull(source.at ?? source.timestamp, fallbackAt) ?? fallbackAt,
    providerId,
    outcome,
    attempt: boundedInteger(source.attempt, 1, 1, 1000000),
    index: boundedInteger(source.index, 0, 0, 1000000),
    switched: source.switched === true,
    errorCode: safeErrorCode(source.errorCode)
  }
  if (stoppedReason) record.stoppedReason = stoppedReason
  return record
}

function createRoutingState(settings = {}) {
  return {
    version: STATE_VERSION,
    settings: normalizeSettings(settings),
    health: {},
    routeHistory: []
  }
}

function normalizeRoutingState(value) {
  const source = value && typeof value === 'object' ? value : {}
  const health = {}
  const sourceHealth = source.health && typeof source.health === 'object' ? source.health : {}
  for (const [key, entry] of Object.entries(sourceHealth)) {
    const providerId = safeProviderId(key)
    if (!providerId) continue
    health[providerId] = normalizeHealthEntry(entry)
  }

  const sourceHistory = Array.isArray(source.routeHistory)
    ? source.routeHistory
    : Array.isArray(source.routes)
      ? source.routes
      : []
  const routeHistory = sourceHistory
    .map((record) => normalizeRouteRecord(record))
    .filter(Boolean)
    .slice(-MAX_ROUTE_HISTORY)

  return {
    version: STATE_VERSION,
    settings: normalizeSettings(source.settings),
    health,
    routeHistory
  }
}

function getRoutingState(userDataPath) {
  const filePath = statePath(userDataPath)
  if (!filePath) return createRoutingState()

  try {
    if (!fs.existsSync(filePath)) return createRoutingState()
    return normalizeRoutingState(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch {
    return createRoutingState()
  }
}

function saveRoutingState(userDataPath, value, { strict = false } = {}) {
  const normalized = normalizeRoutingState(value)
  const filePath = statePath(userDataPath)
  if (!filePath) return normalized

  const temporaryPath = `${filePath}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    fs.renameSync(temporaryPath, filePath)
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {}
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath)
    } catch {}
    if (strict) {
      const saveError = new Error('保存 AI Provider 路由状态失败')
      saveError.code = 'AI_PROVIDER_ROUTING_SAVE_FAILED'
      saveError.cause = error
      throw saveError
    }
  }
  return normalized
}

function saveProviderRoutingSettings(userDataPath, settings = {}) {
  const state = getRoutingState(userDataPath)
  state.settings = mergeSettings(state.settings, settings)
  return saveRoutingState(userDataPath, state, { strict: true })
}

function resetProviderRoutingHealth(userDataPath) {
  const state = getRoutingState(userDataPath)
  state.health = {}
  return saveRoutingState(userDataPath, state, { strict: true })
}

function resolveState(options = {}) {
  const source = options.state
    ? normalizeRoutingState(options.state)
    : getRoutingState(options.userDataPath)
  source.settings = mergeSettings(source.settings, options.settings)
  return source
}

function providerIdForCandidate(candidate, index = 0) {
  if (typeof candidate === 'string') return safeProviderId(candidate) || `candidate-${index}`
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  return (
    safeProviderId(
      source.providerId ?? source.id ?? source.provider?.providerId ?? source.provider?.id
    ) ||
    safeProviderId(source.name) ||
    `candidate-${index}`
  )
}

function urlForCandidate(candidate) {
  if (typeof candidate === 'string') return candidate
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  return (
    source.baseUrl ??
    source.baseURL ??
    source.url ??
    source.endpoint ??
    source.provider?.baseUrl ??
    ''
  )
}

function hostnameFromUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    try {
      parsed = new URL(`http://${raw}`)
    } catch {
      return ''
    }
  }
  return String(parsed.hostname || '')
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '')
}

function isLoopbackUrl(value) {
  const hostname = hostnameFromUrl(value)
  if (!hostname) return false
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  if (hostname === '::1') return true

  const parts = hostname.split('.')
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every(
      (part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) >= 0 && Number(part) <= 255
    )
  )
}

function candidateDetails(candidates) {
  return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({
    candidate,
    index,
    providerId: providerIdForCandidate(candidate, index),
    isLocal: isLoopbackUrl(urlForCandidate(candidate))
  }))
}

function requestedProviderId(options) {
  return providerIdForCandidate(
    options.requestedProviderId ?? options.requestedProvider ?? options.providerId ?? '',
    0
  )
}

function defaultProviderId(options) {
  return providerIdForCandidate(options.defaultProviderId ?? options.defaultProvider ?? '', 0)
}

function coolingDetails(details, health, now) {
  return details
    .map((detail) => {
      const entry = health[detail.providerId]
      const cooldownUntil = timestampOrNull(entry?.cooldownUntil)
      return {
        ...detail,
        cooldownUntil,
        cooling: cooldownUntil !== null && cooldownUntil > now
      }
    })
    .sort((left, right) => {
      if (left.cooling !== right.cooling) return left.cooling ? 1 : -1
      if (left.cooling && right.cooling && left.cooldownUntil !== right.cooldownUntil) {
        return left.cooldownUntil - right.cooldownUntil
      }
      return left.index - right.index
    })
}

function orderProviderCandidates(candidates, options = {}) {
  const state = resolveState(options)
  const settings = state.settings
  const details = candidateDetails(candidates)
  if (details.length === 0) return []

  const requestedId = requestedProviderId(options)
  const fallbackId = defaultProviderId(options)
  const requested = details.find((detail) => requestedId && detail.providerId === requestedId)
  const fallback = details.find((detail) => fallbackId && detail.providerId === fallbackId)
  const markedDefault = details.find(
    (detail) =>
      detail.candidate &&
      typeof detail.candidate === 'object' &&
      detail.candidate.isDefault === true
  )
  const directCandidate = requested || fallback || markedDefault || details[0]

  if (!settings.enabled) return [directCandidate.candidate]

  const now = timestampOrNull(options.now, Date.now())
  const classified = coolingDetails(details, state.health, now)
  const active = classified.filter((detail) => !detail.cooling)
  const cooling = classified.filter((detail) => detail.cooling)
  if (!active.length && cooling.length) return [cooling[0].candidate]
  const activeOrdered = settings.preferLocal
    ? [...active.filter((detail) => detail.isLocal), ...active.filter((detail) => !detail.isLocal)]
    : active
  return [...activeOrdered, ...cooling]
    .slice(0, settings.maxAttempts)
    .map((detail) => detail.candidate)
}

function stateForRuntimeMutation(options = {}) {
  const filePath = statePath(options.userDataPath)
  if (filePath && fs.existsSync(filePath)) return getRoutingState(options.userDataPath)
  return resolveState(options)
}

function updateHealth(userDataPath, options, update) {
  const state = stateForRuntimeMutation(options)
  const providerId = safeProviderId(options.providerId)
  if (!providerId) return state
  state.health[providerId] = update(normalizeHealthEntry(state.health[providerId]))
  return saveRoutingState(userDataPath, state)
}

function recordProviderFailure(options = {}) {
  const input = options && typeof options === 'object' ? options : {}
  const now = timestampOrNull(input.now, Date.now())
  const state = stateForRuntimeMutation(input)
  const providerId = safeProviderId(input.providerId)
  if (!providerId) return state
  const current = normalizeHealthEntry(state.health[providerId])
  const cooldownUntil = now + state.settings.cooldownMinutes * 60 * 1000
  state.health[providerId] = {
    consecutiveFailures: current.consecutiveFailures + 1,
    cooldownUntil,
    lastFailureAt: now,
    lastSuccessAt: current.lastSuccessAt,
    lastErrorCode: safeErrorCode(input.errorCode) || errorCodeFrom(input.error)
  }
  return saveRoutingState(input.userDataPath, state)
}

function recordProviderSuccess(options = {}) {
  const input = options && typeof options === 'object' ? options : {}
  const now = timestampOrNull(input.now, Date.now())
  return updateHealth(input.userDataPath, input, (current) => ({
    consecutiveFailures: 0,
    cooldownUntil: null,
    lastFailureAt: current.lastFailureAt,
    lastSuccessAt: now,
    lastErrorCode: null
  }))
}

function recordRouteHistory(options = {}) {
  const input = options && typeof options === 'object' ? options : {}
  const state = stateForRuntimeMutation(input)
  const source = input.record && typeof input.record === 'object' ? input.record : input
  const record = normalizeRouteRecord(
    {
      providerId: source.providerId ?? input.providerId,
      outcome: source.outcome,
      at: source.at ?? input.now,
      attempt: source.attempt,
      index: source.index,
      switched: source.switched,
      errorCode: source.errorCode ?? (source.error && source.error.code),
      stoppedReason: source.stoppedReason
    },
    timestampOrNull(input.now, Date.now())
  )
  if (!record) return state
  state.routeHistory = [...state.routeHistory, record].slice(-MAX_ROUTE_HISTORY)
  return saveRoutingState(input.userDataPath, state)
}

function currentPredicateValue(predicate, context, fallback) {
  if (typeof predicate === 'boolean') return predicate
  if (typeof predicate !== 'function') return fallback
  return Promise.resolve()
    .then(() => predicate(context))
    .then(Boolean)
    .catch(() => fallback)
}

function routeMetadata(
  options,
  attemptedProviderIds,
  selectedProviderId = null,
  stoppedReason = null
) {
  const requestedId = safeProviderId(options.requestedProviderId ?? options.providerId)
  const settings = normalizeSettings(options.settings)
  const metadata = {
    enabled: settings.enabled,
    requestedProviderId: requestedId || null,
    attemptedProviderIds: [...attemptedProviderIds],
    attemptCount: attemptedProviderIds.length,
    maxAttempts: settings.maxAttempts,
    selectedProviderId: selectedProviderId || null,
    failover:
      attemptedProviderIds.length > 1 ||
      Boolean(requestedId && selectedProviderId && requestedId !== selectedProviderId)
  }
  if (stoppedReason) metadata.stoppedReason = stoppedReason
  return metadata
}

function routeError(code, metadata, cause) {
  const error = new Error(cause?.message || code)
  error.code = code
  error.route = metadata
  error.routeMetadata = metadata
  if (cause) error.cause = cause
  return error
}

async function executeProviderRoute(options = {}) {
  if (!options || typeof options !== 'object')
    throw new TypeError('executeProviderRoute options are required')
  if (typeof options.execute !== 'function')
    throw new TypeError('executeProviderRoute requires execute')

  const state = resolveState(options)
  const settings = state.settings
  const orderedCandidates = orderProviderCandidates(options.candidates, {
    ...options,
    state,
    settings
  })
  const attemptedProviderIds = []

  if (orderedCandidates.length === 0) {
    throw routeError('AI_PROVIDER_ROUTE_FAILED', routeMetadata({ ...options, settings }, []))
  }

  for (let index = 0; index < orderedCandidates.length; index += 1) {
    const provider = orderedCandidates[index]
    const providerId = providerIdForCandidate(provider, index)
    const attempt = index + 1
    const context = { attempt, index, providerId }
    attemptedProviderIds.push(providerId)

    if (await currentPredicateValue(options.isCancelled, context, false)) {
      throw routeError(
        'AI_PROVIDER_ROUTE_CANCELLED',
        routeMetadata({ ...options, settings }, attemptedProviderIds, null, 'cancelled')
      )
    }

    try {
      if (typeof options.beforeAttempt === 'function') {
        await options.beforeAttempt(provider, { attempt, index })
      }
      if (await currentPredicateValue(options.isCancelled, context, false)) {
        throw routeError(
          'AI_PROVIDER_ROUTE_CANCELLED',
          routeMetadata({ ...options, settings }, attemptedProviderIds, null, 'cancelled')
        )
      }

      const result = await options.execute(provider, { attempt, index })
      recordProviderSuccess({
        userDataPath: options.userDataPath,
        providerId,
        now: options.now,
        state
      })
      recordRouteHistory({
        userDataPath: options.userDataPath,
        providerId,
        outcome: 'success',
        attempt,
        index,
        switched:
          index > 0 ||
          Boolean(options.requestedProviderId && providerId !== options.requestedProviderId),
        now: options.now
      })
      const metadata = routeMetadata({ ...options, settings }, attemptedProviderIds, providerId)
      return { result, provider, route: metadata, routeMetadata: metadata }
    } catch (error) {
      if (error?.code === 'AI_PROVIDER_ROUTE_CANCELLED') throw error

      const errorCode = errorCodeFrom(error)
      const nextContext = { ...context, error, errorCode }
      const cancelled = await currentPredicateValue(options.isCancelled, nextContext, false)
      const partialOutput = await currentPredicateValue(
        options.hasPartialOutput,
        nextContext,
        false
      )
      const failoverAllowed = await currentPredicateValue(options.canFailover, nextContext, true)
      const preserveError = await currentPredicateValue(options.preserveError, nextContext, false)
      const shouldRecordFailure = await currentPredicateValue(
        options.shouldRecordFailure,
        nextContext,
        true
      )

      if (!cancelled && shouldRecordFailure) {
        recordProviderFailure({
          userDataPath: options.userDataPath,
          providerId,
          error,
          errorCode,
          now: options.now,
          state
        })
        recordRouteHistory({
          userDataPath: options.userDataPath,
          providerId,
          outcome: 'failure',
          attempt,
          index,
          switched:
            index > 0 ||
            Boolean(options.requestedProviderId && providerId !== options.requestedProviderId),
          errorCode,
          now: options.now
        })
      }

      if (cancelled) {
        throw routeError(
          'AI_PROVIDER_ROUTE_CANCELLED',
          routeMetadata({ ...options, settings }, attemptedProviderIds, null, 'cancelled'),
          error
        )
      }
      if (preserveError) {
        error.route = routeMetadata(
          { ...options, settings },
          attemptedProviderIds,
          null,
          'failover-disabled'
        )
        throw error
      }
      if (partialOutput) {
        throw routeError(
          'AI_PROVIDER_ROUTE_PARTIAL_OUTPUT',
          routeMetadata({ ...options, settings }, attemptedProviderIds, null, 'partial-output'),
          error
        )
      }
      if (!failoverAllowed) {
        throw routeError(
          'AI_PROVIDER_ROUTE_FAILED',
          routeMetadata({ ...options, settings }, attemptedProviderIds, null, 'failover-disabled'),
          error
        )
      }
      if (index >= orderedCandidates.length - 1) {
        throw routeError(
          'AI_PROVIDER_ROUTE_FAILED',
          routeMetadata({ ...options, settings }, attemptedProviderIds, null, 'exhausted'),
          error
        )
      }
    }
  }

  throw routeError(
    'AI_PROVIDER_ROUTE_FAILED',
    routeMetadata({ ...options, settings }, attemptedProviderIds, null, 'exhausted')
  )
}

module.exports = {
  DEFAULT_ROUTING_SETTINGS,
  DEFAULT_SETTINGS,
  MAX_ROUTE_HISTORY,
  ROUTING_STATE_FILENAME,
  STATE_VERSION,
  classifyLoopbackUrl: isLoopbackUrl,
  createRoutingState,
  executeProviderRoute,
  getRoutingState,
  isLoopbackProvider: (providerOrUrl) => isLoopbackUrl(urlForCandidate(providerOrUrl)),
  isLoopbackUrl,
  loadProviderRoutingState: getRoutingState,
  loadRoutingState: getRoutingState,
  normalizeRoutingState,
  normalizeSettings,
  orderCandidates: orderProviderCandidates,
  orderProviderCandidates,
  recordProviderFailure,
  recordProviderSuccess,
  recordRouteHistory,
  resetProviderRoutingHealth,
  saveProviderRoutingSettings,
  saveRoutingState,
  statePath
}
