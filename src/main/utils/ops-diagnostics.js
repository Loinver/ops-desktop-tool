const os = require('node:os')

const OPS_DIAGNOSTICS_SCHEMA = 'ops-desktop.diagnostics'
const OPS_DIAGNOSTICS_VERSION = 1

const DIAGNOSTIC_LIMITS = Object.freeze({
  eventItems: 100,
  eventTimeline: 20,
  eventAttributes: 20,
  automationTasks: 50,
  modelTargets: 50,
  modelHistory: 50,
  modelResults: 20,
  nodeWatches: 50,
  nodeHistory: 100,
  releaseHistory: 50,
  auditRecords: 100,
  logEntries: 100,
  logFindings: 20,
  textLength: 2_000,
  nestedDepth: 6,
  nestedArray: 20,
  nestedKeys: 40
})

const EVENT_SUMMARY_FIELDS = [
  'total',
  'active',
  'open',
  'acknowledged',
  'resolved',
  'recovered',
  'unread',
  'unreadCritical',
  'critical',
  'warning'
]

const MODEL_SUMMARY_FIELDS = ['total', 'ok', 'failed', 'gateway', 'durationMs']

const SECRET_KEY_PATTERN =
  /(?:password|passwd|passphrase|secret|token|credential|authorization|cookie|session|privatekey|apikey|accesskey|accesstoken|refreshtoken|idtoken|clientsecret|signingkey|encryptionkey|keymaterial)/
const OMITTED_KEY_PATTERN =
  /^(?:prompt|systemprompt|knowledge|knowledgecontent|content|contents|provider|providers|providerconfig|providerconfigs|providerlist|rawprovider|config|configuration|settings|options|headers|request|response|payload|input|output|details|script|command|executable|path|filepath|filename|directory|outputdirectory|backupdirectory|backupfile|backuppath|archivepath|archiveroots|remotedir|userdatapath|homedir|tmpdir|workdir|cwd|environment)$/
const OMITTED_KEY_FRAGMENT_PATTERN =
  /(?:prompt|knowledge|content|providerconfig|rawprovider|backup(?:path|file|directory|dir)|archive(?:path|root)|outputdirectory|userdatapath)/

const URL_PATTERN = /(?:https?|wss?|ftp|sftp|ssh|postgres(?:ql)?|mysql):\/\/[^\s<>"']+/gi
const URL_TRAILING_PUNCTUATION = /[),.;!?]+$/
const HOME_PATH_PATTERNS = [
  /(?:\/Users\/|\/home\/)[^/\\\s"'<>]+(?:[\\/][^"'<>]*?)?(?=\s+(?:and|or|with|from)\b|$|[),;!?])/gi,
  /[A-Za-z]:\\Users\\[^\\\s"'<>]+(?:\\[^"'<>]*?)?(?=\s+(?:and|or|with|from)\b|$|[),;!?])/gi,
  /\\\\[^\\\s"'<>]+\\Users\\[^\\\s"'<>]+(?:\\[^"'<>]*?)?(?=\s+(?:and|or|with|from)\b|$|[),;!?])/gi
]
const ABSOLUTE_PATH_PREFIX_PATTERN =
  /(^|[\s("'=])(?:\/(?:Users|home|private|tmp|var|opt|etc|Volumes)\/|[A-Za-z]:\\|\\\\)[^/\\\s"'<>]+/gi
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi
const AUTHORIZATION_HEADER_PATTERN =
  /(\bauthorization\s*:\s*)(?:Bearer|Basic|Token)\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const CLI_SECRET_ARGUMENT_PATTERN =
  /((?:^|\s)--?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|password|passphrase|secret|authorization|credential)(?:\s+|=))(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=-]{8,}/gi
const SECRET_ASSIGNMENT_PATTERN =
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|password|passwd|passphrase|secret(?:[_-]?key)?|private[_-]?key|client[_-]?secret|session(?:[_-]?id)?|credential)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const NAKED_SECRET_PATTERNS = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/gi,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_-]{10,}\b/gi,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?token)[_-][A-Za-z0-9_-]{4,}\b/gi
]

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null)
}

