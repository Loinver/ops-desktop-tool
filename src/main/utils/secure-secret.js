const ENCRYPTED_SECRET_PREFIX = 'safe-storage:v1:'

function assertEncryptionAvailable(safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    throw new Error('当前运行环境不支持安全凭证存储')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储尚不可用，请在桌面环境登录后重试')
  }
}

function encryptSecret(safeStorage, value) {
  const plainText = String(value || '')
  if (!plainText) return ''

  assertEncryptionAvailable(safeStorage)
  const encrypted = safeStorage.encryptString(plainText)
  return `${ENCRYPTED_SECRET_PREFIX}${Buffer.from(encrypted).toString('base64')}`
}

function decryptSecret(safeStorage, value) {
  const storedValue = String(value || '')
  if (!storedValue) return ''
  if (!storedValue.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    throw new Error('凭证格式无效')
  }

  assertEncryptionAvailable(safeStorage)
  const payload = storedValue.slice(ENCRYPTED_SECRET_PREFIX.length)
  if (!payload) throw new Error('凭证内容为空')
  return safeStorage.decryptString(Buffer.from(payload, 'base64'))
}

function readSecretField({ safeStorage, record = {}, encryptedKey, legacyKey }) {
  const encryptedValue = record?.[encryptedKey]
  if (encryptedValue) {
    return {
      value: decryptSecret(safeStorage, encryptedValue),
      needsMigration: false
    }
  }

  const legacyValue = String(record?.[legacyKey] || '')
  return {
    value: legacyValue,
    needsMigration: Boolean(legacyValue)
  }
}

function maskSecret(value) {
  const secret = String(value || '')
  if (!secret) return ''
  if (secret.length <= 8) return '••••••••'
  return `${secret.slice(0, 3)}••••${secret.slice(-4)}`
}

module.exports = {
  ENCRYPTED_SECRET_PREFIX,
  encryptSecret,
  decryptSecret,
  readSecretField,
  maskSecret
}
