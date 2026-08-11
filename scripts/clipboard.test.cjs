const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Module = require('node:module')

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-clipboard-test-'))
const handlers = new Map()
let clipboardText = ''
let writtenImage = null
let clipboardImage = { isEmpty: () => true }

const originalLoad = Module._load
Module._load = function loadWithElectronMock(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => testRoot },
      clipboard: {
        readImage: () => clipboardImage,
        readText: () => clipboardText,
        writeImage: (image) => {
          writtenImage = image
        },
        writeText: (text) => {
          clipboardText = text
        }
      },
      ipcMain: {
        handle: (channel, handler) => {
          handlers.set(channel, handler)
        }
      },
      nativeImage: {
        createFromDataURL: (dataUrl) => ({
          dataUrl,
          isEmpty: () => false
        })
      }
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const { IPC_CHANNELS } = require('../src/shared/ipc-channels')
const { __testables, registerClipboardHandlers } = require('../src/main/ipc/clipboard')
Module._load = originalLoad

registerClipboardHandlers()

const {
  CLIPBOARD_LIMITS,
  MAX_HISTORY_BYTES,
  MAX_HISTORY_ITEMS,
  MAX_IMAGE_DATA_BYTES,
  MAX_RECORD_ID_CHARS,
  MAX_TEXT_BYTES,
  decodedImageDataUrlBytes,
  persistedHistoryBytes,
  sanitizeHistory,
  sanitizeHistoryRecord,
  validateClipboardContent
} = __testables

const historyFile = path.join(testRoot, 'clipboard-history.json')

function textRecord(content, id = 'text-1') {
  return { id, type: 'text', content, timestamp: 1 }
}

function imageDataUrl(bytes) {
  return `data:image/png;base64,${Buffer.alloc(bytes, 7).toString('base64')}`
}

test.after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true })
})

test('文本限制按 UTF-8 字节数执行', () => {
  const fittingText = '🙂'.repeat(MAX_TEXT_BYTES / 4)
  const oversizedText = `${fittingText}a`

  assert.equal(validateClipboardContent(fittingText).type, 'text')
  assert.equal(validateClipboardContent(oversizedText), null)
  assert.equal(sanitizeHistory([textRecord(fittingText)]).length, 1)
  assert.equal(sanitizeHistory([textRecord(oversizedText)]).length, 0)
})

test('图片限制按 Base64 解码后的字节数执行', () => {
  const fittingImage = imageDataUrl(MAX_IMAGE_DATA_BYTES)
  const oversizedImage = imageDataUrl(MAX_IMAGE_DATA_BYTES + 1)

  assert.equal(decodedImageDataUrlBytes(fittingImage), MAX_IMAGE_DATA_BYTES)
  assert.equal(decodedImageDataUrlBytes(oversizedImage), null)
  assert.equal(validateClipboardContent(fittingImage).type, 'image')
  assert.equal(validateClipboardContent(oversizedImage), null)
})

test('历史记录超过总持久化配额时保留前面的有效项目', () => {
  const records = Array.from({ length: 24 }, (_, index) =>
    textRecord('x'.repeat(MAX_TEXT_BYTES), `text-${index}`)
  )
  const sanitized = sanitizeHistory(records)

  assert.ok(sanitized.length < records.length)
  assert.ok(sanitized.length > 0)
  assert.ok(persistedHistoryBytes(sanitized) <= MAX_HISTORY_BYTES)
  assert.equal(sanitized[0].id, 'text-0')
  assert.equal(sanitized.at(-1).id, `text-${sanitized.length - 1}`)
})

test('历史记录最多保留 200 个有效项目', () => {
  const records = Array.from({ length: MAX_HISTORY_ITEMS + 10 }, (_, index) =>
    textRecord(`item-${index}`, `text-${index}`)
  )

  assert.equal(sanitizeHistory(records).length, MAX_HISTORY_ITEMS)
  assert.deepEqual(sanitizeHistoryRecord(records[0]), records[0])
})

