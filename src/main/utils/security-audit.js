const crypto = require('node:crypto')
const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')

const AUDIT_FILE_NAME = 'security-audit.json'
const AUDIT_STATE_VERSION = 1
const MAX_AUDIT_RECORDS = 1_000
const DEFAULT_LIST_LIMIT = 100
const MAX_TEXT_LENGTH = 512
const MAX_IDENTIFIER_LENGTH = 160
const MAX_METADATA_DEPTH = 3
const MAX_METADATA_KEYS = 32

const ACTOR_KEY_ALIASES = new Map([
  ['type', 'type'],
  ['id', 'id'],
  ['name', 'name'],
  ['source', 'source']
])

const TARGET_KEY_ALIASES = new Map([
  ['id', 'id'],
  ['kind', 'kind'],
  ['type', 'type'],
  ['targetid', 'targetId'],
  ['targettype', 'targetType'],
  ['protocol', 'protocol'],
  ['port', 'port'],
  ['pid', 'pid'],
  ['environment', 'environment'],
  ['providerid', 'providerId'],
  ['profileid', 'profileId'],
  ['releaseid', 'releaseId'],
  ['eventid', 'eventId'],
  ['backupid', 'backupId'],
  ['restorepointid', 'restorePointId'],
  ['taskid', 'taskId'],
  ['planid', 'planId'],
  ['jobid', 'jobId'],
  ['model', 'model'],
  ['apptype', 'appType'],
  ['signal', 'signal'],
  ['operation', 'operation'],
  ['resource', 'resource'],
  ['scope', 'scope'],
  ['mode', 'mode'],
  ['sourcemode', 'sourceMode'],
  ['itemtype', 'itemType'],
  ['contenttype', 'contentType'],
  ['interval', 'interval'],
  ['quality', 'quality'],
  ['platform', 'platform'],
  ['architecture', 'architecture'],
  ['branch', 'branch'],
  ['source', 'source'],
  ['status', 'status'],
  ['count', 'count'],
  ['categorycount', 'categoryCount'],
  ['itemcount', 'itemCount'],
  ['urlcount', 'urlCount'],
  ['pathcount', 'pathCount'],
  ['entrycount', 'entryCount'],
  ['clearcount', 'clearCount'],
  ['retentioncount', 'retentionCount'],
  ['stepcount', 'stepCount'],
  ['filecount', 'fileCount'],
  ['confirmed', 'confirmed'],
  ['enabled', 'enabled'],
  ['clearapikey', 'clearApiKey'],
  ['clearpassword', 'clearPassword'],
  ['hasapikey', 'hasApiKey'],
  ['hasapptype', 'hasAppType'],
  ['hasbackupid', 'hasBackupId'],
  ['hasbaseurl', 'hasBaseUrl'],
  ['haseventid', 'hasEventId'],
  ['hashost', 'hasHost'],
  ['hasmodel', 'hasModel'],
  ['hasoutputdirectory', 'hasOutputDirectory'],
  ['haspassword', 'hasPassword'],
  ['hasprivatekey', 'hasPrivateKey'],
  ['hasprofileid', 'hasProfileId'],
  ['hasprofilename', 'hasProfileName'],
  ['hasprompt', 'hasPrompt'],
  ['hasproviderapptype', 'hasProviderAppType'],
  ['hasproviderid', 'hasProviderId'],
  ['hasreleaseid', 'hasReleaseId'],
  ['hasremotepath', 'hasRemotePath'],
  ['hasrestorepointid', 'hasRestorePointId'],
  ['hasusername', 'hasUsername'],
  ['format', 'format'],
  ['redacted', 'redacted'],
  ['size', 'size'],
  ['ids', 'ids'],
  ['tags', 'tags'],
  ['resources', 'resources']
])

