const fs = require('node:fs')
const path = require('node:path')

function buildMacMenuTemplate({ appName, isDev, navigate, openLogs, openDataDirectory }) {
  const viewSubmenu = [
    ...(isDev ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }] : []),
    ...(isDev ? [{ type: 'separator' }] : []),
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]

  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
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

  const openDirectory = async (directory) => {
    try {
      fs.mkdirSync(directory, { recursive: true })
      const errorMessage = await shell.openPath(directory)
      if (errorMessage) logger?.warn('Finder 打开目录失败', { directory, errorMessage })
    } catch (error) {
      logger?.warn('Finder 打开目录失败', { directory, message: error?.message })
    }
  }

  const navigate = (route) => {
    showMainWindow()
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    const send = () => window.webContents.send('app:navigate', route)
    if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', send)
    else send()
  }

  const userDataPath = app.getPath('userData')
  const template = buildMacMenuTemplate({
    appName: app.name,
    isDev: !app.isPackaged,
    navigate,
    openLogs: () => void openDirectory(path.join(userDataPath, 'logs')),
    openDataDirectory: () => void openDirectory(userDataPath)
  })
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  return menu
}

module.exports = { buildMacMenuTemplate, installMacApplicationMenu }
