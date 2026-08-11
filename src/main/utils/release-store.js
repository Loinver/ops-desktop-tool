const path = require('node:path')
const crypto = require('node:crypto')
const { app, safeStorage } = require('electron')
const { readJsonFile, writeJsonFile } = require('./json-store')
const { encryptSecret, maskSecret, readSecretField } = require('./secure-secret')
const { DEFAULT_RELEASE_IGNORE_RULES, normalizeRuleLines } = require('./release-ignore')

const MAX_RELEASE_HISTORY = 100

function normalizeHostFingerprint(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const hex = raw.replace(/[\s:]/g, '')
  if (/^[0-9a-f]{64}$/i.test(hex)) {
    return `SHA256:${Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, '')}`
  }

  const match = raw.replace(/\s+/g, '').match(/^sha256:([a-z0-9+/]+={0,2})$/i)
  if (!match) {
    throw new Error('SSH 主机指纹格式无效，请使用 SHA256:<base64> 或 64 位 hex（可含冒号）')
  }

  const encoded = match[1]
  if (encoded.length % 4 === 1) {
    throw new Error('SSH 主机指纹格式无效，请使用 SHA256:<base64> 或 64 位 hex（可含冒号）')
  }
  const digest = Buffer.from(encoded, 'base64')
  if (digest.length !== 32) {
    throw new Error('SSH 主机指纹格式无效，请使用 SHA256:<base64> 或 64 位 hex（可含冒号）')
  }

  return `SHA256:${digest.toString('base64').replace(/=+$/, '')}`
}

function profilesPath() {
  return path.join(app.getPath('userData'), 'release-profiles.json')
}

function historyPath() {
  return path.join(app.getPath('userData'), 'release-history.json')
}

function normalizeHealthCheck(value = {}) {
  const raw = value && typeof value === 'object' ? value : {}
  const url = String(raw.url || '')
    .trim()
    .slice(0, 2048)
  const enabled = Boolean(raw.enabled) && Boolean(url)
  return {
    enabled,
    url,
    expectedStatus: Math.max(100, Math.min(599, Number(raw.expectedStatus) || 200)),
    timeoutMs: Math.max(1000, Math.min(60_000, Number(raw.timeoutMs) || 8000)),
    autoRollback: enabled && Boolean(raw.autoRollback)
  }
}

function assertValidHealthCheck(value = {}) {
  const raw = value && typeof value === 'object' ? value : {}
  if (!raw.enabled) return normalizeHealthCheck(raw)
  const normalized = normalizeHealthCheck(raw)
  if (!normalized.url) throw new Error('启用发布后健康检查时必须填写 HTTP/HTTPS 地址')
  let parsed
  try {
    parsed = new URL(normalized.url)
  } catch {
    throw new Error('健康检查地址格式无效')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('健康检查仅支持不含账号密码的 HTTP/HTTPS 地址')
  }
  return { ...normalized, url: parsed.toString() }
}

function normalizeProfileRecord(profile = {}) {
  return {
    id: String(profile.id || crypto.randomUUID()),
    name:
      String(profile.name || '默认环境')
        .trim()
        .slice(0, 40) || '默认环境',
    host: String(profile.host || '')
      .trim()
      .slice(0, 255),
    port: Math.min(65535, Math.max(1, Number(profile.port) || 22)),
    username: String(profile.username || '')
      .trim()
      .slice(0, 128),
    hostFingerprint: normalizeHostFingerprint(profile.hostFingerprint),
    passwordEncrypted: String(profile.passwordEncrypted || ''),
    localDir: String(profile.localDir || '')
      .trim()
      .slice(0, 4096),
    remoteDir: String(profile.remoteDir || '')
      .trim()
      .slice(0, 4096),
    ignoreRules: normalizeRuleLines(
      profile.ignoreRules?.length ? profile.ignoreRules : DEFAULT_RELEASE_IGNORE_RULES
    ),
    healthCheck: normalizeHealthCheck(profile.healthCheck),
    createdAt: Number(profile.createdAt) || Date.now(),
    updatedAt: Number(profile.updatedAt) || Date.now()
  }
}

function loadReleaseProfileState() {
  const stored = readJsonFile(profilesPath(), { version: 1, activeProfileId: '', profiles: [] })
  const profiles = Array.isArray(stored?.profiles)
    ? stored.profiles.map(normalizeProfileRecord)
    : []
  const activeProfileId = profiles.some((item) => item.id === stored?.activeProfileId)
    ? stored.activeProfileId
    : profiles[0]?.id || ''
  return { version: 1, activeProfileId, profiles }
}

function saveReleaseProfileState(state) {
  return writeJsonFile(profilesPath(), {
    version: 1,
    activeProfileId: state.activeProfileId || '',
    profiles: state.profiles.map(normalizeProfileRecord)
  })
}

function readProfilePassword(profile) {
  if (!profile) return ''
  return readSecretField({
    safeStorage,
    record: profile,
    encryptedKey: 'passwordEncrypted',
    legacyKey: 'password'
  }).value
}

function safeProfile(profile = {}) {
  const hasHostFingerprint = Object.prototype.hasOwnProperty.call(profile, 'hostFingerprint')
  const { passwordEncrypted, password: legacyPassword, hostFingerprint, ...rest } = profile
  const legacyValue = String(legacyPassword || '')
  const hasEncryptedPassword = Boolean(passwordEncrypted)
  const hasPassword = hasEncryptedPassword || Boolean(legacyValue)

  // 列表、仪表盘等只需要凭证是否已保存，不能为了生成掩码而触发 macOS 钥匙串解密。
  // 真正建立 SFTP 连接时才由 getActiveReleaseProfile({ includePassword: true }) 读取明文。
  return {
    ...rest,
    ...(hasHostFingerprint ? { hostFingerprint: normalizeHostFingerprint(hostFingerprint) } : {}),
    hasPassword,
    passwordMasked: hasEncryptedPassword ? '••••••••' : maskSecret(legacyValue)
  }
}

