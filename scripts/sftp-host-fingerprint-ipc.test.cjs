const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const HEX_FINGERPRINT = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const OPENSSH_FINGERPRINT = 'SHA256:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-sftp-fingerprint-ipc-'))
const handlers = new Map()
const originalLoad = Module._load
const clientModulePath = require.resolve('ssh2-sftp-client')
const originalClientModule = require.cache[clientModulePath]

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8').slice('encrypted:'.length)
}

class FakeSftpClient {
  async connect(config) {
    this.config = config
    if (!config.hostVerifier(HEX_FINGERPRINT)) {
      const error = new Error('Host denied')
      error.code = 'ERR_HOST_KEY_NOT_VERIFIED'
      throw error
    }
    this.connected = true
  }

  async list() {
    if (!this.connected) throw new Error('not connected')
    return []
  }

  async end() {
    this.connected = false
  }
}

const fakeElectron = {
  app: { getPath: () => userDataPath },
  safeStorage: fakeSafeStorage,
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }
}

Module._load = function loadWithSftpMocks(request, parent, isMain) {
  if (request === 'electron') return fakeElectron
  return originalLoad.call(this, request, parent, isMain)
}
require.cache[clientModulePath] = {
  id: clientModulePath,
  filename: clientModulePath,
  loaded: true,
  exports: FakeSftpClient
}

const { IPC_CHANNELS } = require('../src/shared/ipc-channels')
const { registerSftpHandlers } = require('../src/main/ipc/sftp')
registerSftpHandlers()

const testConnection = handlers.get(IPC_CHANNELS.SFTP_TEST)
const saveConfig = handlers.get(IPC_CHANNELS.SFTP_CONFIG_SAVE)

test.after(() => {
  Module._load = originalLoad
  if (originalClientModule) require.cache[clientModulePath] = originalClientModule
  else delete require.cache[clientModulePath]
  for (const key of [
    'SFTP_HOST',
    'SFTP_PORT',
    'SFTP_USERNAME',
    'SFTP_PASSWORD',
    'SFTP_HOST_FINGERPRINT'
  ]) {
    delete process.env[key]
  }
  fs.rmSync(userDataPath, { recursive: true, force: true })
})

test('SFTP test returns an observable fingerprint before trust, then verifies match and mismatch', async () => {
  process.env.SFTP_HOST = 'example.com'
  process.env.SFTP_USERNAME = 'deploy'
  delete process.env.SFTP_HOST_FINGERPRINT

  const missing = await testConnection()
  assert.equal(missing.success, false)
  assert.equal(missing.code, 'SFTP_HOST_FINGERPRINT_REQUIRED')
  assert.equal(missing.observedFingerprint, OPENSSH_FINGERPRINT)
  assert.equal(missing.fingerprint, OPENSSH_FINGERPRINT)
  assert.equal(missing.canConfirm, true)
  assert.match(missing.error, /未配置 SSH 主机指纹/)

  delete process.env.SFTP_HOST
  delete process.env.SFTP_USERNAME
  const saved = await saveConfig(null, {
    host: 'example.com',
    username: 'deploy',
    hostFingerprint: OPENSSH_FINGERPRINT
  })
  assert.equal(saved.success, true)
  assert.equal(saved.data.hostFingerprint, OPENSSH_FINGERPRINT)
  assert.equal('password' in saved.data, true)
  assert.equal(saved.data.password, '')

  const matching = await testConnection()
  assert.equal(matching.success, true)
  assert.equal(matching.fingerprint, OPENSSH_FINGERPRINT)

  const mismatchedSave = await saveConfig(null, {
    host: 'example.com',
    username: 'deploy',
    hostFingerprint: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  })
  assert.equal(mismatchedSave.success, true)

  const mismatched = await testConnection()
  assert.equal(mismatched.success, false)
  assert.equal(mismatched.code, 'SFTP_HOST_FINGERPRINT_MISMATCH')
  assert.equal(mismatched.observedFingerprint, OPENSSH_FINGERPRINT)
  assert.match(mismatched.error, /SSH 主机指纹不匹配/)
})
