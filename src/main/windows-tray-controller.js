const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./utils/json-store')
const { eventSummary, onOpsEventChange } = require('./utils/ops-automation')

const SETTINGS_FILE = 'desktop-behavior-settings.json'
const LOGIN_ARGUMENTS = ['--hidden']

function windowsLoginItemOptions(openAtLogin, executablePath = process.execPath) {
  return {
    openAtLogin: openAtLogin === true,
    path: executablePath,
    args: [...LOGIN_ARGUMENTS]
  }
}

function normalizeDesktopBehaviorSettings(value = {}) {
  return {
    closeToTray: value?.closeToTray !== false
  }
}

function settingsPath(userDataPath) {
  return path.join(userDataPath, SETTINGS_FILE)
}

function loadDesktopBehaviorSettings(userDataPath) {
  return normalizeDesktopBehaviorSettings(readJsonFile(settingsPath(userDataPath), {}))
}

function saveDesktopBehaviorSettings(userDataPath, settings) {
  const normalized = normalizeDesktopBehaviorSettings(settings)
  if (!writeJsonFile(settingsPath(userDataPath), normalized)) {
    throw new Error('保存桌面运行设置失败')
  }
  return normalized
}

function unreadCountLabel(unreadCount) {
  const count = Math.max(0, Math.floor(Number(unreadCount) || 0))
  if (count === 0) return '0'
  return count > 99 ? '99+' : String(count)
}

function trayToolTip(unreadCount) {
  const count = Math.max(0, Math.floor(Number(unreadCount) || 0))
  return count > 0 ? `Ops Desktop · ${unreadCountLabel(count)} 条未读运维事件` : 'Ops Desktop'
}

function createWindowsTrayController({
  app,
  Tray,
  Menu,
  icon,
  userDataPath,
  showWindow,
  openNotifications = showWindow,
  logger = console,
  summarizeEvents = eventSummary,
  subscribeToEvents = onOpsEventChange
}) {
  if (!app || !Tray || !Menu || !icon || !userDataPath || typeof showWindow !== 'function') {
    throw new Error('创建 Windows 托盘缺少必要参数')
  }

  let quitting = false
  let settings = loadDesktopBehaviorSettings(userDataPath)
  let unreadCount = 0
  let stopListening = null
  let tray = new Tray(icon)

  function getOpenAtLogin() {
    if (!app.isPackaged) return false
    try {
      return Boolean(app.getLoginItemSettings(windowsLoginItemOptions(true))?.openAtLogin)
    } catch (error) {
      logger.warn?.('读取 Windows 开机启动状态失败', { message: error?.message })
      return false
    }
  }

  function rebuildMenu() {
    if (!tray) return
    const canManageLoginItem = Boolean(app.isPackaged)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '打开 Ops Desktop',
          click: () => showWindow()
        },
        {
          label:
            unreadCount > 0
              ? `查看 ${unreadCountLabel(unreadCount)} 条未读运维事件`
              : '查看运维事件',
          click: () => openNotifications()
        },
        { type: 'separator' },
        {
          label: '关闭窗口时最小化到托盘',
          type: 'checkbox',
          checked: settings.closeToTray,
          click: (menuItem) => {
            try {
              settings = saveDesktopBehaviorSettings(userDataPath, {
                ...settings,
                closeToTray: Boolean(menuItem.checked)
              })
            } catch (error) {
              logger.error?.('保存托盘运行设置失败', {
                message: error?.message,
                stack: error?.stack
              })
            }
            rebuildMenu()
          }
        },
        {
          label: canManageLoginItem ? '开机自动启动' : '开机自动启动（安装版可用）',
          type: 'checkbox',
          checked: canManageLoginItem && getOpenAtLogin(),
          enabled: canManageLoginItem,
          click: (menuItem) => {
            try {
              app.setLoginItemSettings(windowsLoginItemOptions(Boolean(menuItem.checked)))
            } catch (error) {
              logger.error?.('设置 Windows 开机启动失败', {
                message: error?.message,
                stack: error?.stack
              })
            }
            rebuildMenu()
          }
        },
        { type: 'separator' },
        {
          label: '退出应用',
          click: () => {
            quitting = true
            app.quit()
          }
        }
      ])
    )
  }

  function refreshUnreadState() {
    if (!tray) return unreadCount
    try {
      unreadCount = Math.max(0, Number(summarizeEvents(userDataPath)?.unread) || 0)
      tray.setToolTip(trayToolTip(unreadCount))
      rebuildMenu()
    } catch (error) {
      logger.warn?.('更新 Windows 托盘未读状态失败', { message: error?.message })
    }
    return unreadCount
  }

  tray.on('click', () => showWindow())
  refreshUnreadState()
  try {
    stopListening = subscribeToEvents(refreshUnreadState)
  } catch (error) {
    logger.warn?.('监听 Windows 托盘运维事件失败', { message: error?.message })
  }

  return {
    destroy() {
      stopListening?.()
      stopListening = null
      tray?.destroy()
      tray = null
    },
    markQuitting() {
      quitting = true
    },
    shouldHideOnClose() {
      return !quitting && settings.closeToTray
    },
    shouldKeepAlive() {
      return !quitting && settings.closeToTray
    },
    getSettings() {
      return { ...settings }
    },
    refresh() {
      return refreshUnreadState()
    },
    refreshUnreadState
  }
}

module.exports = {
  createWindowsTrayController,
  loadDesktopBehaviorSettings,
  normalizeDesktopBehaviorSettings,
  saveDesktopBehaviorSettings,
  trayToolTip,
  unreadCountLabel,
  windowsLoginItemOptions,
  __testables: {
    LOGIN_ARGUMENTS,
    SETTINGS_FILE
  }
}
