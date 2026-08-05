const path = require('node:path')
const { app, ipcMain, nativeImage, shell, Tray, Menu } = require('electron')
const { createWindow, getMainWindow } = require('./window')
const { registerPortsHandlers, stopNodeServiceMonitor } = require('./ipc/ports')
const { registerSystemHandlers } = require('./ipc/system')
const { registerAppHandlers } = require('./ipc/app')
const { registerQuickLaunchHandlers } = require('./ipc/quicklaunch')
const { registerClipboardHandlers } = require('./ipc/clipboard')
const { registerSftpHandlers, closeSftpConnection } = require('./ipc/sftp')
const { registerGptImageHandlers } = require('./ipc/gpt-image')
const { registerModelTestHandlers } = require('./ipc/model-test')
const { registerAiOpsHandlers } = require('./ipc/ai-ops')
const { registerDataBackupHandlers } = require('./ipc/data-backup')
const {
  initializeOpsNotificationService,
  stopOpsNotificationService
} = require('./ops-notification-service')
const {
  initializeAutoBackupScheduler,
  stopAutoBackupScheduler
} = require('./ops-auto-backup-scheduler')
const { createWindowsTrayController } = require('./windows-tray-controller')
const { installMacApplicationMenu } = require('./mac-application-menu')
const { createMacDesktopController } = require('./mac-desktop-controller')
const logger = require('./utils/logger')
const { runPackagedRendererSmokeAssertions } = require('./packaged-smoke-test')

const WINDOWS_APP_ID = 'com.ops-desktop-tool'
const isMcpMode = process.argv.includes('--mcp')
const startHidden = process.platform === 'win32' && process.argv.includes('--hidden')
const isSmokeTest =
  process.argv.includes('--smoke-test') || process.env.OPS_DESKTOP_SMOKE_TEST === '1'
let trayController = null
let macDesktopController = null

if (process.platform === 'win32') {
  // 保持与 electron-builder 的 appId 一致，确保通知中心能稳定识别应用身份。
  app.setAppUserModelId(WINDOWS_APP_ID)
}

function createManagedWindow({ showOnReady = true } = {}) {
  const win = createWindow({ showOnReady })
  if (process.platform === 'win32') {
    win.on('close', (event) => {
      if (!trayController?.shouldHideOnClose()) return
      event.preventDefault()
      win.hide()
    })
  }
  return win
}

function showMainWindow() {
  let win = getMainWindow()
  if (!win || win.isDestroyed()) win = createManagedWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindowsTray() {
  if (process.platform !== 'win32') return false
  try {
    const iconPath = path.join(__dirname, '../../build/icons/icon.png')
    const sourceIcon = nativeImage.createFromPath(iconPath)
    if (sourceIcon.isEmpty()) throw new Error(`托盘图标无效：${iconPath}`)
    const trayIcon = sourceIcon.resize({ width: 16, height: 16 })
    trayController = createWindowsTrayController({
      app,
      Tray,
      Menu,
      icon: trayIcon,
      userDataPath: app.getPath('userData'),
      showWindow: showMainWindow,
      logger
    })
    return true
  } catch (error) {
    logger.error('创建 Windows 系统托盘失败', {
      message: error?.message,
      stack: error?.stack
    })
    trayController = null
    return false
  }
}

// 单实例锁：防止多实例导致 IPC 重复注册和数据文件竞争写入。
if (!isMcpMode) {
  const hasLock = app.requestSingleInstanceLock()
  if (!hasLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      showMainWindow()
    })
  }
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err?.message, stack: err?.stack })
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) })
})

function registerAllHandlers() {
  registerPortsHandlers()
  registerSystemHandlers()
  registerAppHandlers()
  registerQuickLaunchHandlers()
  registerClipboardHandlers()
  registerSftpHandlers()
  registerGptImageHandlers()
  registerModelTestHandlers()
  registerAiOpsHandlers()
  registerDataBackupHandlers()
}

if (isMcpMode) {
  // 安装包也可作为 MCP stdio 进程启动，不创建窗口、不注册写操作 IPC。
  app.whenReady().then(() => {
    logger.initLogger({ userDataPath: app.getPath('userData') })
    const { startMcpServer } = require('./mcp-server')
    startMcpServer({ userDataPath: app.getPath('userData') })
  })
} else {
  app.whenReady().then(() => {
    // safeStorage 在 app ready 后才保证可用，因此 IPC 处理器也在此时注册。
    logger.initLogger({ userDataPath: app.getPath('userData') })
    logger.info('应用启动', { version: app.getVersion(), platform: process.platform })
    const hasWindowsTray = createWindowsTray()
    const mainWindow = createManagedWindow({ showOnReady: !startHidden || !hasWindowsTray })
    installMacApplicationMenu({
      app,
      Menu,
      shell,
      getMainWindow,
      showMainWindow,
      logger
    })
    macDesktopController = createMacDesktopController({
      app,
      Menu,
      shell,
      ipcMain,
      userDataPath: app.getPath('userData'),
      getMainWindow,
      showMainWindow,
      refreshWindowsTray: () => trayController?.refresh(),
      logger
    })
    macDesktopController.initialize()
    if (isSmokeTest) {
      const smokeTimeout = setTimeout(() => {
        logger.error('打包应用 smoke test 超时')
        app.exit(1)
      }, 30_000)
      smokeTimeout.unref()
      mainWindow.webContents.once('did-finish-load', async () => {
        try {
          const result = await runPackagedRendererSmokeAssertions(mainWindow.webContents)
          logger.info('打包应用 smoke test 通过', result)
          app.exit(0)
        } catch (error) {
          logger.error('打包应用 smoke test 断言失败', {
            message: error?.message,
            stack: error?.stack
          })
          app.exit(1)
        } finally {
          clearTimeout(smokeTimeout)
        }
      })
      mainWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        clearTimeout(smokeTimeout)
        logger.error('打包应用 smoke test 加载失败', { errorCode, errorDescription })
        app.exit(1)
      })
    }
    initializeOpsNotificationService({
      userDataPath: app.getPath('userData'),
      getWindow: getMainWindow
    })
    initializeAutoBackupScheduler({ userDataPath: app.getPath('userData') })
    registerAllHandlers()

    app.on('activate', () => {
      showMainWindow()
    })
  })

  app.on('before-quit', () => {
    trayController?.markQuitting()
  })

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return
    if (process.platform === 'win32' && trayController?.shouldKeepAlive()) return
    app.quit()
  })

  // 应用退出时关闭后台任务、托盘和 SFTP 连接。
  app.on('will-quit', async () => {
    stopNodeServiceMonitor()
    stopOpsNotificationService()
    stopAutoBackupScheduler()
    macDesktopController?.destroy()
    macDesktopController = null
    trayController?.destroy()
    trayController = null
    await closeSftpConnection()
  })
}
