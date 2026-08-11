const path = require('node:path')
const fs = require('node:fs')
const { app, ipcMain, clipboard, nativeImage } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { readJsonFile, writeJsonFile } = require('../utils/json-store')

const MAX_HISTORY_ITEMS = 200
const MAX_TEXT_BYTES = 1 * 1024 * 1024
const MAX_IMAGE_DATA_BYTES = 5 * 1024 * 1024
const MAX_HISTORY_BYTES = 20 * 1024 * 1024
const MAX_RECORD_ID_CHARS = 128
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_DATA_BYTES / 3) * 4

const CLIPBOARD_LIMITS = Object.freeze({
  maxItems: MAX_HISTORY_ITEMS,
  maxTextBytes: MAX_TEXT_BYTES,
  maxImageDataBytes: MAX_IMAGE_DATA_BYTES,
  maxHistoryBytes: MAX_HISTORY_BYTES
})

const userDataPath = app.getPath('userData')
const clipboardHistoryFile = path.join(userDataPath, 'clipboard-history.json')

let lastClipboardContent = ''

function decodedImageDataUrlBytes(value) {
  if (typeof value !== 'string') return null

  const match = /^data:(image\/[^;,]+)((?:;[^,]*)?),([\s\S]*)$/i.exec(value)
  if (!match) return null

  const parameters = match[2]
    .split(';')
    .map((parameter) => parameter.trim())
    .filter(Boolean)
  if (parameters.at(-1)?.toLowerCase() !== 'base64') return null

  const encoded = match[3].replace(/\s/g, '')
  if (
    !encoded ||
    encoded.length > MAX_IMAGE_BASE64_LENGTH ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    return null
  }

  const decoded = Buffer.from(encoded, 'base64')
  if (
    decoded.length === 0 ||
    decoded.length > MAX_IMAGE_DATA_BYTES ||
    decoded.toString('base64') !== encoded
  ) {
    return null
  }

  return decoded.length
}

function validateClipboardContent(content) {
  if (typeof content !== 'string') return null

  if (/^data:image\//i.test(content)) {
    if (decodedImageDataUrlBytes(content) === null) return null
    return { type: 'image', content }
  }

  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) return null
  return { type: 'text', content }
}

function sanitizeHistoryRecord(record) {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null
    if (
      typeof record.id !== 'string' ||
      record.id.length === 0 ||
      record.id.length > MAX_RECORD_ID_CHARS ||
      typeof record.type !== 'string' ||
      typeof record.content !== 'string' ||
      typeof record.timestamp !== 'number' ||
      !Number.isFinite(record.timestamp)
    ) {
      return null
    }

    const content = validateClipboardContent(record.content)
    if (!content || content.type !== record.type) return null

    return {
      id: record.id,
      type: record.type,
      content: record.content,
      timestamp: record.timestamp
    }
  } catch {
    return null
  }
}

function isCanonicalHistoryRecord(record, sanitizedRecord) {
  try {
    return (
      record &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      Object.keys(record).join(',') === 'id,type,content,timestamp' &&
      record.id === sanitizedRecord.id &&
      record.type === sanitizedRecord.type &&
      record.content === sanitizedRecord.content &&
      record.timestamp === sanitizedRecord.timestamp
    )
  } catch {
    return false
  }
}

function prettyRecordBytes(record) {
  const serialized = JSON.stringify(record, null, 2)
  const lineCount = serialized.split('\n').length
  return Buffer.byteLength(serialized, 'utf8') + lineCount * 2
}

function persistedHistoryBytes(history) {
  return Buffer.byteLength(JSON.stringify(history, null, 2), 'utf8')
}

function sanitizeHistoryResult(history) {
  const sanitized = []
  let changed = !Array.isArray(history)
  let serializedBytes = 2

  if (!Array.isArray(history)) {
    return { history: sanitized, changed }
  }

  try {
    for (const record of history) {
      if (sanitized.length >= MAX_HISTORY_ITEMS) {
        changed = true
        break
      }

      const sanitizedRecord = sanitizeHistoryRecord(record)
      if (!sanitizedRecord) {
        changed = true
        continue
      }

      const recordBytes = prettyRecordBytes(sanitizedRecord)
      const candidateBytes = serializedBytes + 2 + recordBytes
      if (candidateBytes > MAX_HISTORY_BYTES) {
        changed = true
        continue
      }

      sanitized.push(sanitizedRecord)
      serializedBytes = candidateBytes
      if (!isCanonicalHistoryRecord(record, sanitizedRecord)) changed = true
    }
  } catch {
    changed = true
  }

  if (sanitized.length !== history.length) changed = true
  return { history: sanitized, changed }
}

function sanitizeHistory(history) {
  return sanitizeHistoryResult(history).history
}

/**
 * 注册剪贴板相关的 IPC 处理器
 */
function registerClipboardHandlers() {
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_GET_HISTORY, async () => {
    try {
      if (fs.statSync(clipboardHistoryFile).size > MAX_HISTORY_BYTES) {
        writeJsonFile(clipboardHistoryFile, [])
        return []
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('读取剪贴板历史大小失败:', error)
    }
    const result = sanitizeHistoryResult(readJsonFile(clipboardHistoryFile))
    if (result.changed) writeJsonFile(clipboardHistoryFile, result.history)
    return result.history
  })

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_SAVE_HISTORY, async (_event, history) => {
    if (!Array.isArray(history)) {
      return { ok: false, error: '剪贴板历史格式无效' }
    }
    const sanitized = sanitizeHistory(history)
    const ok = writeJsonFile(clipboardHistoryFile, sanitized)
    return ok ? { ok: true, history: sanitized } : { ok: false, error: '剪贴板历史保存失败' }
  })

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ, async () => {
    try {
      // 检查是否有图片
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const dataUrl = image.toDataURL()
        const content = validateClipboardContent(dataUrl)
        if (!content || content.type !== 'image') return null
        // 避免重复
        if (dataUrl === lastClipboardContent) return null
        lastClipboardContent = dataUrl
        return { type: 'image', content: dataUrl }
      }

      // 检查文本
      const text = clipboard.readText()
      const content = validateClipboardContent(text)
      if (content?.type === 'text' && text && text !== lastClipboardContent) {
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
      const validatedContent = validateClipboardContent(content)
      if (!validatedContent) return false

      if (validatedContent.type === 'image') {
        const image = nativeImage.createFromDataURL(content)
        if (image.isEmpty()) return false
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

module.exports = {
  registerClipboardHandlers,
  __testables: {
    CLIPBOARD_LIMITS,
    MAX_HISTORY_ITEMS,
    MAX_TEXT_BYTES,
    MAX_IMAGE_DATA_BYTES,
    MAX_HISTORY_BYTES,
    MAX_RECORD_ID_CHARS,
    decodedImageDataUrlBytes,
    validateClipboardContent,
    sanitizeHistoryRecord,
    sanitizeHistory,
    sanitizeHistoryResult,
    persistedHistoryBytes
  }
}