function normalizedKey(key) {
  return String(key || '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function isSensitiveKey(key) {
  const normalized = normalizedKey(key)
  return Boolean(normalized && SECRET_KEY_PATTERN.test(normalized))
}

function isOmittedKey(key) {
  const normalized = normalizedKey(key)
  return Boolean(
    !normalized ||
    normalized === 'tojson' ||
    normalized === 'constructor' ||
    normalized === 'prototype' ||
    OMITTED_KEY_PATTERN.test(normalized) ||
    OMITTED_KEY_FRAGMENT_PATTERN.test(normalized)
  )
}

function isSensitiveQueryKey(key) {
  const normalized = normalizedKey(key)
  return (
    isSensitiveKey(normalized) ||
    /^(?:auth|bearer|key|sig|signature|credential|code)$/.test(normalized) ||
    /(?:apikey|accesstoken|refreshtoken|clientsecret|privatekey)/.test(normalized)
  )
}

function sanitizeUrl(value) {
  const trailing = value.match(URL_TRAILING_PUNCTUATION)?.[0] || ''
  const candidate = trailing ? value.slice(0, -trailing.length) : value

  try {
    const parsed = new URL(candidate)
    parsed.username = ''
    parsed.password = ''
    parsed.hash = ''

    const safeParams = []
    for (const [key, item] of parsed.searchParams.entries()) {
      if (!isSensitiveQueryKey(key)) safeParams.push([key, item])
    }
    parsed.search = ''
    for (const [key, item] of safeParams) parsed.searchParams.append(key, item)
    return `${parsed.toString()}${trailing}`
  } catch {
    return value
      .replace(/(https?:\/\/)(?:[^/\s:@]+(?::[^/\s@]*)?@)/gi, '$1')
      .replace(
        /([?&])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token)=[^&#\s]*/gi,
        '$1'
      )
  }
}

function redactHomePaths(value) {
  let result = value
  for (const pattern of HOME_PATH_PATTERNS) result = result.replace(pattern, '[HOME]')
  result = result.replace(
    /(?:\/Users\/|\/home\/)[^/\\\s"'<>]+|[A-Za-z]:\\Users\\[^\\\s"'<>]+/gi,
    '[HOME]'
  )

  const home = typeof os.homedir === 'function' ? os.homedir() : ''
  if (home) {
    const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(
      new RegExp(
        `${escapedHome}(?:[/\\][^"'<>]*?)?(?=\\s+(?:and|or|with|from)\\b|$|[),;!?])`,
        'gi'
      ),
      '[HOME]'
    )
  }
  return result
}

function redactDiagnosticText(value, maxLength = DIAGNOSTIC_LIMITS.textLength) {
  if (value === undefined || value === null) return ''
  let result = String(value)
    .replace(PRIVATE_KEY_PATTERN, '[REDACTED]')
    .replace(URL_PATTERN, sanitizeUrl)
    .replace(AUTHORIZATION_HEADER_PATTERN, '$1[REDACTED]')
    .replace(CLI_SECRET_ARGUMENT_PATTERN, '$1[REDACTED]')
    .replace(BEARER_PATTERN, '[REDACTED]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '[REDACTED]')

  for (const pattern of NAKED_SECRET_PATTERNS) result = result.replace(pattern, '[REDACTED]')
  result = redactHomePaths(result)
  result = result.replace(ABSOLUTE_PATH_PREFIX_PATTERN, '$1[PATH]')
  return result.slice(0, maxLength)
}

function redactDiagnosticValue(value, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth)
    ? Math.max(0, options.maxDepth)
    : DIAGNOSTIC_LIMITS.nestedDepth
  const maxArrayLength = Number.isInteger(options.maxArrayLength)
    ? Math.max(0, options.maxArrayLength)
    : DIAGNOSTIC_LIMITS.nestedArray
  const maxKeys = Number.isInteger(options.maxKeys)
    ? Math.max(0, options.maxKeys)
    : DIAGNOSTIC_LIMITS.nestedKeys
  const seen = new WeakSet()

  function visit(item, depth) {
    if (item === null) return null
    if (typeof item === 'string') return redactDiagnosticText(item)
    if (typeof item === 'number') return Number.isFinite(item) ? item : undefined
    if (typeof item === 'boolean') return item
    if (typeof item === 'bigint') return String(item)
    if (typeof item !== 'object' || depth > maxDepth) return undefined
    if (item instanceof Date) return Number.isNaN(item.getTime()) ? undefined : item.toISOString()
    if (ArrayBuffer.isView(item) || item instanceof Map || item instanceof Set) return undefined
    if (seen.has(item)) return undefined
    seen.add(item)

    if (Array.isArray(item)) {
      const result = []
      for (const child of item.slice(0, maxArrayLength)) {
        const safeChild = visit(child, depth + 1)
        if (safeChild !== undefined) result.push(safeChild)
      }
      return result
    }

    const result = Object.create(null)
    let count = 0
    let entries
    try {
      entries = Object.entries(item)
    } catch {
      return result
    }
    for (const [key, childValue] of entries) {
      if (count >= maxKeys || isSensitiveKey(key) || isOmittedKey(key)) continue
      let safeChild
      try {
        safeChild = visit(childValue, depth + 1)
      } catch {
        safeChild = undefined
      }
      if (safeChild !== undefined) {
        result[String(key).slice(0, 120)] = safeChild
        count += 1
      }
    }
    return result
  }

  const result = visit(value, 0)
  return result === undefined ? undefined : JSON.parse(JSON.stringify(result))
}

function safeString(value, maxLength = 240) {
  if (value === undefined || value === null) return undefined
  if (!['string', 'number', 'boolean'].includes(typeof value)) return undefined
  return redactDiagnosticText(value, maxLength)
}

function safeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function safeCount(value) {
  const number = safeNumber(value)
  return number === undefined ? undefined : Math.max(0, Math.round(number))
}

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : undefined
}

function safeObject(value, options = {}) {
  if (!isObject(value)) return undefined
  const result = redactDiagnosticValue(value, options)
  return isObject(result) ? result : undefined
}

function pickFields(source, fields) {
  const input = isObject(source) ? source : {}
  const result = {}
  for (const [outputKey, config] of Object.entries(fields)) {
    const keys = Array.isArray(config.keys) ? config.keys : [config.keys || outputKey]
    const raw = firstDefined(...keys.map((key) => input[key]))
    if (raw === undefined) continue
    const safeValue = config.transform(raw, input)
    if (safeValue !== undefined) result[outputKey] = safeValue
  }
  return result
}

function safeSummary(value, fields = EVENT_SUMMARY_FIELDS) {
  const source = isObject(value) ? value : {}
  const result = {}
  for (const key of fields) {
    const safeValue = safeCount(source[key])
    if (safeValue !== undefined) result[key] = safeValue
  }
  return result
}

function safeModelSummary(value) {
  return safeSummary(value, MODEL_SUMMARY_FIELDS)
}

function safeTimeline(value) {
  const items = Array.isArray(value) ? value : []
  return items.slice(0, DIAGNOSTIC_LIMITS.eventTimeline).map((item) =>
    pickFields(item, {
      id: { transform: (entry) => safeString(entry, 100) },
      type: { transform: (entry) => safeString(entry, 40) },
      message: { transform: (entry) => safeString(entry, 500) },
      createdAt: { transform: safeNumber }
    })
  )
}

function safeEvent(item) {
  const result = pickFields(item, {
    id: { transform: (value) => safeString(value, 100) },
    fingerprint: { transform: (value) => safeString(value, 240) },
    sourceKey: { transform: (value) => safeString(value, 240) },
    sourceType: { transform: (value) => safeString(value, 60) },
    sourceId: { transform: (value) => safeString(value, 180) },
    category: { transform: (value) => safeString(value, 60) },
    severity: { keys: ['severity', 'level'], transform: (value) => safeString(value, 30) },
    status: { transform: (value) => safeString(value, 30) },
    title: { transform: (value) => safeString(value, 180) },
    description: { transform: (value) => safeString(value, 1_000) },
    resolutionNote: { transform: (value) => safeString(value, 500) },
    relatedId: { transform: (value) => safeString(value, 180) },
    occurrenceCount: { transform: safeCount },
    firstOccurredAt: { transform: safeNumber },
    lastOccurredAt: { transform: safeNumber },
    acknowledgedAt: { transform: safeNumber },
    resolvedAt: { transform: safeNumber },
    recoveredAt: { transform: safeNumber },
    readAt: { transform: safeNumber },
    createdAt: { transform: safeNumber },
    updatedAt: { transform: safeNumber },
    attributes: {
      transform: (value) => safeObject(value, { maxKeys: DIAGNOSTIC_LIMITS.eventAttributes })
    },
    timeline: { transform: safeTimeline }
  })
  return result
}

function safeRunResult(value) {
  return pickFields(value, {
    ok: { transform: safeBoolean },
    status: { transform: (entry) => safeString(entry, 40) },
    startedAt: { transform: safeNumber },
    finishedAt: { transform: safeNumber },
    durationMs: { transform: safeNumber },
    total: { transform: safeCount },
    successCount: { transform: safeCount },
    failedCount: { transform: safeCount },
    errorCount: { transform: safeCount },
    warningCount: { transform: safeCount }
  })
}

function safeAutomationTask(item) {
  return pickFields(item, {
    id: { transform: (value) => safeString(value, 100) },
    name: { transform: (value) => safeString(value, 180) },
    label: { transform: (value) => safeString(value, 180) },
    enabled: { transform: safeBoolean },
    intervalMinutes: { transform: safeNumber },
    nextRunAt: { transform: safeNumber },
    lastRunAt: { transform: safeNumber },
    runCount: { transform: safeCount },
    lastStatus: { transform: (value) => safeString(value, 40) },
    lastResult: { transform: safeRunResult }
  })
}

function safeMonitorTarget(item) {
  return pickFields(item, {
    providerId: { transform: (value) => safeString(value, 160) },
    providerName: { transform: (value) => safeString(value, 220) },
    appType: { transform: (value) => safeString(value, 80) },
    model: { transform: (value) => safeString(value, 220) },
    beta1m: { transform: safeBoolean }
  })
}

function safeModelMonitor(value) {
  const source =
    isObject(value) && isObject(value.settings) ? { ...value.settings, ...value } : value
  const result = pickFields(source, {
    enabled: { transform: safeBoolean },
    intervalMinutes: { transform: safeNumber },
    notifyOnFailure: { transform: safeBoolean },
    lastRunAt: { transform: safeNumber },
    nextRunAt: { transform: safeNumber },
    targetCount: { transform: safeCount }
  })
  const targets = Array.isArray(source?.targets) ? source.targets : []
  if (targets.length) {
    result.targets = targets.slice(0, DIAGNOSTIC_LIMITS.modelTargets).map(safeMonitorTarget)
  }
  return result
}

function safeModelResult(item) {
  return pickFields(item, {
    providerId: { transform: (value) => safeString(value, 160) },
    providerName: { transform: (value) => safeString(value, 220) },
    appType: { transform: (value) => safeString(value, 80) },
    model: { transform: (value) => safeString(value, 220) },
    status: { transform: (value) => safeString(value, 40) },
    durationMs: { transform: safeNumber },
    httpStatus: { transform: safeNumber }
  })
}

function safeModelHistoryEntry(item) {
  const result = pickFields(item, {
    id: { transform: (value) => safeString(value, 100) },
    source: { transform: (value) => safeString(value, 40) },
    label: { transform: (value) => safeString(value, 120) },
    startedAt: { transform: safeNumber },
    finishedAt: { transform: safeNumber },
    summary: { transform: safeModelSummary }
  })
  if (Array.isArray(item?.results))
    result.results = item.results.slice(0, DIAGNOSTIC_LIMITS.modelResults).map(safeModelResult)
  return result
}

function safeNodeWatch(item) {
  return pickFields(item, {
    id: { transform: (value) => safeString(value, 100) },
    protocol: { transform: (value) => safeString(value, 10) },
    port: { transform: safeNumber },
    enabled: { transform: safeBoolean },
    lastState: { transform: (value) => safeString(value, 30) },
    updatedAt: { transform: safeNumber },
    lastSeenAt: { transform: safeNumber },
    lastPid: { keys: ['lastPid', 'pid'], transform: safeCount },
    lastAddress: { keys: ['lastAddress', 'address'], transform: (value) => safeString(value, 200) }
  })
}

function safeNodeHistoryEntry(item) {
  return pickFields(item, {
    id: { transform: (value) => safeString(value, 100) },
    watchId: { transform: (value) => safeString(value, 100) },
    protocol: { transform: (value) => safeString(value, 10) },
    port: { transform: safeNumber },
    state: { keys: ['state', 'lastState'], transform: (value) => safeString(value, 30) },
    status: { transform: (value) => safeString(value, 30) },
    checkedAt: { transform: safeNumber },
    updatedAt: { transform: safeNumber },
    durationMs: { transform: safeNumber },
    pid: { transform: safeCount }
  })
}

function safeBackupIssue(item) {
  return pickFields(item, {
    id: { transform: (value) => safeString(value, 80) },
    level: { transform: (value) => safeString(value, 30) },
    message: { transform: (value) => safeString(value, 500) }
  })
}

function safeBackupHealth(value) {
  const source = isObject(value) && isObject(value.health) ? value.health : value
  const result = pickFields(source, {
    status: { transform: (value) => safeString(value, 30) },
    checkedAt: { transform: safeNumber },
    summary: { transform: (value) => safeString(value, 500) },
    lastSuccessfulAt: { transform: safeNumber },
    latestRunAt: { transform: safeNumber },
    latestStatus: { transform: (value) => safeString(value, 30) },
    freeBytes: { transform: safeNumber },
    missingCount: { transform: safeCount },
    successCount: { transform: safeCount },
    failureCount: { transform: safeCount },
    issueCount: { transform: safeCount }
  })
  if (Array.isArray(source?.issues)) result.issues = source.issues.slice(0, 20).map(safeBackupIssue)
  return result
}

function safeReleaseEntry(item) {
  return pickFields(item, {
    id: { transform: (value) => safeString(value, 100) },
    profileId: { transform: (value) => safeString(value, 100) },
    profileName: { transform: (value) => safeString(value, 180) },
    action: { transform: (value) => safeString(value, 30) },
    status: { transform: (value) => safeString(value, 30) },
    label: { transform: (value) => safeString(value, 200) },
    sourceReleaseId: { transform: (value) => safeString(value, 100) },
    entryCount: { transform: safeCount },
    zipSize: { transform: safeNumber },
    message: { transform: (value) => safeString(value, 1_000) },
    startedAt: { transform: safeNumber },
    finishedAt: { transform: safeNumber },
    rolledBackAt: { transform: safeNumber }
  })
}

function safeAuditRecord(item) {
  return pickFields(item, {
    id: { transform: (value) => safeString(value, 100) },
    action: { transform: (value) => safeString(value, 80) },
    category: { transform: (value) => safeString(value, 80) },
    status: { transform: (value) => safeString(value, 40) },
    actor: { transform: (value) => safeString(value, 120) },
    target: { transform: (value) => safeString(value, 180) },
    result: { transform: (value) => safeString(value, 500) },
    durationMs: { transform: safeNumber },
    createdAt: { transform: safeNumber },
    occurredAt: { transform: safeNumber },
    metadata: {
      transform: (value) => safeObject(value, { maxKeys: DIAGNOSTIC_LIMITS.nestedKeys })
    }
  })
}

function safeLogFinding(item) {
  return pickFields(item, {
    type: { transform: (value) => safeString(value, 50) },
    count: { transform: safeCount },
    level: { transform: (value) => safeString(value, 30) },
    model: { transform: (value) => safeString(value, 220) }
  })
}

function safeLogEntry(item) {
  const result = pickFields(item, {
    id: { transform: (value) => safeString(value, 100) },
    title: { transform: (value) => safeString(value, 180) },
    level: { transform: (value) => safeString(value, 30) },
    source: { transform: (value) => safeString(value, 120) },
    category: { transform: (value) => safeString(value, 80) },
    status: { transform: (value) => safeString(value, 40) },
    message: { transform: (value) => safeString(value, 1_000) },
    summary: { transform: (value) => safeString(value, 1_000) },
    rawLength: { transform: safeCount },
    lineCount: { transform: safeCount },
    createdAt: { transform: safeNumber },
    analyzedAt: { transform: safeNumber },
    updatedAt: { transform: safeNumber }
  })
  if (Array.isArray(item?.findings))
    result.findings = item.findings.slice(0, DIAGNOSTIC_LIMITS.logFindings).map(safeLogFinding)
  return result
}

function collection(value) {
  if (Array.isArray(value)) return value
  if (!isObject(value)) return []
  for (const key of [
    'items',
    'events',
    'latest',
    'tasks',
    'targets',
    'watches',
    'history',
    'checks',
    'records',
    'entries'
  ]) {
    if (Array.isArray(value[key])) return value[key]
  }
  return []
}

function safeAppSnapshot(value) {
  return pickFields(value, {
    name: { transform: (entry) => safeString(entry, 120) },
    version: { transform: (entry) => safeString(entry, 80) },
    build: { transform: (entry) => safeString(entry, 80) },
    platform: { transform: (entry) => safeString(entry, 30) },
    arch: { transform: (entry) => safeString(entry, 30) },
    electronVersion: { transform: (entry) => safeString(entry, 40) },
    nodeVersion: { transform: (entry) => safeString(entry, 40) },
    isPackaged: { transform: safeBoolean },
    locale: { transform: (entry) => safeString(entry, 40) },
    startedAt: { transform: safeNumber },
    uptimeSeconds: { transform: safeNumber }
  })
}

function safeSystemSnapshot(value) {
  const result = pickFields(value, {
    platform: { transform: (entry) => safeString(entry, 30) },
    arch: { transform: (entry) => safeString(entry, 30) },
    release: { transform: (entry) => safeString(entry, 120) },
    cpuCount: { keys: ['cpuCount', 'cpus'], transform: safeCount },
    memoryTotalBytes: { keys: ['memoryTotalBytes', 'totalMemoryBytes'], transform: safeNumber },
    memoryFreeBytes: { keys: ['memoryFreeBytes', 'freeMemoryBytes'], transform: safeNumber },
    uptimeSeconds: { transform: safeNumber }
  })
  if (Array.isArray(value?.loadAverage))
    result.loadAverage = value.loadAverage
      .slice(0, 3)
      .map(safeNumber)
      .filter((entry) => entry !== undefined)
  return result
}

function normalizeGeneratedAt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return redactDiagnosticText(value, 80)
  return new Date().toISOString()
}

