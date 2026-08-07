const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./json-store')
const { decryptSecret, encryptSecret, maskSecret } = require('./secure-secret')

const UPDATE_SETTINGS_FILE = 'app-update-settings.json'
const DEFAULT_UPDATE_SETTINGS = Object.freeze({
  autoCheck: true,
  autoDownload: true,
  tokenEncrypted: '',
  lastCheckedAt: ''
})

function getUpdateSettingsPath(userDataPath) {
  if (!userDataPath) throw new Error('应用更新设置缺少数据目录')
  return path.join(userDataPath, UPDATE_SETTINGS_FILE)
}

function sanitizeStoredSettings(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    autoCheck: source.autoCheck !== false,
    autoDownload: source.autoDownload !== false,
    tokenEncrypted: typeof source.tokenEncrypted === 'string' ? source.tokenEncrypted : '',
    lastCheckedAt: typeof source.lastCheckedAt === 'string' ? source.lastCheckedAt.slice(0, 64) : ''
  }
}

function readUpdateSettings(userDataPath) {
  return sanitizeStoredSettings(
    readJsonFile(getUpdateSettingsPath(userDataPath), DEFAULT_UPDATE_SETTINGS)
  )
}

function writeUpdateSettings(userDataPath, settings) {
  const normalized = sanitizeStoredSettings(settings)
  if (!writeJsonFile(getUpdateSettingsPath(userDataPath), normalized)) {
    throw new Error('保存应用更新设置失败')
  }
  return normalized
}

function readGitHubToken({ userDataPath, safeStorage }) {
  const settings = readUpdateSettings(userDataPath)
  if (!settings.tokenEncrypted) return ''
  return decryptSecret(safeStorage, settings.tokenEncrypted)
}

function toPublicUpdateSettings({ userDataPath, safeStorage }) {
  const settings = readUpdateSettings(userDataPath)
  let token = ''
  let credentialError = ''
  if (settings.tokenEncrypted) {
    try {
      token = decryptSecret(safeStorage, settings.tokenEncrypted)
    } catch (error) {
      credentialError = error?.message || '读取 GitHub Token 失败'
    }
  }
  return {
    autoCheck: settings.autoCheck,
    autoDownload: settings.autoDownload,
    tokenConfigured: Boolean(token),
    maskedToken: token ? maskSecret(token) : '',
    credentialError,
    lastCheckedAt: settings.lastCheckedAt
  }
}

function normalizeToken(value) {
  const token = typeof value === 'string' ? value.trim() : ''
  if (!token) return ''
  if (token.length > 512) throw new Error('GitHub Token 长度无效')
  if (/\s/.test(token)) throw new Error('GitHub Token 不能包含空白字符')
  return token
}

function saveUpdateSettings({ userDataPath, safeStorage, input = {} }) {
  const current = readUpdateSettings(userDataPath)
  let tokenEncrypted = current.tokenEncrypted

  if (input.clearToken === true) {
    tokenEncrypted = ''
  } else if (Object.prototype.hasOwnProperty.call(input, 'token')) {
    const token = normalizeToken(input.token)
    if (token) tokenEncrypted = encryptSecret(safeStorage, token)
  }

  const saved = writeUpdateSettings(userDataPath, {
    ...current,
    autoCheck: typeof input.autoCheck === 'boolean' ? input.autoCheck : current.autoCheck,
    autoDownload:
      typeof input.autoDownload === 'boolean' ? input.autoDownload : current.autoDownload,
    tokenEncrypted
  })

  return saved
}

function recordUpdateCheck(userDataPath, checkedAt = new Date().toISOString()) {
  const current = readUpdateSettings(userDataPath)
  return writeUpdateSettings(userDataPath, { ...current, lastCheckedAt: checkedAt })
}

module.exports = {
  DEFAULT_UPDATE_SETTINGS,
  getUpdateSettingsPath,
  normalizeToken,
  readGitHubToken,
  readUpdateSettings,
  recordUpdateCheck,
  saveUpdateSettings,
  sanitizeStoredSettings,
  toPublicUpdateSettings,
  writeUpdateSettings
}
