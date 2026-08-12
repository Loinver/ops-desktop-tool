const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_IMAGE_COUNT = 4
const MAX_ORIGINAL_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_ORIGINAL_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 20_000
const MAX_IMAGE_PIXELS = 40_000_000
const MAX_NORMALIZED_IMAGE_DIMENSION = 1_600
const MAX_NORMALIZED_IMAGE_BYTES = Math.floor(1.5 * 1024 * 1024)
const MAX_PREVIEW_DATA_URL_CHARS = 70_000
const IMAGE_EVIDENCE_TTL_MS = 30 * 60 * 1000
const IMAGE_EVIDENCE_NOT_FOUND_ERROR = '图片证据不存在或已过期'
const IMAGE_EVIDENCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const IMAGE_FORMATS = new Map([
  ['png', { mimeType: 'image/png' }],
  ['jpg', { mimeType: 'image/jpeg' }],
  ['jpeg', { mimeType: 'image/jpeg' }],
  ['webp', { mimeType: 'image/webp' }]
])
const evidenceBySender = new Map()

function scheduleEvidenceCleanup(options) {
  if (options.now !== undefined || options.clock !== undefined) return
  const timer = setTimeout(() => cleanupImageEvidence(), IMAGE_EVIDENCE_TTL_MS + 1000)
  timer.unref?.()
}

function isOptionsObject(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    keys.some((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
}

function senderIdOf(sender) {
  const value =
    sender && typeof sender === 'object' && Object.prototype.hasOwnProperty.call(sender, 'id')
      ? sender.id
      : sender
  if (value === undefined || value === null || value === '') return ''
  return String(value)
}

function nowOf(value) {
  if (typeof value === 'function') {
    const result = Number(value())
    return Number.isFinite(result) ? result : Date.now()
  }
  const result = Number(value)
  return Number.isFinite(result) ? result : Date.now()
}

function currentTime(options = {}) {
  return nowOf(options.clock ?? options.now)
}

function normalizeEvidenceId(value) {
  const id = String(value || '')
    .trim()
    .toLowerCase()
  return IMAGE_EVIDENCE_ID_PATTERN.test(id) ? id : ''
}

function unsupportedFormatError() {
  return new Error('仅支持 PNG、JPG、JPEG、WEBP 图片')
}

function evidenceNotFoundError() {
  return new Error(IMAGE_EVIDENCE_NOT_FOUND_ERROR)
}

function imageFormat(filePath) {
  const extension = path
    .extname(String(filePath || '').replace(/\\/g, '/'))
    .slice(1)
    .toLowerCase()
  const format = IMAGE_FORMATS.get(extension)
  if (!format) throw unsupportedFormatError()
  return { extension, ...format }
}

function publicFileName(filePath) {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/')
  return path.basename(normalizedPath)
}

function getSenderStore(sender, create = false) {
  const senderId = senderIdOf(sender)
  if (!senderId) return null
  let store = evidenceBySender.get(senderId)
  if (!store && create) {
    store = new Map()
    evidenceBySender.set(senderId, store)
  }
  return store || null
}

function removeExpiredFromStore(store, now) {
  if (!store) return 0
  let removed = 0
  for (const [id, record] of store) {
    if (record.expiresAt <= now) {
      store.delete(id)
      removed += 1
    }
  }
  return removed
}

function removeEmptySenderStore(sender) {
  const senderId = senderIdOf(sender)
  const store = senderId ? evidenceBySender.get(senderId) : null
  if (store && store.size === 0) evidenceBySender.delete(senderId)
}

function resizeToDimension(image, width, height) {
  if (!image || typeof image.resize !== 'function') throw new Error('图片缩放接口不可用')
  const resized = image.resize({ width, height, quality: 'best' })
  if (!resized) throw new Error('图片缩放失败')
  return resized
}

function imageDimensions(image) {
  if (!image || typeof image.isEmpty !== 'function' || image.isEmpty()) {
    throw new Error('图片解码失败')
  }
  if (typeof image.getSize !== 'function') throw new Error('图片尺寸无效或超过 20000px')
  const size = image.getSize()
  const width = Number(size?.width)
  const height = Number(size?.height)
  return validatedHeaderDimensions(width, height)
}

function decodeImage(nativeImage, file) {
  if (!nativeImage || typeof nativeImage !== 'object') {
    throw new Error('图片解码接口不可用')
  }

  let image = null
  if (typeof nativeImage.createFromBuffer === 'function') {
    try {
      image = nativeImage.createFromBuffer(file.buffer)
    } catch {
      image = null
    }
  }
  if (
    (!image || typeof image.isEmpty !== 'function' || image.isEmpty()) &&
    typeof nativeImage.createFromDataURL === 'function'
  ) {
    try {
      image = nativeImage.createFromDataURL(
        `data:${file.mimeType};base64,${file.buffer.toString('base64')}`
      )
    } catch {
      image = null
    }
  }
  return image
}

function validatedHeaderDimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('图片尺寸无效或像素总量过大')
  }
  return { width, height }
}

