const assert = require('node:assert/strict')
const test = require('node:test')

const { __testables: sftpTestables } = require('../src/main/ipc/sftp')
const { __testables: releaseTestables } = require('../src/main/utils/release-store')

const HEX_FINGERPRINT = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const COLON_HEX_FINGERPRINT = HEX_FINGERPRINT.match(/.{2}/g).join(':')
const OPENSSH_FINGERPRINT = 'SHA256:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

test('normalizes OpenSSH and hex SHA-256 host fingerprints to one format', () => {
  assert.equal(releaseTestables.normalizeHostFingerprint(OPENSSH_FINGERPRINT), OPENSSH_FINGERPRINT)
  assert.equal(releaseTestables.normalizeHostFingerprint(HEX_FINGERPRINT), OPENSSH_FINGERPRINT)
  assert.equal(
    releaseTestables.normalizeHostFingerprint(COLON_HEX_FINGERPRINT),
    OPENSSH_FINGERPRINT
  )
  assert.throws(
    () => releaseTestables.normalizeHostFingerprint('SHA256:not-a-fingerprint'),
    /SSH 主机指纹格式无效/
  )
})

test('rejects an unconfigured host and exposes the observed fingerprint', () => {
  let observedFingerprint = ''
  const { config, getObservedFingerprint } = sftpTestables.createSftpConnectionConfig(
    { host: 'example.com', username: 'deploy', hostFingerprint: '' },
    { onObserved: (value) => (observedFingerprint = value) }
  )

  assert.equal(config.hostHash, 'sha256')
  assert.equal(config.hostVerifier(HEX_FINGERPRINT), false)
  assert.equal(getObservedFingerprint(), OPENSSH_FINGERPRINT)
  assert.equal(observedFingerprint, OPENSSH_FINGERPRINT)
  const error = sftpTestables.createHostFingerprintError({
    code: 'SFTP_HOST_FINGERPRINT_REQUIRED',
    observedFingerprint: getObservedFingerprint()
  })
  assert.equal(error.code, 'SFTP_HOST_FINGERPRINT_REQUIRED')
  assert.equal(error.expectedFingerprint, '')
  assert.equal(error.observedFingerprint, OPENSSH_FINGERPRINT)
  assert.equal(error.fingerprint, OPENSSH_FINGERPRINT)
  assert.match(error.message, /未配置 SSH 主机指纹/)
})

test('accepts a matching SHA-256 host fingerprint', () => {
  const { config } = sftpTestables.createSftpConnectionConfig({
    host: 'example.com',
    username: 'deploy',
    hostFingerprint: COLON_HEX_FINGERPRINT
  })

  assert.equal(config.hostVerifier(HEX_FINGERPRINT), true)
})

test('rejects a mismatched SHA-256 host fingerprint', () => {
  const { config, getObservedFingerprint } = sftpTestables.createSftpConnectionConfig({
    host: 'example.com',
    username: 'deploy',
    hostFingerprint: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  })

  assert.equal(config.hostVerifier(HEX_FINGERPRINT), false)
  assert.equal(getObservedFingerprint(), OPENSSH_FINGERPRINT)
  assert.match(
    sftpTestables.createHostFingerprintError({
      code: 'SFTP_HOST_FINGERPRINT_MISMATCH',
      expectedFingerprint: releaseTestables.normalizeHostFingerprint(
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      ),
      observedFingerprint: getObservedFingerprint()
    }).message,
    /SSH 主机指纹不匹配/
  )
})

test('keeps the fingerprint in safe release profiles without exposing passwords', () => {
  const profile = releaseTestables.safeProfile({
    id: 'production',
    host: 'example.com',
    hostFingerprint: COLON_HEX_FINGERPRINT,
    passwordEncrypted: 'safe-storage:v1:encrypted-payload'
  })

  assert.equal(profile.hostFingerprint, OPENSSH_FINGERPRINT)
  assert.equal('password' in profile, false)
  assert.equal('passwordEncrypted' in profile, false)
})
