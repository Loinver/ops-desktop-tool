const path = require('node:path')
const { app, ipcMain, clipboard, nativeImage } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { readJsonFile, writeJsonFile } = require('../utils/json-store')

// 数据存储路径
const userDataPath = app.getPath('userData')
const clipboardHistoryFile = path.join(userDataPath, 'clipboard-history.json')

let lastClipboardContent = ''

/**
 * 注册剪贴板相关的 IPC 处理器
 */
function registerClipboardHandlers() {
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_GET_HISTORY, async () => {
    return readJsonFile(clipboardHistoryFile)
  })

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_SAVE_HISTORY, async (_event, history) => {
    if (!Array.isArray(history)) {
      return false
    }
    return writeJsonFile(clipboardHistoryFile, history)
  })

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ, async () => {
    try {
      // 检查是否有图片
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL()
        // 避免重复
        if (dataUrl === lastClipboardContent) return null
        lastClipboardContent = dataUrl
        return { type: 'image', content: dataUrl }
      }

      // 检查文本
      const text = clipboard.readText()
      if (text && text !== lastClipboardContent) {
        lastClipboardContent = text
        return { type: 'text', content: text }
      }

      return null
    } catch (err) {
      console.error('读取剪贴板失败:', err)
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, async (_event, content) => {
    try {
      if (typeof content !== 'string') {
        return false
      }

      if (content.startsWith('data:image')) {
        const image = nativeImage.createFromDataURL(content)
        clipboard.writeImage(image)
      } else {
        clipboard.writeText(content)
      }
      lastClipboardContent = content
      return true
    } catch (err) {
      console.error('写入剪贴板失败:', err)
      return false
    }
  })
}

module.exports = { registerClipboardHandlers }
