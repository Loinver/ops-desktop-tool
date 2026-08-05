const { IPC_CHANNELS } = require('../shared/ipc-channels')
const { eventSummary, onOpsEventChange } = require('./utils/ops-automation')
const { windowsLoginItemOptions } = require('./windows-tray-controller')

const MAC_NOTIFICATION_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
const WINDOWS_NOTIFICATION_SETTINGS_URL = 'ms-settings:notifications'

function dockBadgeLabel(unreadCount) {
  const count = Math.max(0, Math.floor(Number(unreadCount) || 0))
  if (count === 0) return ''
  return count > 99 ? '99+' : String(count)
}

function buildMacDockMenuTemplate({ showMainWindow, navigate, openNotificationSettings }) {
  return [
    { label: '打开 Ops Desktop', click: showMainWindow },
    { type: 'separator' },
    { label: '运维仪表盘', click: () => navigate('/ops-dashboard') },
    { label: '运维中心', click: () => navigate('/ops-control-center') },
    { type: 'separator' },
    { label: '通知设置', click: openNotificationSettings }
  ]
}

function createMacDesktopController({
  app,
  Menu,
  shell,
  ipcMain,
  userDataPath,
  getMainWindow,
  showMainWindow,
  logger,
  platform = process.platform,
  refreshWindowsTray = () => {},
  summarizeEvents = eventSummary,
  subscribeToEvents = onOpsEventChange
}) {
  const isMac = platform === 'darwin'
  const isWindows = platform === 'win32'
  const supported = isMac || isWindows
  let stopListening = null
  let currentUnreadCount = 0

  function sendToRenderer(channel, payload) {
    showMainWindow()
    const window = getMainWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
    const send = () => window.webContents.send(channel, payload)
    if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send)
    else send()
    return true
  }

  function navigate(route) {
    sendToRenderer(IPC_CHANNELS.APP_NAVIGATE, route)
  }

  function openNotificationSettingsPanel() {
    sendToRenderer(IPC_CHANNELS.OPS_NOTIFICATION_SETTINGS_OPEN)
  }

  function refreshDockBadge() {
    if (!isMac || typeof app.dock?.setBadge !== 'function') return 0
    try {
      currentUnreadCount = Math.max(0, Number(summarizeEvents(userDataPath)?.unread) || 0)
      app.dock.setBadge(dockBadgeLabel(currentUnreadCount))
    } catch (error) {
      logger?.warn('更新 macOS Dock 未读角标失败', { message: error?.message })
    }
    return currentUnreadCount
  }

  function loginItemStatus() {
    if (!supported || !app.isPackaged) {
      return { available: false, openAtLogin: false }
    }
    try {
      const settings = app.getLoginItemSettings(
        isWindows ? windowsLoginItemOptions(true) : undefined
      )
      return { available: true, openAtLogin: settings?.openAtLogin === true }
    } catch (error) {
      logger?.warn('读取登录启动设置失败', { platform, message: error?.message })
      return { available: true, openAtLogin: false, error: error?.message }
    }
  }

  function integrationStatus() {
    const loginItem = loginItemStatus()
    return {
      ok: true,
      supported,
      platform,
      platformLabel: isWindows ? 'Windows' : isMac ? 'macOS' : '',
      packaged: Boolean(app.isPackaged),
      dockBadgeSupported: isMac && typeof app.dock?.setBadge === 'function',
      traySupported: isWindows,
      unreadCount: currentUnreadCount,
      loginItemAvailable: loginItem.available,
      openAtLogin: loginItem.openAtLogin,
      notificationSettingsAvailable: supported
    }
  }

  function saveLoginItem(openAtLogin) {
    if (!supported) return { ok: false, error: '当前平台不支持登录启动设置' }
    if (!app.isPackaged) return { ok: false, error: '登录启动仅在安装版应用中可用' }
    try {
      app.setLoginItemSettings(
        isWindows ? windowsLoginItemOptions(openAtLogin) : { openAtLogin: openAtLogin === true }
      )
      if (isWindows) refreshWindowsTray()
      const status = loginItemStatus()
      return { ok: true, openAtLogin: status.openAtLogin }
    } catch (error) {
      logger?.warn('保存登录启动设置失败', { platform, message: error?.message })
      return { ok: false, error: error?.message || '保存登录启动设置失败' }
    }
  }

  async function openSystemNotificationSettings() {
    if (!supported) return { ok: false, error: '当前平台不支持系统通知设置' }
    try {
      await shell.openExternal(
        isWindows ? WINDOWS_NOTIFICATION_SETTINGS_URL : MAC_NOTIFICATION_SETTINGS_URL
      )
      return { ok: true }
    } catch (error) {
      logger?.warn('打开系统通知设置失败', { platform, message: error?.message })
      return { ok: false, error: error?.message || '打开系统通知设置失败' }
    }
  }

  function registerHandlers() {
    ipcMain.removeHandler(IPC_CHANNELS.DESKTOP_INTEGRATION_GET)
    ipcMain.removeHandler(IPC_CHANNELS.DESKTOP_LOGIN_ITEM_SAVE)
    ipcMain.removeHandler(IPC_CHANNELS.DESKTOP_NOTIFICATION_SETTINGS_OPEN)
    ipcMain.handle(IPC_CHANNELS.DESKTOP_INTEGRATION_GET, async () => integrationStatus())
    ipcMain.handle(IPC_CHANNELS.DESKTOP_LOGIN_ITEM_SAVE, async (_event, value) =>
      saveLoginItem(value === true)
    )
    ipcMain.handle(IPC_CHANNELS.DESKTOP_NOTIFICATION_SETTINGS_OPEN, openSystemNotificationSettings)
  }

  function initialize() {
    registerHandlers()
    if (!supported) return integrationStatus()

    if (isMac && typeof app.dock?.setMenu === 'function') {
      const template = buildMacDockMenuTemplate({
        showMainWindow,
        navigate,
        openNotificationSettings: openNotificationSettingsPanel
      })
      app.dock.setMenu(Menu.buildFromTemplate(template))
    }
    if (isMac) {
      refreshDockBadge()
      stopListening = subscribeToEvents(refreshDockBadge)
    }
    return integrationStatus()
  }

  function destroy() {
    stopListening?.()
    stopListening = null
    if (isMac && typeof app.dock?.setBadge === 'function') app.dock.setBadge('')
  }

  return {
    destroy,
    initialize,
    integrationStatus,
    openSystemNotificationSettings,
    refreshDockBadge,
    saveLoginItem
  }
}

module.exports = {
  MAC_NOTIFICATION_SETTINGS_URL,
  WINDOWS_NOTIFICATION_SETTINGS_URL,
  buildMacDockMenuTemplate,
  createMacDesktopController,
  dockBadgeLabel
}
