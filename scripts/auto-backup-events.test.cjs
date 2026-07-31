const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  AUTO_BACKUP_EVENT_FINGERPRINT,
  recordAutoBackupExecutionFailure,
  recoverAutoBackupExecution,
} = require('../src/main/utils/auto-backup-events')
const { listOpsEvents, onOpsEventChange } = require('../src/main/utils/ops-automation')

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-auto-backup-event-'))
}

test('自动备份失败会创建可通知事件，成功后恢复且不泄露底层错误', () => {
  const userDataPath = createTempDir()
  const changes = []
  const unsubscribe = onOpsEventChange(change => changes.push(change))
  try {
    const failed = recordAutoBackupExecutionFailure({
      userDataPath,
      now: 1_000,
      error: new Error('无法写入 /private/backup-directory/secret.opsbackup'),
    })
    assert.equal(failed.fingerprint, AUTO_BACKUP_EVENT_FINGERPRINT)
    assert.equal(failed.sourceType, 'data-backup')
    assert.equal(failed.severity, 'critical')
    assert.equal(failed.status, 'open')
    assert.match(failed.description, /本地数据管理/)
    assert.doesNotMatch(failed.description, /private|secret|目录/)

    const recovered = recoverAutoBackupExecution({ userDataPath, now: 2_000 })
    assert.equal(recovered.status, 'resolved')
    assert.match(recovered.resolutionNote, /成功完成/)
    assert.deepEqual(changes.map(change => change.kind), ['opened', 'recovered'])

    const [stored] = listOpsEvents(userDataPath, { sourceType: 'data-backup' })
    assert.equal(stored.status, 'resolved')
    assert.equal(stored.fingerprint, AUTO_BACKUP_EVENT_FINGERPRINT)
  } finally {
    unsubscribe()
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})
