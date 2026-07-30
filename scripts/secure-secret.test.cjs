const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ENCRYPTED_SECRET_PREFIX,
  encryptSecret,
  decryptSecret,
  readSecretField,
  maskSecret,
} = require('../src/main/utils/secure-secret')

function createFakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: value => value.toString('utf8').replace(/^encrypted:/, ''),
  }
}

test('安全凭证可以加密并解密', () => {
  const safeStorage = createFakeSafeStorage()
  const encrypted = encryptSecret(safeStorage, 'sk-secret-value')
  assert.match(encrypted, new RegExp(`^${ENCRYPTED_SECRET_PREFIX}`))
  assert.equal(encrypted.includes('sk-secret-value'), false)
  assert.equal(decryptSecret(safeStorage, encrypted), 'sk-secret-value')
})

test('安全存储不可用时拒绝保存明文凭证', () => {
  assert.throws(
    () => encryptSecret(createFakeSafeStorage(false), 'secret'),
    /安全存储尚不可用/,
  )
})

test('旧版明文字段会被标记为待迁移', () => {
  const result = readSecretField({
    safeStorage: createFakeSafeStorage(),
    record: { apiKey: 'legacy-key' },
    encryptedKey: 'apiKeyEncrypted',
    legacyKey: 'apiKey',
  })
  assert.deepEqual(result, { value: 'legacy-key', needsMigration: true })
})

test('凭证掩码不暴露完整内容', () => {
  assert.equal(maskSecret('sk-1234567890'), 'sk-••••7890')
  assert.equal(maskSecret('short'), '••••••••')
  assert.equal(maskSecret(''), '')
})
