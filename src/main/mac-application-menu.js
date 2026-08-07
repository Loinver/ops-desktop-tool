const fs = require('node:fs')
const path = require('node:path')
const { IPC_CHANNELS } = require('../shared/ipc-channels')
const { assertTrustedIpcSender } = require('./utils/ipc-security')

const THEME_MODES = Object.freeze(['system', 'light', 'dark'])
const APPEARANCE_MENU_ITEM_IDS = Object.freeze({
  system: 'appearance-system',
  light: 'appearance-light',
  dark: 'appearance-dark'
})

function isThemeMode(value) {
  return THEME_MODES.includes(value)
}

function buildMacMenuTemplate({
  appName,
  isDev,
  navigate,
  setThemeMode,
  themeMode = 'system',
  openLogs,
  openDataDirectory
}) {
  const activeThemeMode = isThemeMode(themeMode) ? themeMode : 'system'
  const viewSubmenu = [
    ...(isDev ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }] : []),
    ...(isDev ? [{ type: 'separator' }] : []),
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    {
      label: '外观',
      submenu: [
        {
          id: APPEARANCE_MENU_ITEM_IDS.system,
          type: 'radio',
          label: '跟随系统',
          checked: activeThemeMode === 'system',
          click: () => setThemeMode('system')
        },
        {
          id: APPEARANCE_MENU_ITEM_IDS.light,
          type: 'radio',
          label: '浅色',
          checked: activeThemeMode === 'light',
          click: () => setThemeMode('light')
        },
        {
          id: APPEARANCE_MENU_ITEM_IDS.dark,
          type: 'radio',
          label: '深色',
          checked: activeThemeMode === 'dark',
          click: () => setThemeMode('dark')
        }
      ]
    },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]

  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        {
          label: '检查更新…',
          click: () => navigate('/app-update')
        },
        { type: 'separator' },
        {
          label: '设置…',
          accelerator: 'CommandOrControl+,',
          click: () => navigate('/data-management')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: '文件',
      submenu: [
        {
          label: '运维仪表盘',
          accelerator: 'CommandOrControl+1',
          click: () => navigate('/ops-dashboard')
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { role: 'startSpeaking' },
        { role: 'stopSpeaking' }
      ]
    },
    { label: '显示', submenu: viewSubmenu },
    {
      label: '窗口',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      role: 'help',
      submenu: [
        {
          label: '系统信息',
          click: () => navigate('/system-info')
        },
        {
          label: '打开日志目录',
          click: openLogs
        },
        {
          label: '打开应用数据目录',
          click: openDataDirectory
        }
      ]
    }
  ]
}

function installMacApplicationMenu({ app, Menu, shell, getMainWindow, showMainWindow, logger }) {
  if (process.platform !== 'darwin') return null
  const { ipcMain } = require('electron')

  const openDirectory = async (directory) => {
    try {
      fs.mkdirSync(directory, { recursive: true })
      const errorMessage = await shell.openPath(directory)
      if (errorMessage) logger?.warn('Finder 打开目录失败', { directory, errorMessage })
    } catch (error) {
      logger?.warn('Finder 打开目录失败', { directory, message: error?.message })
    }
  }

  const sendToRenderer = (channel, payload) => {
    showMainWindow()
    const window = getMainWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
    const send = () => window.webContents.send(channel, payload)
    if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send)
    else send()
    return true
  }

  let currentThemeMode = 'system'
  let menu = null
  const navigate = (route) => sendToRenderer(IPC_CHANNELS.APP_NAVIGATE, route)
  const setThemeMode = (mode) => {
    if (!isThemeMode(mode)) return false
    currentThemeMode = mode
    return sendToRenderer(IPC_CHANNELS.APP_THEME_MODE, mode)
  }

  const userDataPath = app.getPath('userData')
  const buildAndInstallMenu = () => {
    const template = buildMacMenuTemplate({
      appName: app.name,
      isDev: !app.isPackaged,
      navigate,
      setThemeMode,
      themeMode: currentThemeMode,
      openLogs: () => void openDirectory(path.join(userDataPath, 'logs')),
      openDataDirectory: () => void openDirectory(userDataPath)
    })
    menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
    return menu
  }
  buildAndInstallMenu()

  const syncThemeMode = (event, mode) => {
    try {
      assertTrustedIpcSender(event, {
        getMainWindow,
        isPackaged: app.isPackaged,
        devServerUrl: process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173',
        rendererEntryPath: path.join(app.getAppPath(), 'dist', 'renderer', 'index.html')
      })
    } catch (error) {
      logger?.warn?.('忽略不受信任的主题同步请求', { message: error?.message })
      return
    }
    if (!isThemeMode(mode) || currentThemeMode === mode) return
    currentThemeMode = mode
    buildAndInstallMenu()
  }
  ipcMain?.on(IPC_CHANNELS.APP_THEME_MODE_SYNC, syncThemeMode)
  app.once?.('will-quit', () => {
    ipcMain?.removeListener(IPC_CHANNELS.APP_THEME_MODE_SYNC, syncThemeMode)
  })

  return menu
}

module.exports = { APPEARANCE_MENU_ITEM_IDS, buildMacMenuTemplate, installMacApplicationMenu }
