const { addOpsEvent, recoverOpsEvent } = require('./ops-automation')

const AUTO_BACKUP_EVENT_FINGERPRINT = 'data-backup:scheduled-runner'
const AUTO_BACKUP_EVENT_SOURCE = 'data-backup'

function recordAutoBackupExecutionFailure({ userDataPath, now = Date.now() } = {}) {
  return addOpsEvent(userDataPath, {
    fingerprint: AUTO_BACKUP_EVENT_FINGERPRINT,
    sourceType: AUTO_BACKUP_EVENT_SOURCE,
    sourceId: 'auto-backup',
    severity: 'critical',
    title: '自动备份执行失败',
    description: '自动备份未能完成。请在“本地数据管理”中检查备份计划、历史和健康状态。',
    occurredAt: Number(now) || Date.now()
  })
}

function recoverAutoBackupExecution({ userDataPath, now = Date.now() } = {}) {
  return recoverOpsEvent(userDataPath, AUTO_BACKUP_EVENT_FINGERPRINT, {
    recoveredAt: Number(now) || Date.now(),
    message: '自动备份已成功完成，备份计划会在应用运行期间继续执行。'
  })
}

module.exports = {
  AUTO_BACKUP_EVENT_FINGERPRINT,
  AUTO_BACKUP_EVENT_SOURCE,
  recordAutoBackupExecutionFailure,
  recoverAutoBackupExecution
}