function listReleaseProfiles() {
  const state = loadReleaseProfileState()
  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map(safeProfile)
  }
}

function getActiveReleaseProfile({ includePassword = false } = {}) {
  const state = loadReleaseProfileState()
  const profile = state.profiles.find((item) => item.id === state.activeProfileId) || null
  if (!profile) return null
  return includePassword
    ? { ...profile, password: readProfilePassword(profile) }
    : safeProfile(profile)
}

function saveReleaseProfile(input = {}) {
  const state = loadReleaseProfileState()
  const existing = state.profiles.find((item) => item.id === input.id)
  const suppliedPassword = String(input.password || '')
  let passwordEncrypted = existing?.passwordEncrypted || ''
  if (input.clearPassword) passwordEncrypted = ''
  else if (suppliedPassword) passwordEncrypted = encryptSecret(safeStorage, suppliedPassword)

  const healthCheck = assertValidHealthCheck(
    input.healthCheck === undefined ? existing?.healthCheck : input.healthCheck
  )
  const profile = normalizeProfileRecord({
    ...existing,
    ...input,
    healthCheck,
    id: existing?.id || input.id || crypto.randomUUID(),
    passwordEncrypted,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now()
  })
  delete profile.password

  const index = state.profiles.findIndex((item) => item.id === profile.id)
  if (index >= 0) state.profiles[index] = profile
  else state.profiles.push(profile)
  state.activeProfileId = profile.id
  if (!saveReleaseProfileState(state)) throw new Error('保存发布环境失败')
  return safeProfile(profile)
}

function activateReleaseProfile(profileId) {
  const state = loadReleaseProfileState()
  if (!state.profiles.some((item) => item.id === profileId)) throw new Error('发布环境不存在')
  state.activeProfileId = profileId
  if (!saveReleaseProfileState(state)) throw new Error('切换发布环境失败')
  return safeProfile(state.profiles.find((item) => item.id === profileId))
}

function deleteReleaseProfile(profileId) {
  const state = loadReleaseProfileState()
  if (state.profiles.length <= 1) throw new Error('至少保留一个发布环境')
  const next = state.profiles.filter((item) => item.id !== profileId)
  if (next.length === state.profiles.length) throw new Error('发布环境不存在')
  state.profiles = next
  if (state.activeProfileId === profileId) state.activeProfileId = next[0].id
  if (!saveReleaseProfileState(state)) throw new Error('删除发布环境失败')
  return listReleaseProfiles()
}

function filterReleaseHistoryByProfile(history, profileId) {
  const normalizedProfileId = String(profileId || '').trim()
  if (!normalizedProfileId) return history
  return history.filter((item) => String(item?.profileId || '') === normalizedProfileId)
}

function loadReleaseHistory({ profileId } = {}) {
  const value = readJsonFile(historyPath(), [])
  const history = Array.isArray(value) ? value.slice(0, MAX_RELEASE_HISTORY) : []
  return filterReleaseHistoryByProfile(history, profileId)
}

function appendReleaseHistory(record = {}) {
  const history = loadReleaseHistory()
  const entry = {
    id: String(record.id || crypto.randomUUID()),
    profileId: String(record.profileId || ''),
    profileName: String(record.profileName || ''),
    action: record.action === 'rollback' ? 'rollback' : 'deploy',
    status: ['success', 'failed', 'rolled-back'].includes(record.status) ? record.status : 'failed',
    label: String(record.label || '发布任务').slice(0, 200),
    remoteDir: String(record.remoteDir || ''),
    archiveRoots: Array.isArray(record.archiveRoots)
      ? record.archiveRoots.map(String).slice(0, 100)
      : [],
    backupPath: String(record.backupPath || ''),
    sourceReleaseId: String(record.sourceReleaseId || ''),
    entryCount: Number(record.entryCount || 0),
    zipSize: Number(record.zipSize || 0),
    message: String(record.message || '').slice(0, 1000),
    startedAt: Number(record.startedAt) || Date.now(),
    finishedAt: Number(record.finishedAt) || Date.now()
  }
  history.unshift(entry)
  if (!writeJsonFile(historyPath(), history.slice(0, MAX_RELEASE_HISTORY))) {
    throw new Error('保存发布历史失败')
  }
  return entry
}

function markReleaseRolledBack(releaseId) {
  const history = loadReleaseHistory()
  const target = history.find((item) => item.id === releaseId)
  if (!target) throw new Error('发布记录不存在')
  target.status = 'rolled-back'
  target.rolledBackAt = Date.now()
  if (!writeJsonFile(historyPath(), history)) throw new Error('更新发布历史失败')
  return target
}

module.exports = {
  normalizeHostFingerprint,
  listReleaseProfiles,
  getActiveReleaseProfile,
  saveReleaseProfile,
  activateReleaseProfile,
  deleteReleaseProfile,
  loadReleaseHistory,
  appendReleaseHistory,
  markReleaseRolledBack,
  __testables: {
    filterReleaseHistoryByProfile,
    normalizeHealthCheck,
    normalizeHostFingerprint,
    normalizeProfileRecord,
    safeProfile
  }
}
