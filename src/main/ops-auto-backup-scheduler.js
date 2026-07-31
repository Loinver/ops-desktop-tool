const { app, safeStorage } = require('electron')
const { decryptSecret, encryptSecret } = require('./utils/secure-secret')
const {
  AUTO_BACKUP_INTERVALS,
  readAutoBackupSettings,
  recordAutoBackupFailure,
  runAutoBackup,
} = require('./utils/app-data-backup')
const { recordAutoBackupExecutionFailure, recoverAutoBackupExecution } = require('./utils/auto-backup-events')

let runtime = null
let timer = null

function clearTimer() {
  if (timer) clearTimeout(timer)
  timer = null
}

function delayUntil(timestamp) {
  const target = Number(timestamp) || 0
  const maxDelay = 2_147_000_000
  if (!target) return 0
  return Math.max(0, Math.min(maxDelay, target - Date.now()))
}

function recordAutoBackupRunFailure(error) {
  let settings
  try { settings = recordAutoBackupFailure({ userDataPath: runtime.userDataPath, error }) } catch { return }
  if (!settings?.enabled) return
  try { recordAutoBackupExecutionFailure({ userDataPath: runtime.userDataPath }) } catch {}
}

function scheduleAutoBackup() {
  clearTimer()
  if (!runtime) return
  const settings = readAutoBackupSettings(runtime.userDataPath)
  if (!settings.enabled) return
  const nextRunAt = settings.nextRunAt || Date.now() + AUTO_BACKUP_INTERVALS[settings.interval]
  timer = setTimeout(() => {
    try {
      const result = runAutoBackup({
        userDataPath: runtime.userDataPath,
        decryptPassword: value => decryptSecret(safeStorage, value),
        appVersion: app.getVersion(),
      })
      try { recoverAutoBackupExecution({ userDataPath: runtime.userDataPath, now: result.entry?.createdAt }) } catch {}
    } catch (error) {
      console.error('执行自动数据备份失败:', error)
      recordAutoBackupRunFailure(error)
    } finally {
      scheduleAutoBackup()
    }
  }, delayUntil(nextRunAt))
}

function initializeAutoBackupScheduler({ userDataPath } = {}) {
  if (!userDataPath) throw new Error('自动备份服务缺少数据目录')
  runtime = { userDataPath }
  scheduleAutoBackup()
}

function saveAutoBackupSchedule(input) {
  if (!runtime) throw new Error('自动备份服务尚未初始化')
  const { saveAutoBackupSettings } = require('./utils/app-data-backup')
  const settings = saveAutoBackupSettings({
    userDataPath: runtime.userDataPath,
    input,
    encryptPassword: value => encryptSecret(safeStorage, value),
  })
  scheduleAutoBackup()
  return settings
}

function runAutoBackupNow() {
  if (!runtime) throw new Error('自动备份服务尚未初始化')
  try {
    const result = runAutoBackup({
      userDataPath: runtime.userDataPath,
      decryptPassword: value => decryptSecret(safeStorage, value),
      appVersion: app.getVersion(),
    })
    try { recoverAutoBackupExecution({ userDataPath: runtime.userDataPath, now: result.entry?.createdAt }) } catch {}
    return result
  } catch (error) {
    recordAutoBackupRunFailure(error)
    throw error
  } finally {
    scheduleAutoBackup()
  }
}

function stopAutoBackupScheduler() {
  clearTimer()
  runtime = null
}

module.exports = {
  initializeAutoBackupScheduler,
  runAutoBackupNow,
  saveAutoBackupSchedule,
  scheduleAutoBackup,
  stopAutoBackupScheduler,
}
