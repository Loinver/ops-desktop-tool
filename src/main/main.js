const { app, BrowserWindow } = require('electron')
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
const { initializeOpsNotificationService, stopOpsNotificationService } = require('./ops-notification-service')

const isMcpMode = process.argv.includes('--mcp')

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
}

if (isMcpMode) {
  // 安装包也可作为 MCP stdio 进程启动，不创建窗口、不注册写操作 IPC。
  app.whenReady().then(() => {
    const { startMcpServer } = require('./mcp-server')
    startMcpServer({ userDataPath: app.getPath('userData') })
  })
} else {
  app.whenReady().then(() => {
    // safeStorage 在 app ready 后才保证可用，因此 IPC 处理器也在此时注册。
    createWindow()
    initializeOpsNotificationService({ userDataPath: app.getPath('userData'), getWindow: getMainWindow })
    registerAllHandlers()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // 应用退出时关闭 SFTP 连接
  app.on('will-quit', async () => {
    stopNodeServiceMonitor()
    stopOpsNotificationService()
    await closeSftpConnection()
  })
}
