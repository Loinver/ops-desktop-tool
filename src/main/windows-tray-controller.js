const path = require('node:path')
const { readJsonFile, writeJsonFile } = require('./utils/json-store')

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

function createWindowsTrayController({
  app,
  Tray,
  Menu,
  icon,
  userDataPath,
  showWindow,
  logger = console
}) {
  if (!app || !Tray || !Menu || !icon || !userDataPath || typeof showWindow !== 'function') {
    throw new Error('创建 Windows 托盘缺少必要参数')
  }

  let quitting = false
  let settings = loadDesktopBehaviorSettings(userDataPath)
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

  tray.setToolTip('Ops Desktop')
  tray.on('click', () => showWindow())
  rebuildMenu()

  return {
    destroy() {
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
      rebuildMenu()
    }
  }
}

module.exports = {
  createWindowsTrayController,
  loadDesktopBehaviorSettings,
  normalizeDesktopBehaviorSettings,
  saveDesktopBehaviorSettings,
  windowsLoginItemOptions,
  __testables: {
    LOGIN_ARGUMENTS,
    SETTINGS_FILE
  }
}
