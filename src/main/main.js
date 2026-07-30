const { app, BrowserWindow } = require('electron')
const { createWindow } = require('./window')
const { registerPortsHandlers } = require('./ipc/ports')
const { registerSystemHandlers } = require('./ipc/system')
const { registerAppHandlers } = require('./ipc/app')
const { registerQuickLaunchHandlers } = require('./ipc/quicklaunch')
const { registerClipboardHandlers } = require('./ipc/clipboard')
const { registerSftpHandlers, closeSftpConnection } = require('./ipc/sftp')
const { registerGptImageHandlers } = require('./ipc/gpt-image')
const { registerModelTestHandlers } = require('./ipc/model-test')

function registerAllHandlers() {
  registerPortsHandlers()
  registerSystemHandlers()
  registerAppHandlers()
  registerQuickLaunchHandlers()
  registerClipboardHandlers()
  registerSftpHandlers()
  registerGptImageHandlers()
  registerModelTestHandlers()
}

app.whenReady().then(() => {
  // safeStorage 在 app ready 后才保证可用，因此 IPC 处理器也在此时注册。
  registerAllHandlers()
  createWindow()

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
  await closeSftpConnection()
})