const ARRAY_METADATA_KEYS = new Set(['ids', 'tags', 'resources'])
const BOOLEAN_METADATA_KEYS = new Set([
  'confirmed',
  'enabled',
  'clearApiKey',
  'clearPassword',
  'hasApiKey',
  'hasAppType',
  'hasBackupId',
  'hasBaseUrl',
  'hasEventId',
  'hasHost',
  'hasModel',
  'hasOutputDirectory',
  'hasPassword',
  'hasPrivateKey',
  'hasProfileId',
  'hasProfileName',
  'hasPrompt',
  'hasProviderAppType',
  'hasProviderId',
  'hasReleaseId',
  'hasRemotePath',
  'hasRestorePointId',
  'hasUsername',
  'redacted'
])
const SENSITIVE_KEY_PATTERN =
  /(?:pass(?:word|phrase)?|pwd|token|secret|(?:api|access|refresh|id)?[_-]?key|auth(?:orization)?|credential|cookie|private[_-]?key|client[_-]?secret|raw[_-]?payload|payload|body|headers?)/i
const AUTHORIZATION_SCHEME_PATTERN =
  /(\bauthorization\s*:\s*)(?:bearer|basic|token)\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const CLI_SENSITIVE_ARGUMENT_PATTERN =
  /((?:^|\s)--?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|password|passphrase|secret|authorization|credential)(?:\s+|=))(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const SENSITIVE_ASSIGNMENT_PATTERN =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|key|password|passphrase|secret|authorization|credential|cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const SENSITIVE_QUERY_PATTERN =
  /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|key)=)[^&#\s]+/gi
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi
const PRIVATE_KEY_PATTERN =
  /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g
const KNOWN_TOKEN_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g
const JWT_PATTERN = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const POSIX_PATH_PATTERN =
  /(?:file:\/\/)?\/(?:Users|home|private|tmp|var|opt|etc|Volumes|Applications|Library|usr)\/[^\s"'<>]+/gi
const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:\\|\\\\)[^\s"'<>|]+/g

function getAuditStatePath(userDataPath) {
  if (typeof userDataPath !== 'string' || !userDataPath.trim() || userDataPath.includes('\0')) {
    throw new Error('安全审计缺少有效数据目录')
  }
  return path.join(userDataPath, AUDIT_FILE_NAME)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function redactSensitiveText(value) {
  let text = typeof value === 'string' ? value : String(value ?? '')
  text = text.replace(PRIVATE_KEY_PATTERN, '[REDACTED_PRIVATE_KEY]')
  text = text.replace(AUTHORIZATION_SCHEME_PATTERN, '$1[REDACTED]')
  text = text.replace(CLI_SENSITIVE_ARGUMENT_PATTERN, '$1[REDACTED]')
  text = text.replace(SENSITIVE_ASSIGNMENT_PATTERN, '$1[REDACTED]')
  text = text.replace(SENSITIVE_QUERY_PATTERN, '$1[REDACTED]')
  text = text.replace(BEARER_PATTERN, 'Bearer [REDACTED]')
  text = text.replace(KNOWN_TOKEN_PATTERN, '[REDACTED_TOKEN]')
  text = text.replace(JWT_PATTERN, '[REDACTED_TOKEN]')
  text = text.replace(POSIX_PATH_PATTERN, '[REDACTED_PATH]')
  text = text.replace(WINDOWS_PATH_PATTERN, '[REDACTED_PATH]')
  return text.slice(0, MAX_TEXT_LENGTH)
}

function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const text = redactSensitiveText(value).trim()
  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(text)
      if (isObject(parsed) || Array.isArray(parsed)) return ''
    } catch {}
  }
  return text.slice(0, maxLength)
}

function sanitizeIdentifier(value, fallback = '') {
  const text = sanitizeText(value, MAX_IDENTIFIER_LENGTH)
    .replace(/[^A-Za-z0-9._:@/-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_./:-]+|[_./:-]+$/g, '')
  return text || fallback
}

