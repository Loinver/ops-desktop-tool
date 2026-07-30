const path = require('node:path')
const { app, ipcMain, BrowserWindow, dialog } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')

function clampText(value, fallback, maxLength = 500) {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

function sanitizeDialogFilters(filters) {
  if (!Array.isArray(filters)) return [{ name: 'All Files', extensions: ['*'] }]
  return filters.slice(0, 10).map((filter) => ({
    name: clampText(filter?.name, 'Files', 80),
    extensions: Array.isArray(filter?.extensions)
      ? filter.extensions.slice(0, 20).map(item => String(item).replace(/^\./, '').slice(0, 20))
      : ['*'],
  }))
}

/**
 * 注册应用通用的 IPC 处理器
 */
function registerAppHandlers() {
  ipcMain.handle(IPC_CHANNELS.APP_INFO, async () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
  }))

  // 确认对话框
  ipcMain.handle(IPC_CHANNELS.APP_CONFIRM, async (_event, options) => {
    const focused = BrowserWindow.getFocusedWindow()
    const result = await dialog.showMessageBox(focused, {
      type: 'warning',
      buttons: ['取消', '确认'],
      defaultId: 0,
      cancelId: 0,
      title: clampText(options?.title, '确认操作', 120),
      message: clampText(options?.message, '确认继续？', 500),
      detail: clampText(options?.detail, '', 2000)
    })

    return result.response === 1
  })

  // 文件/目录浏览对话框
  ipcMain.handle(IPC_CHANNELS.APP_BROWSE_FILE, async (_event, options) => {
    const focused = BrowserWindow.getFocusedWindow()
    const properties = options?.directory
      ? ['openDirectory']
      : ['openFile']

    const result = await dialog.showOpenDialog(focused, {
      properties,
      defaultPath: typeof options?.defaultPath === 'string'
        ? path.resolve(options.defaultPath.slice(0, 4096))
        : undefined,
      filters: sanitizeDialogFilters(options?.filters)
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })
}

module.exports = { registerAppHandlers }