test('无效对象和字段不会进入历史记录', () => {
  const valid = textRecord('valid', 'valid')
  const invalidRecords = [
    null,
    {},
    { ...valid, id: '' },
    { ...valid, type: 'unknown' },
    { ...valid, content: 123 },
    { ...valid, timestamp: '1' },
    { ...valid, content: 'data:image/png;base64,not-base64' },
    { ...valid, content: imageDataUrl(MAX_IMAGE_DATA_BYTES + 1) }
  ]

  assert.deepEqual(sanitizeHistory([...invalidRecords, valid]), [valid])
  assert.deepEqual(sanitizeHistory([{ ...valid, extra: 'discarded' }]), [valid])
})

test('IPC 读取和保存都会修复无效历史记录', async () => {
  const valid = textRecord('valid', 'valid')
  const rawHistory = [{ ...valid, extra: 'discarded' }, { ...valid, type: 'unknown' }, valid]
  fs.writeFileSync(historyFile, JSON.stringify(rawHistory))

  const getHistory = handlers.get(IPC_CHANNELS.CLIPBOARD_GET_HISTORY)
  const saveHistory = handlers.get(IPC_CHANNELS.CLIPBOARD_SAVE_HISTORY)
  const result = await getHistory()

  assert.deepEqual(result, [valid, valid])
  assert.deepEqual(JSON.parse(fs.readFileSync(historyFile, 'utf8')), [valid, valid])
  assert.deepEqual(await saveHistory(null, rawHistory), { ok: true, history: [valid, valid] })
  assert.deepEqual(JSON.parse(fs.readFileSync(historyFile, 'utf8')), [valid, valid])
  assert.deepEqual(await saveHistory(null, 'invalid'), {
    ok: false,
    error: '剪贴板历史格式无效'
  })
})

test('读取历史前会拒绝超过总容量的旧文件，记录标识也有长度限制', async () => {
  fs.writeFileSync(historyFile, ' '.repeat(MAX_HISTORY_BYTES + 1))
  const getHistory = handlers.get(IPC_CHANNELS.CLIPBOARD_GET_HISTORY)
  assert.deepEqual(await getHistory(), [])
  assert.deepEqual(JSON.parse(fs.readFileSync(historyFile, 'utf8')), [])
  assert.equal(
    sanitizeHistoryRecord(textRecord('valid', 'x'.repeat(MAX_RECORD_ID_CHARS + 1))),
    null
  )
})

test('IPC 写入拒绝超限内容并保留正常剪贴板写入', async () => {
  const writeClipboard = handlers.get(IPC_CHANNELS.CLIPBOARD_WRITE)
  const validImage = imageDataUrl(3)

  assert.equal(await writeClipboard(null, 'x'.repeat(MAX_TEXT_BYTES + 1)), false)
  assert.equal(await writeClipboard(null, imageDataUrl(MAX_IMAGE_DATA_BYTES + 1)), false)
  assert.equal(await writeClipboard(null, 'safe text'), true)
  assert.equal(clipboardText, 'safe text')
  assert.equal(await writeClipboard(null, validImage), true)
  assert.equal(writtenImage.dataUrl, validImage)
})

test('IPC 读取拒绝超限内容并返回已校验内容', async () => {
  const readClipboard = handlers.get(IPC_CHANNELS.CLIPBOARD_READ)
  clipboardImage = { isEmpty: () => true }
  clipboardText = 'x'.repeat(MAX_TEXT_BYTES + 1)
  assert.equal(await readClipboard(), null)

  clipboardText = 'safe read'
  assert.deepEqual(await readClipboard(), { type: 'text', content: 'safe read' })

  const image = imageDataUrl(4)
  clipboardImage = { isEmpty: () => false, toDataURL: () => image }
  assert.deepEqual(await readClipboard(), { type: 'image', content: image })
})

test('公开的限制与实现保持一致', () => {
  assert.deepEqual(CLIPBOARD_LIMITS, {
    maxItems: MAX_HISTORY_ITEMS,
    maxTextBytes: MAX_TEXT_BYTES,
    maxImageDataBytes: MAX_IMAGE_DATA_BYTES,
    maxHistoryBytes: MAX_HISTORY_BYTES
  })
})
