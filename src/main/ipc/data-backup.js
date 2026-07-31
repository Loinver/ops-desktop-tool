const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const {
  MAX_BACKUP_BYTES,
  createBackupArchive,
  getBackupOverview,
  inspectBackupArchive,
  listRestorePoints,
  readAutoBackupHistory,
  readAutoBackupSettings,
  restoreBackupArchive,
  restoreRestorePoint,
  safeAutoBackupSettings,
} = require('../utils/app-data-backup')
const { runAutoBackupNow, saveAutoBackupSchedule } = require('../ops-auto-backup-scheduler')

const pendingImports = new Map()
const IMPORT_TTL_MS = 10 * 60 * 1000

function focusedWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
}

function readBackupFile(filePath) {
  const resolved = path.resolve(String(filePath || '').slice(0, 4096))
  const stat = fs.statSync(resolved)
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BACKUP_BYTES) throw new Error('备份文件为空或超过大小限制')
  return { resolved, stat, buffer: fs.readFileSync(resolved) }
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function cleanupPendingImports() {
  const now = Date.now()
  for (const [token, item] of pendingImports) {
    if (now - item.createdAt > IMPORT_TTL_MS) pendingImports.delete(token)
  }
}

function registerDataBackupHandlers() {
  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_OVERVIEW, async () => getBackupOverview(app.getPath('userData')))

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_AUTO_GET, async () => (
    safeAutoBackupSettings(readAutoBackupSettings(app.getPath('userData')))
  ))

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_AUTO_SAVE, async (_event, options = {}) => {
    const settings = saveAutoBackupSchedule(options)
    return { ok: true, settings }
  })

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_AUTO_RUN, async () => runAutoBackupNow())

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_HISTORY_GET, async () => (
    readAutoBackupHistory(app.getPath('userData'))
  ))

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_RESTORE_POINTS_GET, async () => (
    listRestorePoints(app.getPath('userData'))
  ))

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_RESTORE_POINT, async (_event, options = {}) => (
    restoreRestorePoint({ userDataPath: app.getPath('userData'), id: options.id })
  ))

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_EXPORT, async (_event, options = {}) => {
    const archive = createBackupArchive({
      userDataPath: app.getPath('userData'),
      password: options.password,
      categories: options.categories,
      appVersion: app.getVersion(),
    })
    const date = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(focusedWindow(), {
      title: '导出加密数据备份',
      defaultPath: `ops-desktop-backup-${date}.opsbackup`,
      filters: [{ name: 'Ops Desktop 加密备份', extensions: ['opsbackup'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    fs.writeFileSync(result.filePath, archive, { mode: 0o600 })
    try { fs.chmodSync(result.filePath, 0o600) } catch {}
    return { canceled: false, fileName: path.basename(result.filePath), sizeBytes: archive.length }
  })

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_INSPECT, async (_event, options = {}) => {
    cleanupPendingImports()
    const result = await dialog.showOpenDialog(focusedWindow(), {
      title: '选择 Ops Desktop 备份',
      properties: ['openFile'],
      filters: [{ name: 'Ops Desktop 加密备份', extensions: ['opsbackup'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const file = readBackupFile(result.filePaths[0])
    const summary = inspectBackupArchive(file.buffer, options.password)
    const token = crypto.randomUUID()
    pendingImports.set(token, {
      createdAt: Date.now(),
      filePath: file.resolved,
      size: file.stat.size,
      mtimeMs: file.stat.mtimeMs,
      digest: digest(file.buffer),
      password: options.password,
    })
    return { canceled: false, token, fileName: path.basename(file.resolved), summary }
  })

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_RESTORE, async (_event, options = {}) => {
    cleanupPendingImports()
    const token = String(options.token || '')
    const pending = pendingImports.get(token)
    if (!pending) throw new Error('恢复预览已过期，请重新选择备份文件')
    const file = readBackupFile(pending.filePath)
    if (file.stat.size !== pending.size || file.stat.mtimeMs !== pending.mtimeMs || digest(file.buffer) !== pending.digest) {
      pendingImports.delete(token)
      throw new Error('备份文件在预览后发生变化，请重新选择')
    }
    const result = restoreBackupArchive({
      userDataPath: app.getPath('userData'),
      archive: file.buffer,
      password: pending.password,
    })
    pendingImports.delete(token)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.APP_RELAUNCH, async () => {
    setImmediate(() => {
      app.relaunch()
      app.quit()
    })
    return { ok: true }
  })
}

module.exports = { registerDataBackupHandlers }
