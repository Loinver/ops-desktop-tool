const { BrowserWindow, Notification, ipcMain } = require('electron')
const logger = require('./utils/logger')
const { IPC_CHANNELS } = require('../shared/ipc-channels')
const { markOpsEventsRead, onOpsEventChange } = require('./utils/ops-automation')
const {
  isWithinQuietHours,
  loadNotificationPreferences,
  notificationContent,
  notificationDecision,
  saveNotificationPreferences,
} = require('./utils/ops-notification-preferences')

let stopListening = null
let runtime = null
const activeNotifications = new Map()
const lastNotifiedAt = new Map()

function supported() {
  return typeof Notification?.isSupported === 'function' && Notification.isSupported()
}

function focusMainWindow() {
  const window = runtime?.getWindow?.()
  if (!window || window.isDestroyed()) return null
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
  return window
}

function sendEventToRenderer(item) {
  const window = focusMainWindow()
  if (!window || window.webContents.isDestroyed()) return
  const send = () => window.webContents.send(IPC_CHANNELS.OPS_NOTIFICATION_OPEN, item)
  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send)
  else send()
}

function showEventNotification(change) {
  if (!runtime || !supported()) return { shown: false, reason: 'unsupported' }
  const preferences = loadNotificationPreferences(runtime.userDataPath)
  const window = runtime.getWindow?.()
  const baseDecision = notificationDecision({
    change,
    preferences,
    isFocused: Boolean(window && !window.isDestroyed() && window.isFocused()),
    lastNotifiedAt: 0,
  })
  const decision = notificationDecision({
    change,
    preferences,
    isFocused: Boolean(window && !window.isDestroyed() && window.isFocused()),
    lastNotifiedAt: lastNotifiedAt.get(baseDecision.key) || 0,
  })
  if (!decision.notify) return { shown: false, reason: decision.reason }

  const content = notificationContent(change)
  const notification = new Notification({
    ...content,
    silent: !preferences.soundEnabled,
    urgency: change.item?.severity === 'critical' ? 'critical' : 'normal',
  })
  const previous = activeNotifications.get(decision.key)
  if (previous) previous.close()
  activeNotifications.set(decision.key, notification)
  lastNotifiedAt.set(decision.key, Date.now())
  notification.on('click', () => {
    try {
      markOpsEventsRead(runtime.userDataPath, { ids: [change.item?.id] })
    } catch (error) {
      logger.error('标记桌面通知事件已读失败', { message: error?.message, stack: error?.stack })
    }
    sendEventToRenderer(change.item)
  })
  notification.on('close', () => {
    if (activeNotifications.get(decision.key) === notification) activeNotifications.delete(decision.key)
  })
  notification.show()
  return { shown: true, reason: 'shown' }
}

function showTestNotification() {
  if (!runtime) throw new Error('通知服务尚未初始化')
  if (!supported()) return { shown: false, supported: false }
  const preferences = loadNotificationPreferences(runtime.userDataPath)
  const notification = new Notification({
    title: 'Ops Desktop 通知测试',
    body: '桌面通知已正常工作，后续事件会按照当前偏好推送。',
    silent: !preferences.soundEnabled,
  })
  notification.on('click', focusMainWindow)
  notification.show()
  return { shown: true, supported: true }
}

function preferencesResult(preferences) {
  return {
    ok: true,
    preferences,
    supported: supported(),
    quietNow: isWithinQuietHours(preferences),
  }
}

function registerHandlers() {
  ipcMain.removeHandler(IPC_CHANNELS.OPS_NOTIFICATION_PREFERENCES_GET)
  ipcMain.removeHandler(IPC_CHANNELS.OPS_NOTIFICATION_PREFERENCES_SAVE)
  ipcMain.removeHandler(IPC_CHANNELS.OPS_NOTIFICATION_TEST)

  ipcMain.handle(IPC_CHANNELS.OPS_NOTIFICATION_PREFERENCES_GET, async () => {
    try { return preferencesResult(loadNotificationPreferences(runtime.userDataPath)) }
    catch (error) { return { ok: false, error: error.message || '读取通知偏好失败' } }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_NOTIFICATION_PREFERENCES_SAVE, async (_event, changes = {}) => {
    try { return preferencesResult(saveNotificationPreferences(runtime.userDataPath, changes)) }
    catch (error) { return { ok: false, error: error.message || '保存通知偏好失败' } }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_NOTIFICATION_TEST, async () => {
    try { return { ok: true, ...showTestNotification() } }
    catch (error) { return { ok: false, error: error.message || '发送测试通知失败' } }
  })
}

function initializeOpsNotificationService({ userDataPath, getWindow = () => BrowserWindow.getAllWindows()[0] } = {}) {
  if (!userDataPath) throw new Error('通知服务缺少数据目录')
  stopOpsNotificationService()
  runtime = { userDataPath, getWindow }
  registerHandlers()
  stopListening = onOpsEventChange(change => {
    try { showEventNotification(change) }
    catch (error) { logger.error('发送运维桌面通知失败', { message: error?.message, stack: error?.stack }) }
  })
}

function stopOpsNotificationService() {
  if (stopListening) stopListening()
  stopListening = null
  for (const notification of activeNotifications.values()) notification.close()
  activeNotifications.clear()
  lastNotifiedAt.clear()
  runtime = null
}

module.exports = {
  initializeOpsNotificationService,
  showEventNotification,
  showTestNotification,
  stopOpsNotificationService,
}
