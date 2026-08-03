const fs = require('node:fs')
const path = require('node:path')
const { app, ipcMain, shell, BrowserWindow, dialog } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { readJsonFile, writeJsonFile } = require('../utils/json-store')
const { normalizeExternalUrl, openExternalUrl } = require('../utils/external-url')
const { parseWebsiteBatch, makeWebsiteExport } = require('../utils/quicklaunch-websites')
const { readQuickLaunchState, makeQuickLaunchState } = require('../utils/quicklaunch-storage')

// 数据存储路径
const userDataPath = app.getPath('userData')
const quickLaunchFile = path.join(userDataPath, 'quick-launch.json')

/**
 * 注册快捷启动相关的 IPC 处理器
 */
function registerQuickLaunchHandlers() {
  ipcMain.handle(IPC_CHANNELS.QUICKLAUNCH_GET, async () => {
    return readQuickLaunchState(readJsonFile(quickLaunchFile, null))
  })

  ipcMain.handle(IPC_CHANNELS.QUICKLAUNCH_SAVE, async (_event, items) => {
    // 基本数据校验
    if (!Array.isArray(items)) {
      return false
    }
    return writeJsonFile(quickLaunchFile, makeQuickLaunchState(items))
  })

  ipcMain.handle(IPC_CHANNELS.QUICKLAUNCH_LAUNCH, async (_event, item) => {
    try {
      if (!item || !item.target) {
        return false
      }

      // URL 类型使用系统默认浏览器（支持直接输入 example.com）。
      if (item.type === 'url') {
        const url = normalizeExternalUrl(item.target)
        await openExternalUrl(url, { shell })
        return { ok: true, target: url }
      }

      // 文件/文件夹类型使用 openPath。
      const error = await shell.openPath(item.target)
      if (error) {
        return { ok: false, error }
      }
      return { ok: true }
    } catch (err) {
      const error = err instanceof Error ? err.message : '启动失败，请检查目标地址或路径'
      console.error('启动失败:', err)
      return { ok: false, error }
    }
  })

  ipcMain.handle(IPC_CHANNELS.QUICKLAUNCH_LAUNCH_URLS, async (_event, items) => {
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, opened: 0, failed: 0, error: '请先配置需要一键打开的网站' }
    }
    if (items.length > 50) {
      return { ok: false, opened: 0, failed: items.length, error: '单次最多打开 50 个网站' }
    }

    const targets = new Set()
    const errors = []
    let opened = 0

    for (const item of items) {
      try {
        if (!item || item.type !== 'url' || !item.target) {
          throw new Error('配置项不是有效网址')
        }
        const url = normalizeExternalUrl(item.target)
        if (targets.has(url)) continue
        targets.add(url)
        await openExternalUrl(url, { shell })
        opened += 1
      } catch (error) {
        errors.push({
          name: typeof item?.name === 'string' ? item.name : '未命名网站',
          error: error instanceof Error ? error.message : '打开失败'
        })
      }
    }

    return {
      ok: errors.length === 0 && opened > 0,
      opened,
      failed: errors.length,
      errors: errors.slice(0, 5),
      error: opened === 0 ? errors[0]?.error || '没有可打开的网站' : ''
    }
  })

  ipcMain.handle(IPC_CHANNELS.QUICKLAUNCH_PARSE_URLS, async (_event, raw) => {
    try {
      if (typeof raw !== 'string' || !raw.trim() || raw.length > 1024 * 1024) {
        return { ok: false, error: 'JSON 内容不能为空且不能超过 1 MB' }
      }
      return { ok: true, ...parseWebsiteBatch(raw) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '解析网址 JSON 失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.QUICKLAUNCH_IMPORT_URLS, async () => {
    try {
      const focused = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(focused, {
        title: '导入网址快捷方式 JSON',
        properties: ['openFile'],
        filters: [{ name: 'JSON 文件', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false, canceled: true }
      }

      const stat = fs.statSync(result.filePaths[0])
      if (!stat.isFile() || stat.size > 1024 * 1024) {
        return { ok: false, error: '请选择不超过 1 MB 的 JSON 文件' }
      }

      const raw = fs.readFileSync(result.filePaths[0], 'utf8')
      return { ok: true, ...parseWebsiteBatch(raw) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '读取 JSON 文件失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.QUICKLAUNCH_EXPORT_URLS, async (_event, items) => {
    try {
      const focused = BrowserWindow.getFocusedWindow()
      const result = await dialog.showSaveDialog(focused, {
        title: '导出网址快捷方式 JSON',
        defaultPath: 'quick-launch-websites.json',
        filters: [{ name: 'JSON 文件', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true }
      }

      const payload = makeWebsiteExport(items)
      fs.writeFileSync(result.filePath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      return { ok: true, filePath: result.filePath, count: payload.items.length }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '导出 JSON 文件失败' }
    }
  })
}

module.exports = { registerQuickLaunchHandlers }