function sanitizePrimitive(value) {
  if (typeof value === 'string') return sanitizeText(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  return undefined
}

function sanitizeMetadataObject(value, aliases, depth = 0) {
  if (!isObject(value) || depth > MAX_METADATA_DEPTH) return {}

  const result = {}
  let keyCount = 0
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (keyCount >= MAX_METADATA_KEYS || typeof rawKey !== 'string') break
    const canonicalKey = aliases.get(rawKey.toLowerCase())
    if (!canonicalKey) continue

    let normalizedValue
    if (BOOLEAN_METADATA_KEYS.has(canonicalKey)) {
      normalizedValue = typeof rawValue === 'boolean' ? rawValue : undefined
    } else if (SENSITIVE_KEY_PATTERN.test(rawKey)) {
      continue
    } else if (ARRAY_METADATA_KEYS.has(canonicalKey) && Array.isArray(rawValue)) {
      normalizedValue = rawValue
        .slice(0, MAX_METADATA_KEYS)
        .map(sanitizePrimitive)
        .filter((value) => value !== undefined)
    } else if (isObject(rawValue)) {
      normalizedValue = sanitizeMetadataObject(rawValue, aliases, depth + 1)
    } else {
      normalizedValue = sanitizePrimitive(rawValue)
    }

    if (normalizedValue === undefined) continue
    if (typeof normalizedValue === 'string' && !normalizedValue) continue
    if (isObject(normalizedValue) && Object.keys(normalizedValue).length === 0) continue
    result[canonicalKey] = normalizedValue
    keyCount += 1
  }
  return result
}

function sanitizeActor(actor) {
  if (typeof actor === 'string' || typeof actor === 'number') {
    const id = sanitizeIdentifier(actor)
    return id ? { id } : {}
  }
  return sanitizeMetadataObject(actor, ACTOR_KEY_ALIASES)
}

function sanitizeTargetMetadata(target) {
  if (typeof target === 'string' || typeof target === 'number') {
    const id = sanitizeIdentifier(target)
    return id ? { id } : {}
  }
  return sanitizeMetadataObject(target, TARGET_KEY_ALIASES)
}

function normalizeTimestamp(value, fallback = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? fallback)
  if (Number.isNaN(date.getTime())) return new Date(fallback).toISOString()
  return date.toISOString()
}

function timestampMilliseconds(value) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function normalizeStatus(value, fallback = 'started') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (['started', 'start', 'pending', 'running', 'in-progress'].includes(normalized)) {
    return 'started'
  }
  if (['succeeded', 'success', 'successful', 'completed', 'complete', 'ok'].includes(normalized)) {
    return 'succeeded'
  }
  if (['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled'].includes(normalized)) {
    return 'failed'
  }
  return fallback
}

function sanitizeError(error, errorCode, errorMessage, fallbackCode = '') {
  const source = error instanceof Error ? error : isObject(error) ? error : {}
  const sourceMessage =
    errorMessage ?? (typeof error === 'string' ? error : (source.message ?? source.errorMessage))
  const code = sanitizeIdentifier(errorCode ?? source.code ?? source.errorCode, '')
  const message = sanitizeText(sourceMessage)
  if (!code && !message) return null
  return {
    code: code || fallbackCode,
    message
  }
}

function normalizeRecord(record) {
  if (!isObject(record)) return null
  const auditId = sanitizeIdentifier(record.auditId ?? record.id, '')
  if (!auditId) return null

  const status = normalizeStatus(record.status, 'started')
  const startedAt = normalizeTimestamp(record.startedAt, new Date(0))
  const finishedAt = record.finishedAt ? normalizeTimestamp(record.finishedAt, new Date(0)) : ''
  const startedMilliseconds = timestampMilliseconds(startedAt)
  const finishedMilliseconds = timestampMilliseconds(finishedAt)
  const durationMs =
    finishedMilliseconds && startedMilliseconds
      ? Math.max(0, finishedMilliseconds - startedMilliseconds)
      : Math.max(0, Number(record.durationMs) || 0)
  const error =
    status === 'failed'
      ? sanitizeError(record.error, record.errorCode, record.errorMessage, 'AUDIT_OPERATION_FAILED')
      : null

  return {
    auditId,
    action: sanitizeIdentifier(record.action, 'unknown'),
    category: sanitizeIdentifier(record.category, 'unknown'),
    channel: sanitizeIdentifier(record.channel, 'unknown'),
    requestId: sanitizeIdentifier(record.requestId, auditId),
    actor: sanitizeActor(record.actor),
    status,
    startedAt,
    finishedAt,
    durationMs,
    target: sanitizeTargetMetadata(record.target),
    error
  }
}

