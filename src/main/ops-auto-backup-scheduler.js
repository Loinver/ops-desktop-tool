const { app, safeStorage } = require('electron')
const { decryptSecret, encryptSecret } = require('./utils/secure-secret')
const {
  AUTO_BACKUP_INTERVALS,
  readAutoBackupSettings,
  recordAutoBackupFailure,
  runAutoBackup,
} = require('./utils/app-data-backup')

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

function scheduleAutoBackup() {
  clearTimer()
  if (!runtime) return
  const settings = readAutoBackupSettings(runtime.userDataPath)
  if (!settings.enabled) return
  const nextRunAt = settings.nextRunAt || Date.now() + AUTO_BACKUP_INTERVALS[settings.interval]
  timer = setTimeout(() => {
    try {
      runAutoBackup({
        userDataPath: runtime.userDataPath,
        decryptPassword: value => decryptSecret(safeStorage, value),
        appVersion: app.getVersion(),
      })
    } catch (error) {
      console.error('执行自动数据备份失败:', error)
      try { recordAutoBackupFailure({ userDataPath: runtime.userDataPath, error }) } catch {}
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
    return runAutoBackup({
      userDataPath: runtime.userDataPath,
      decryptPassword: value => decryptSecret(safeStorage, value),
      appVersion: app.getVersion(),
    })
  } catch (error) {
    try { recordAutoBackupFailure({ userDataPath: runtime.userDataPath, error }) } catch {}
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