function pngHeaderDimensions(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(signature) ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('图片文件内容与扩展名不匹配')
  }
  return validatedHeaderDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20))
}

function jpegHeaderDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('图片文件内容与扩展名不匹配')
  }
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ])
  let offset = 2
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1
    if (offset >= buffer.length) break
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) break
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    if (sofMarkers.has(marker)) {
      if (segmentLength < 7) break
      return validatedHeaderDimensions(
        buffer.readUInt16BE(offset + 5),
        buffer.readUInt16BE(offset + 3)
      )
    }
    offset += segmentLength
  }
  throw new Error('无法读取 JPEG 图片尺寸')
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
}

function webpHeaderDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('图片文件内容与扩展名不匹配')
  }
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return validatedHeaderDimensions(readUInt24LE(buffer, 24) + 1, readUInt24LE(buffer, 27) + 1)
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b1 = buffer[21]
    const b2 = buffer[22]
    const b3 = buffer[23]
    const b4 = buffer[24]
    return validatedHeaderDimensions(
      1 + (b1 | ((b2 & 0x3f) << 8)),
      1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10))
    )
  }
  if (
    chunk === 'VP8 ' &&
    buffer.length >= 30 &&
    buffer[23] === 0x9d &&
    buffer[24] === 0x01 &&
    buffer[25] === 0x2a
  ) {
    return validatedHeaderDimensions(
      buffer.readUInt16LE(26) & 0x3fff,
      buffer.readUInt16LE(28) & 0x3fff
    )
  }
  throw new Error('无法读取 WEBP 图片尺寸')
}

function imageHeaderDimensions(buffer, extension) {
  if (extension === 'png') return pngHeaderDimensions(buffer)
  if (extension === 'jpg' || extension === 'jpeg') return jpegHeaderDimensions(buffer)
  if (extension === 'webp') return webpHeaderDimensions(buffer)
  throw unsupportedFormatError()
}

function targetDimensions(width, height, maxDimension) {
  const longest = Math.max(width, height)
  const scale = Math.min(1, maxDimension / longest)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

function encodedBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  return null
}

function encodePng(image) {
  if (typeof image?.toPNG !== 'function') return null
  return encodedBuffer(image.toPNG())
}

function encodeJpeg(image, quality) {
  if (typeof image?.toJPEG !== 'function') return null
  return encodedBuffer(image.toJPEG(quality))
}

function normalizedImage(image, sourceSize) {
  const dimensions = targetDimensions(
    sourceSize.width,
    sourceSize.height,
    MAX_NORMALIZED_IMAGE_DIMENSION
  )
  const dimensionsToTry = [
    dimensions,
    ...[1400, 1200, 1000, 800, 640, 480, 320]
      .map((maxDimension) => targetDimensions(sourceSize.width, sourceSize.height, maxDimension))
      .filter(
        (candidate) =>
          candidate.width !== dimensions.width || candidate.height !== dimensions.height
      )
  ]

  const firstResized = resizeToDimension(image, dimensions.width, dimensions.height)
  const png = encodePng(firstResized)
  if (png && png.length <= MAX_NORMALIZED_IMAGE_BYTES) {
    return { buffer: png, mimeType: 'image/png', ...dimensions }
  }

  for (const candidateDimensions of dimensionsToTry) {
    const resized =
      candidateDimensions === dimensions
        ? firstResized
        : resizeToDimension(image, candidateDimensions.width, candidateDimensions.height)
    for (const quality of [92, 84, 76, 68, 60, 50, 40]) {
      const jpeg = encodeJpeg(resized, quality)
      if (jpeg && jpeg.length <= MAX_NORMALIZED_IMAGE_BYTES) {
        return { buffer: jpeg, mimeType: 'image/jpeg', ...candidateDimensions }
      }
    }
  }

  throw new Error('无法将图片规范化到受限大小')
}