function buildOpsDiagnosticsBundle(input = {}) {
  const source = isObject(input) ? input : {}
  const eventsInput = firstDefined(source.events, source.eventSnapshot, [])
  const automationInput = firstDefined(
    source.automationTasks,
    source.automation?.tasks,
    source.automation,
    []
  )
  const modelMonitorInput = firstDefined(
    source.modelMonitor,
    source.monitor,
    source.model?.monitor,
    {}
  )
  const modelHistoryInput = firstDefined(source.modelHistory, source.model?.history, [])
  const nodeWatchesInput = firstDefined(
    source.nodeWatches,
    source.nodeServices,
    source.node?.watches,
    []
  )
  const nodeHistoryInput = firstDefined(source.nodeHistory, source.node?.history, [])
  const backupHealthInput = firstDefined(
    source.backupHealth,
    source.backup?.health,
    source.backup,
    {}
  )
  const releaseHistoryInput = firstDefined(
    source.releaseHistory,
    source.release?.history,
    source.release,
    []
  )
  const auditInput = firstDefined(source.auditRecords, source.audit?.records, source.audit, [])
  const logInput = firstDefined(source.logEntries, source.logs?.entries, source.logs, [])
  const eventSummaryInput = firstDefined(
    source.eventSummary,
    source.eventTotals,
    source.eventsSummary,
    eventsInput?.summary,
    {}
  )

  const bundle = {
    schema: OPS_DIAGNOSTICS_SCHEMA,
    version: OPS_DIAGNOSTICS_VERSION,
    generatedAt: normalizeGeneratedAt(source.generatedAt),
    app: safeAppSnapshot(firstDefined(source.app, source.appSnapshot, {})),
    system: safeSystemSnapshot(firstDefined(source.system, source.systemSnapshot, {})),
    events: {
      summary: safeSummary(eventSummaryInput),
      items: collection(eventsInput).slice(0, DIAGNOSTIC_LIMITS.eventItems).map(safeEvent)
    },
    automationTasks: collection(automationInput)
      .slice(0, DIAGNOSTIC_LIMITS.automationTasks)
      .map(safeAutomationTask),
    modelMonitor: safeModelMonitor(modelMonitorInput),
    modelHistory: collection(modelHistoryInput)
      .slice(0, DIAGNOSTIC_LIMITS.modelHistory)
      .map(safeModelHistoryEntry),
    nodeWatches: collection(nodeWatchesInput)
      .slice(0, DIAGNOSTIC_LIMITS.nodeWatches)
      .map(safeNodeWatch),
    nodeHistory: collection(nodeHistoryInput)
      .slice(0, DIAGNOSTIC_LIMITS.nodeHistory)
      .map(safeNodeHistoryEntry),
    backupHealth: safeBackupHealth(backupHealthInput),
    releaseHistory: collection(releaseHistoryInput)
      .slice(0, DIAGNOSTIC_LIMITS.releaseHistory)
      .map(safeReleaseEntry),
    auditRecords: collection(auditInput)
      .slice(0, DIAGNOSTIC_LIMITS.auditRecords)
      .map(safeAuditRecord),
    logEntries: collection(logInput).slice(0, DIAGNOSTIC_LIMITS.logEntries).map(safeLogEntry)
  }

  return JSON.parse(JSON.stringify(bundle))
}

module.exports = {
  DIAGNOSTIC_LIMITS,
  OPS_DIAGNOSTICS_SCHEMA,
  OPS_DIAGNOSTICS_VERSION,
  buildOpsDiagnosticsBundle,
  redactDiagnosticText,
  redactDiagnosticValue
}
