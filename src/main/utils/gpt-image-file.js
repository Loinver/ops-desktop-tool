const path = require('node:path')

const MAX_IMAGE_BYTES = 50 * 1024 * 1024

const MIME_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg'
}

function normalizeContentType(contentType) {
  return String(contentType || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
}

function extensionForContentType(contentType) {
  return MIME_EXTENSIONS[normalizeContentType(contentType)] || 'png'
}

function decodeDataImageUrl(value) {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/i.exec(String(value || ''))
  if (!match) {
    throw new Error('图片数据格式无效')
  }

  const contentType = normalizeContentType(match[1])
  if (!contentType.startsWith('image/')) {
    throw new Error('仅支持保存图片数据')
  }

  const encoded = match[2].replace(/\s/g, '')
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('图片 Base64 数据无效')
  }

  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length === 0) {
    throw new Error('图片数据为空')
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('图片文件超过 50 MB，无法保存')
  }

  return {
    buffer,
    contentType,
    extension: extensionForContentType(contentType)
  }
}

function buildImageFileName(defaultName, extension = 'png') {
  const safeExtension = String(extension || 'png').replace(/^\.+/, '') || 'png'
  const requestedName = path.basename(String(defaultName || '').trim())
  const baseName = requestedName || `gpt-image-${Date.now()}`

  return path.extname(baseName) ? baseName : `${baseName}.${safeExtension}`
}

function ensureImageExtension(filePath, extension = 'png') {
  const value = String(filePath || '').trim()
  if (!value || path.extname(value)) return value
  return `${value}.${String(extension || 'png').replace(/^\.+/, '') || 'png'}`
}

module.exports = {
  MAX_IMAGE_BYTES,
  normalizeContentType,
  extensionForContentType,
  decodeDataImageUrl,
  buildImageFileName,
  ensureImageExtension
}