function previewDataUrl(image, sourceSize) {
  const previewDimensions = [384, 320, 256, 192, 160, 128, 96, 64].map((maxDimension) =>
    targetDimensions(sourceSize.width, sourceSize.height, maxDimension)
  )

  for (const dimensions of previewDimensions) {
    const resized = resizeToDimension(image, dimensions.width, dimensions.height)
    const png = encodePng(resized)
    if (png) {
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`
      if (dataUrl.length <= MAX_PREVIEW_DATA_URL_CHARS) return dataUrl
    }
    const jpeg = encodeJpeg(resized, 72)
    if (jpeg) {
      const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
      if (dataUrl.length <= MAX_PREVIEW_DATA_URL_CHARS) return dataUrl
    }
  }

  throw new Error('无法生成受限大小的图片预览')
}

async function validateInputFiles(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('至少选择一张图片')
  }
  if (filePaths.length > MAX_IMAGE_COUNT) throw new Error(`最多选择 ${MAX_IMAGE_COUNT} 张图片`)

  const files = []
  let totalBytes = 0
  for (const filePath of filePaths) {
    const value = String(filePath || '').trim()
    const format = imageFormat(value)
    let stat
    try {
      stat = await fs.stat(value)
    } catch {
      throw new Error('图片文件不存在或无法读取')
    }
    if (!stat.isFile()) throw new Error('图片文件不存在或无法读取')
    if (!Number.isSafeInteger(stat.size) || stat.size <= 0) throw new Error('图片文件为空')
    if (stat.size > MAX_ORIGINAL_IMAGE_BYTES) {
      throw new Error('单张图片不得超过 12 MiB')
    }
    let buffer
    try {
      buffer = await fs.readFile(value)
    } catch {
      throw new Error('图片文件不存在或无法读取')
    }
    if (buffer.length <= 0) throw new Error('图片文件为空')
    if (buffer.length > MAX_ORIGINAL_IMAGE_BYTES) {
      throw new Error('单张图片不得超过 12 MiB')
    }
    totalBytes += buffer.length
    if (totalBytes > MAX_TOTAL_ORIGINAL_IMAGE_BYTES) {
      throw new Error('图片总大小不得超过 32 MiB')
    }
    const headerSize = imageHeaderDimensions(buffer, format.extension)
    files.push({
      name: publicFileName(value),
      ...format,
      buffer,
      headerSize,
      originalSizeBytes: buffer.length
    })
  }
  return files
}

function createRecord(file, sourceSize, normalized, preview, now) {
  return {
    id: crypto.randomUUID().toLowerCase(),
    name: file.name,
    mimeType: normalized.mimeType,
    data: normalized.buffer.toString('base64'),
    previewDataUrl: preview,
    width: normalized.width,
    height: normalized.height,
    sizeBytes: normalized.buffer.length,
    sourceWidth: sourceSize.width,
    sourceHeight: sourceSize.height,
    createdAt: now,
    expiresAt: now + IMAGE_EVIDENCE_TTL_MS
  }
}

function metadataOf(record) {
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    previewDataUrl: record.previewDataUrl,
    width: record.width,
    height: record.height,
    sizeBytes: record.sizeBytes
  }
}

function providerImageOf(record) {
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    data: record.data,
    width: record.width,
    height: record.height,
    sizeBytes: record.sizeBytes
  }
}

function importOptions(input, filePaths, nativeImage, now) {
  if (
    isOptionsObject(input, [
      'sender',
      'senderId',
      'filePaths',
      'paths',
      'nativeImage',
      'now',
      'clock'
    ])
  ) {
    return input
  }
  return { sender: input, filePaths, nativeImage, now }
}

function resolveOptions(input, id, now) {
  if (isOptionsObject(input, ['sender', 'senderId', 'now', 'clock'])) return input
  return { sender: input, id, now }
}

function senderOptions(input, now) {
  if (isOptionsObject(input, ['sender', 'senderId', 'now', 'clock'])) return input
  if (typeof input === 'number' || typeof input === 'string') return { sender: input, now }
  return { sender: input, now }
}

async function importImageEvidence(input, filePaths, nativeImage, now) {
  const options = importOptions(input, filePaths, nativeImage, now)
  const sender = options.sender ?? options.senderId
  const store = getSenderStore(sender, true)
  if (!store) throw new Error('发送方无效')

  const currentTimeMs = currentTime(options)
  removeExpiredFromStore(store, currentTimeMs)
  const paths = options.filePaths ?? options.paths ?? options.filePath
  const selectedPaths = Array.isArray(paths) ? paths : paths ? [paths] : []
  if (store.size + selectedPaths.length > MAX_IMAGE_COUNT) {
    throw new Error(`最多选择 ${MAX_IMAGE_COUNT} 张图片`)
  }
  const files = await validateInputFiles(selectedPaths)
  if (
    !options.nativeImage ||
    (typeof options.nativeImage.createFromBuffer !== 'function' &&
      typeof options.nativeImage.createFromDataURL !== 'function')
  ) {
    throw new Error('图片解码接口不可用')
  }

  const records = []
  for (const file of files) {
    // 直接解码刚刚完成格式、容量和像素校验的同一份内存字节，避免路径文件在校验后被替换。
    const image = decodeImage(options.nativeImage, file)
    const sourceSize = imageDimensions(image)
    const normalized = normalizedImage(image, sourceSize)
    const preview = previewDataUrl(image, sourceSize)
    records.push(createRecord(file, sourceSize, normalized, preview, currentTimeMs))
  }

  // 文件读取与解码之间存在 await；落库前再次检查，避免并发 IPC 绕过数量限制。
  if (store.size + records.length > MAX_IMAGE_COUNT) {
    throw new Error(`最多选择 ${MAX_IMAGE_COUNT} 张图片`)
  }
  for (const record of records) store.set(record.id, record)
  scheduleEvidenceCleanup(options)
  return records.map(metadataOf)
}

function resolveImageEvidence(input, id, now) {
  const options = resolveOptions(input, id, now)
  const sender = options.sender ?? options.senderId
  const store = getSenderStore(sender)
  const currentTimeMs = currentTime(options)
  removeExpiredFromStore(store, currentTimeMs)
  removeEmptySenderStore(sender)
  const evidenceId = normalizeEvidenceId(options.id ?? id)
  if (!store || !evidenceId) throw evidenceNotFoundError()
  const record = store.get(evidenceId)
  if (!record || record.expiresAt <= currentTimeMs) {
    store?.delete(evidenceId)
    removeEmptySenderStore(sender)
    throw evidenceNotFoundError()
  }
  return providerImageOf(record)
}

function listImageEvidence(input, now) {
  const options = senderOptions(input, now)
  const sender = options.sender ?? options.senderId
  const store = getSenderStore(sender)
  const currentTimeMs = currentTime(options)
  removeExpiredFromStore(store, currentTimeMs)
  removeEmptySenderStore(sender)
  return store ? [...store.values()].map(metadataOf) : []
}

function removeImageEvidence(input, id, now) {
  const options = resolveOptions(input, id, now)
  const sender = options.sender ?? options.senderId
  const store = getSenderStore(sender)
  const currentTimeMs = currentTime(options)
  removeExpiredFromStore(store, currentTimeMs)
  const evidenceId = normalizeEvidenceId(options.id ?? id)
  const removed = Boolean(store && evidenceId && store.delete(evidenceId))
  removeEmptySenderStore(sender)
  return removed
}

function clearImageEvidence(input, now) {
  const options = senderOptions(input, now)
  const senderId = senderIdOf(options.sender ?? options.senderId)
  if (!senderId) return 0
  const store = evidenceBySender.get(senderId)
  const removed = store?.size || 0
  evidenceBySender.delete(senderId)
  return removed
}

function cleanupImageEvidence(input, now) {
  let options
  if (isOptionsObject(input, ['sender', 'senderId', 'now', 'clock'])) {
    options = input
  } else if (input === undefined || typeof input === 'number' || typeof input === 'function') {
    options = { now: input ?? now }
  } else {
    options = { sender: input, now }
  }
  const currentTimeMs = currentTime(options)
  const sender = options.sender ?? options.senderId
  const senderIds = sender === undefined ? [...evidenceBySender.keys()] : [senderIdOf(sender)]
  let removed = 0
  for (const senderId of senderIds) {
    const store = evidenceBySender.get(senderId)
    removed += removeExpiredFromStore(store, currentTimeMs)
    if (store?.size === 0) evidenceBySender.delete(senderId)
  }
  return removed
}

module.exports = {
  IMAGE_EVIDENCE_ID_PATTERN,
  IMAGE_EVIDENCE_NOT_FOUND_ERROR,
  IMAGE_EVIDENCE_TTL_MS,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_NORMALIZED_IMAGE_BYTES,
  MAX_NORMALIZED_IMAGE_DIMENSION,
  MAX_ORIGINAL_IMAGE_BYTES,
  MAX_PREVIEW_DATA_URL_CHARS,
  MAX_TOTAL_ORIGINAL_IMAGE_BYTES,
  cleanup: cleanupImageEvidence,
  cleanupImageEvidence,
  clear: clearImageEvidence,
  clearImageEvidence,
  import: importImageEvidence,
  importImageEvidence,
  list: listImageEvidence,
  listImageEvidence,
  normalizeEvidenceId,
  remove: removeImageEvidence,
  removeImageEvidence,
  resolve: resolveImageEvidence,
  resolveImageEvidence
}
