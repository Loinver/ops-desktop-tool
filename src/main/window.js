const path = require('node:path')
const { app, BrowserWindow, shell } = require('electron')

const isDev = !app.isPackaged
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

let mainWindow = null

function openExternalSafely(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) return
    void shell.openExternal(url.toString())
  } catch {
    // 无效 URL 直接忽略。
  }
}

function applyWindowSecurity(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openExternalSafely(url)
  })

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

/**
 * 创建主窗口
 * @returns {BrowserWindow}
 */
function createWindow({ showOnReady = true } = {}) {
  const preloadPath = path.join(__dirname, 'preload.js')

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Ops Desktop',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev
    }
  })

  applyWindowSecurity(mainWindow)
  mainWindow.once('ready-to-show', () => {
    if (showOnReady) mainWindow?.show()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
    mainWindow.loadURL(devServerUrl).catch((err) => {
      console.error('Failed to load Vite dev server:', err)
    })

    if (process.env.OPEN_DEVTOOLS !== 'false') {
      mainWindow.webContents.openDevTools()
    }
  } else {
    const appPath = app.getAppPath()
    const rendererPath = path.join(appPath, 'dist', 'renderer', 'index.html')
    mainWindow.loadFile(rendererPath)
  }

  return mainWindow
}

function getMainWindow() {
  return mainWindow
}

module.exports = { createWindow, getMainWindow }
