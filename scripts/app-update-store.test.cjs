const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  getUpdateSettingsPath,
  readGitHubToken,
  saveUpdateSettings,
  toPublicUpdateSettings
} = require('../src/main/utils/app-update-store')

function createFakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => {
      const text = Buffer.from(value).toString('utf8')
      if (!text.startsWith('encrypted:')) throw new Error('invalid encrypted value')
      return text.slice('encrypted:'.length)
    }
  }
}

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-app-update-store-'))
  try {
    return callback(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('stores GitHub token encrypted and only exposes a masked value', () => {
  withTempDirectory((userDataPath) => {
    const safeStorage = createFakeSafeStorage()
    saveUpdateSettings({
      userDataPath,
      safeStorage,
      input: { token: 'github_pat_example_secret', autoCheck: false, autoDownload: true }
    })

    const rawFile = fs.readFileSync(getUpdateSettingsPath(userDataPath), 'utf8')
    assert.equal(rawFile.includes('github_pat_example_secret'), false)
    assert.equal(readGitHubToken({ userDataPath, safeStorage }), 'github_pat_example_secret')
    assert.deepEqual(toPublicUpdateSettings({ userDataPath, safeStorage }), {
      autoCheck: false,
      autoDownload: true,
      tokenConfigured: true,
      maskedToken: 'git••••cret',
      credentialError: '',
      lastCheckedAt: ''
    })
  })
})

test('preserves an existing token when saving toggles and clears it only explicitly', () => {
  withTempDirectory((userDataPath) => {
    const safeStorage = createFakeSafeStorage()
    saveUpdateSettings({ userDataPath, safeStorage, input: { token: 'ghp_existing_token' } })
    saveUpdateSettings({
      userDataPath,
      safeStorage,
      input: { autoCheck: false, autoDownload: false }
    })
    assert.equal(readGitHubToken({ userDataPath, safeStorage }), 'ghp_existing_token')

    saveUpdateSettings({ userDataPath, safeStorage, input: { clearToken: true } })
    assert.equal(readGitHubToken({ userDataPath, safeStorage }), '')
    assert.equal(toPublicUpdateSettings({ userDataPath, safeStorage }).tokenConfigured, false)
  })
})

test('reports corrupted encrypted credentials without exposing stored data', () => {
  withTempDirectory((userDataPath) => {
    const safeStorage = createFakeSafeStorage()
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.writeFileSync(
      getUpdateSettingsPath(userDataPath),
      JSON.stringify({ tokenEncrypted: 'safe-storage:v1:not-valid-base64' }),
      'utf8'
    )

    const settings = toPublicUpdateSettings({ userDataPath, safeStorage })
    assert.equal(settings.tokenConfigured, false)
    assert.equal(settings.maskedToken, '')
    assert.match(settings.credentialError, /invalid encrypted value/)
  })
})