function readAuditState(userDataPath) {
  const state = readJsonFile(getAuditStatePath(userDataPath), {
    version: AUDIT_STATE_VERSION,
    records: []
  })
  const sourceRecords = Array.isArray(state) ? state : state?.records
  const records = (Array.isArray(sourceRecords) ? sourceRecords : [])
    .map(normalizeRecord)
    .filter(Boolean)
    .slice(-MAX_AUDIT_RECORDS)
  return { version: AUDIT_STATE_VERSION, records }
}

function writeAuditState(userDataPath, state) {
  const normalized = {
    version: AUDIT_STATE_VERSION,
    records: (Array.isArray(state?.records) ? state.records : [])
      .map(normalizeRecord)
      .filter(Boolean)
      .slice(-MAX_AUDIT_RECORDS)
  }
  if (!writeJsonFile(getAuditStatePath(userDataPath), normalized)) {
    const error = new Error('保存安全审计记录失败')
    error.code = 'AUDIT_PERSISTENCE_FAILED'
    throw error
  }
  return normalized
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeCall(input, details) {
  if (typeof input === 'string')
    return { userDataPath: input, ...(isObject(details) ? details : {}) }
  return isObject(input) ? input : {}
}

function startAudit(input, details) {
  const options = normalizeCall(input, details)
  const state = readAuditState(options.userDataPath)
  const startedAt = normalizeTimestamp(options.now ?? options.startedAt)
  const auditId = sanitizeIdentifier(options.auditId ?? options.id, '') || crypto.randomUUID()
  const requestId = sanitizeIdentifier(options.requestId, auditId)
  const record = {
    auditId,
    action: sanitizeIdentifier(options.action, 'unknown'),
    category: sanitizeIdentifier(options.category, 'unknown'),
    channel: sanitizeIdentifier(options.channel, 'unknown'),
    requestId,
    actor: sanitizeActor(options.actor),
    status: 'started',
    startedAt,
    finishedAt: '',
    durationMs: 0,
    target: sanitizeTargetMetadata(options.target ?? options.targetMetadata),
    error: null
  }
  state.records.push(record)
  writeAuditState(options.userDataPath, state)
  return clone(record)
}

function normalizeFinishCall(input, correlationOrDetails, details) {
  if (typeof input !== 'string') return normalizeCall(input, correlationOrDetails)
  if (typeof correlationOrDetails === 'string') {
    return {
      userDataPath: input,
      auditId: correlationOrDetails,
      ...(isObject(details) ? details : {})
    }
  }
  return { userDataPath: input, ...(isObject(correlationOrDetails) ? correlationOrDetails : {}) }
}

function finishAudit(input, correlationOrDetails, details) {
  const options = normalizeFinishCall(input, correlationOrDetails, details)
  const state = readAuditState(options.userDataPath)
  const auditId = sanitizeIdentifier(options.auditId ?? options.id, '')
  const requestId = sanitizeIdentifier(options.requestId, '')
  let index = -1

  if (auditId) {
    index = state.records.findIndex((record) => record.auditId === auditId)
  } else if (requestId) {
    for (let cursor = state.records.length - 1; cursor >= 0; cursor -= 1) {
      if (
        state.records[cursor].requestId === requestId &&
        state.records[cursor].status === 'started'
      ) {
        index = cursor
        break
      }
    }
  }

  if (index < 0) {
    const error = new Error('未找到可完成的安全审计记录')
    error.code = 'AUDIT_RECORD_NOT_FOUND'
    throw error
  }

  const record = state.records[index]
  const finishedAt = normalizeTimestamp(options.now ?? options.finishedAt)
  const status = normalizeStatus(
    options.status,
    options.error || options.errorCode || options.errorMessage ? 'failed' : 'succeeded'
  )
  const startedMilliseconds = timestampMilliseconds(record.startedAt)
  const finishedMilliseconds = timestampMilliseconds(finishedAt)
  const error =
    status === 'failed'
      ? sanitizeError(
          options.error,
          options.errorCode,
          options.errorMessage,
          'AUDIT_OPERATION_FAILED'
        )
      : null

  const updated = {
    ...record,
    status: status === 'started' ? 'succeeded' : status,
    finishedAt,
    durationMs: Math.max(0, finishedMilliseconds - startedMilliseconds),
    target:
      options.target !== undefined || options.targetMetadata !== undefined
        ? sanitizeTargetMetadata(options.target ?? options.targetMetadata)
        : record.target,
    error
  }
  state.records[index] = updated
  writeAuditState(options.userDataPath, state)
  return clone(updated)
}

function filterAuditRecords(records, filters = {}) {
  const normalizedStatus = filters.status ? normalizeStatus(filters.status, '') : ''
  const normalizedAction = filters.action ? sanitizeIdentifier(filters.action, '') : ''
  const normalizedCategory = filters.category ? sanitizeIdentifier(filters.category, '') : ''
  const normalizedChannel = filters.channel ? sanitizeIdentifier(filters.channel, '') : ''
  const normalizedRequestId = filters.requestId ? sanitizeIdentifier(filters.requestId, '') : ''
  const normalizedActorId = filters.actorId ? sanitizeIdentifier(filters.actorId, '') : ''
  const fromMilliseconds =
    filters.from || filters.fromAt
      ? timestampMilliseconds(normalizeTimestamp(filters.from ?? filters.fromAt))
      : 0
  const toMilliseconds =
    filters.to || filters.toAt
      ? timestampMilliseconds(normalizeTimestamp(filters.to ?? filters.toAt))
      : 0

  return records.filter((record) => {
    if (normalizedStatus && record.status !== normalizedStatus) return false
    if (normalizedAction && record.action !== normalizedAction) return false
    if (normalizedCategory && record.category !== normalizedCategory) return false
    if (normalizedChannel && record.channel !== normalizedChannel) return false
    if (normalizedRequestId && record.requestId !== normalizedRequestId) return false
    if (normalizedActorId && record.actor.id !== normalizedActorId) return false
    const startedMilliseconds = timestampMilliseconds(record.startedAt)
    if (fromMilliseconds && startedMilliseconds < fromMilliseconds) return false
    if (toMilliseconds && startedMilliseconds > toMilliseconds) return false
    return true
  })
}

function listAuditRecords(input, filters) {
  const options = normalizeCall(input, filters)
  const filterOptions = isObject(options.filters) ? { ...options.filters, ...options } : options
  const state = readAuditState(options.userDataPath)
  const filtered = filterAuditRecords(state.records, filterOptions)
  const ordered = options.order === 'asc' ? filtered : filtered.slice().reverse()
  const limitValue = Number(options.limit)
  const limit = Number.isFinite(limitValue)
    ? Math.max(0, Math.min(MAX_AUDIT_RECORDS, Math.trunc(limitValue)))
    : DEFAULT_LIST_LIMIT
  return clone(ordered.slice(0, limit))
}

module.exports = {
  AUDIT_FILE_NAME,
  AUDIT_STATE_VERSION,
  DEFAULT_LIST_LIMIT,
  MAX_AUDIT_RECORDS,
  finishAudit,
  filterAuditRecords,
  getAuditStatePath,
  listAuditRecords,
  normalizeStatus,
  readAuditState,
  redactSensitiveText,
  sanitizeActor,
  sanitizeAuditMetadata: sanitizeTargetMetadata,
  sanitizeError,
  sanitizeTargetMetadata,
  startAudit,
  writeAuditState
}
