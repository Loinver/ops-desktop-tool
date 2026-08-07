const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  MAX_AUDIT_RECORDS,
  finishAudit,
  getAuditStatePath,
  listAuditRecords,
  startAudit
} = require('../src/main/utils/security-audit')

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-security-audit-'))
  try {
    return callback(directory)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('bounds the local JSON audit state to the newest 1000 records', () => {
  withTempDirectory((userDataPath) => {
    const seededRecords = Array.from({ length: MAX_AUDIT_RECORDS }, (_, index) => ({
      auditId: `audit-${index}`,
      action: 'terminate-process',
      category: 'process',
      channel: 'security-audit:test',
      requestId: `request-${index}`,
      actor: {},
      status: 'started',
      startedAt: new Date(1_700_000_000_000 + index).toISOString(),
      finishedAt: '',
      durationMs: 0,
      target: {},
      error: null
    }))
    fs.writeFileSync(
      getAuditStatePath(userDataPath),
      JSON.stringify({ version: 1, records: seededRecords }),
      'utf8'
    )

    for (let index = MAX_AUDIT_RECORDS; index < MAX_AUDIT_RECORDS + 5; index += 1) {
      startAudit({
        userDataPath,
        action: 'terminate-process',
        category: 'process',
        channel: 'security-audit:test',
        requestId: `request-${index}`,
        now: 1_700_000_000_000 + index
      })
    }

    const saved = JSON.parse(fs.readFileSync(getAuditStatePath(userDataPath), 'utf8'))
    assert.equal(saved.version, 1)
    assert.equal(saved.records.length, MAX_AUDIT_RECORDS)
    assert.equal(saved.records[0].requestId, 'request-5')
    assert.equal(saved.records.at(-1).requestId, 'request-1004')
  })
})

test('correlates lifecycle updates and supports structured filtering', () => {
  withTempDirectory((userDataPath) => {
    const started = startAudit({
      userDataPath,
      action: 'deploy',
      category: 'release',
      channel: 'release:publish',
      requestId: 'request-deploy-1',
      actor: { type: 'local-user', id: 'operator-1', name: 'Operator' },
      target: {
        type: 'server',
        id: 'server-1',
        eventId: 'event-1',
        pid: 4321,
        environment: 'production'
      },
      now: 1_700_000_000_000
    })
    startAudit({
      userDataPath,
      action: 'rollback',
      category: 'release',
      channel: 'release:rollback',
      requestId: 'request-rollback-1',
      now: 1_700_000_001_000
    })

    const finished = finishAudit({
      userDataPath,
      auditId: started.auditId,
      status: 'success',
      now: 1_700_000_002_500
    })

    assert.equal(finished.auditId, started.auditId)
    assert.equal(finished.requestId, 'request-deploy-1')
    assert.equal(finished.status, 'succeeded')
    assert.equal(finished.durationMs, 2_500)
    assert.equal(finished.finishedAt, new Date(1_700_000_002_500).toISOString())

    const filtered = listAuditRecords({
      userDataPath,
      filters: {
        action: 'deploy',
        category: 'release',
        status: 'succeeded',
        requestId: 'request-deploy-1'
      }
    })
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].channel, 'release:publish')
    assert.deepEqual(filtered[0].target, {
      type: 'server',
      id: 'server-1',
      eventId: 'event-1',
      pid: 4321,
      environment: 'production'
    })
  })
})

test('recursively drops sensitive keys and redacts sensitive text', () => {
  withTempDirectory((userDataPath) => {
    const secret = 'super-secret-value-123'
    const localPath = '/Users/operator/private/config.json'
    const started = startAudit({
      userDataPath,
      action: 'provider-change',
      category: 'credentials',
      channel: 'settings:provider',
      requestId: 'request-secret-1',
      actor: {
        type: 'local-user',
        id: 'operator-1',
        token: secret
      },
      target: {
        type: 'provider',
        id: 'provider-1',
        scope: `Authorization: Token ${secret}; node --token ${secret} ${localPath}`,
        password: secret,
        apiKey: secret,
        authorization: `Bearer ${secret}`,
        headers: { authorization: `Bearer ${secret}` },
        payload: { password: secret },
        resource: { id: 'resource-1', secret },
        metadata: { secret },
        environment: 'production',
        hasPassword: true,
        clearPassword: false
      },
      now: 1_700_000_000_000
    })
    finishAudit({
      userDataPath,
      auditId: started.auditId,
      status: 'failed',
      error: {
        code: 'PROVIDER_AUTH_FAILED',
        message: `TOKEN=${secret}; Authorization: Basic ${secret}; failed at ${localPath}`
      },
      now: 1_700_000_001_000
    })

    const rawState = fs.readFileSync(getAuditStatePath(userDataPath), 'utf8')
    const records = listAuditRecords({ userDataPath, limit: 10 })
    assert.equal(rawState.includes(secret), false)
    assert.equal(rawState.includes(localPath), false)
    assert.equal(JSON.stringify(records).includes(secret), false)
    assert.equal(JSON.stringify(records).includes(localPath), false)
    assert.deepEqual(records[0].actor, { type: 'local-user', id: 'operator-1' })
    assert.deepEqual(records[0].target, {
      type: 'provider',
      id: 'provider-1',
      scope: 'Authorization: [REDACTED]; node --token [REDACTED] [REDACTED_PATH]',
      resource: { id: 'resource-1' },
      environment: 'production',
      hasPassword: true,
      clearPassword: false
    })
    assert.deepEqual(records[0].error, {
      code: 'PROVIDER_AUTH_FAILED',
      message: 'TOKEN=[REDACTED]; Authorization: [REDACTED]; failed at [REDACTED_PATH]'
    })
    assert.equal('payload' in records[0].target, false)
    assert.equal('headers' in records[0].target, false)
  })
})

test('surfaces persistence failures to the caller', () => {
  withTempDirectory((userDataPath) => {
    const blockedPath = path.join(userDataPath, 'not-a-directory')
    fs.writeFileSync(blockedPath, 'blocked', 'utf8')

    const originalConsoleError = console.error
    console.error = () => {}
    try {
      assert.throws(
        () =>
          startAudit({
            userDataPath: blockedPath,
            action: 'restore',
            category: 'data',
            channel: 'backup:restore'
          }),
        (error) => error?.code === 'AUDIT_PERSISTENCE_FAILED'
      )
    } finally {
      console.error = originalConsoleError
    }
  })
})
