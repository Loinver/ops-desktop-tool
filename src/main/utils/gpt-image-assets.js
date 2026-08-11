const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_ASSET_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_PREVIEW_BYTES = 48 * 1024
const MAX_PREVIEW_DATA_URL_CHARS = 70_000
const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'tiff'])
const assetMutationQueues = new Map()

function normalizeAssetId(value) {
  const assetId = String(value || '')
    .trim()
    .toLowerCase()
  return ASSET_ID_PATTERN.test(assetId) ? assetId : ''
}

function normalizeAssetExtension(value) {
  const extension = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '')
  return ALLOWED_EXTENSIONS.has(extension) ? extension : ''
}

function assetFileName(assetId, extension) {
  const normalizedId = normalizeAssetId(assetId)
  if (!normalizedId) throw new Error('图片资源标识无效')
  const normalizedExtension = normalizeAssetExtension(extension)
  if (!normalizedExtension) throw new Error('不支持保存该图片格式')
  return `${normalizedId}.${normalizedExtension}`
}

function previewDataUrl(buffer, contentType) {
  return `data:${contentType};base64,${buffer.toString('base64')}`
}

function createPreviewDataUrl(image) {
  if (!image || image.isEmpty()) throw new Error('接口返回的文件不是可识别图片')
  const size = image.getSize()
  if (!size.width || !size.height || size.width > 20_000 || size.height > 20_000) {
    throw new Error('图片尺寸无效或过大')
  }

  for (const maxDimension of [384, 320, 256, 192, 160, 128]) {
    const resized = image.resize(
      size.width >= size.height ? { width: maxDimension } : { height: maxDimension }
    )
    const png = resized.toPNG()
    if (png.length <= MAX_PREVIEW_BYTES) return previewDataUrl(png, 'image/png')
    const jpeg = resized.toJPEG(76)
    if (jpeg.length <= MAX_PREVIEW_BYTES) return previewDataUrl(jpeg, 'image/jpeg')
  }
  throw new Error('无法生成受限大小的图片预览')
}

async function listAssets(assetsDir) {
  let entries
  try {
    entries = await fs.readdir(assetsDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const assets = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = /^([0-9a-f-]{36})\.([a-z0-9]+)$/i.exec(entry.name)
    const assetId = normalizeAssetId(match?.[1])
    if (!assetId || !ALLOWED_EXTENSIONS.has(String(match?.[2] || '').toLowerCase())) continue
    const filePath = path.join(assetsDir, entry.name)
    try {
      const stat = await fs.stat(filePath)
      assets.push({ assetId, filePath, size: stat.size, mtimeMs: stat.mtimeMs })
    } catch {}
  }
  return assets
}

function withAssetMutationLock(assetsDir, task) {
  const key = path.resolve(assetsDir)
  const previous = assetMutationQueues.get(key) || Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  assetMutationQueues.set(key, current)
  return current.finally(() => {
    if (assetMutationQueues.get(key) === current) assetMutationQueues.delete(key)
  })
}

async function pruneAssetQuotaUnlocked(
  assetsDir,
  incomingBytes,
  maxTotalBytes = MAX_ASSET_TOTAL_BYTES
) {
  if (incomingBytes > maxTotalBytes) throw new Error('图片资源超过本地存储总容量限制')
  const assets = await listAssets(assetsDir)
  let totalBytes = assets.reduce((sum, asset) => sum + asset.size, 0)
  const removedAssetIds = []
  for (const asset of assets.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (totalBytes + incomingBytes <= maxTotalBytes) break
    await fs.unlink(asset.filePath).catch(() => {})
    totalBytes -= asset.size
    removedAssetIds.push(asset.assetId)
  }
  if (totalBytes + incomingBytes > maxTotalBytes) {
    throw new Error('AI 生图本地存储已满，请清理历史后重试')
  }
  return removedAssetIds
}

async function pruneAssetQuota(assetsDir, incomingBytes, maxTotalBytes = MAX_ASSET_TOTAL_BYTES) {
  return withAssetMutationLock(assetsDir, () =>
    pruneAssetQuotaUnlocked(assetsDir, incomingBytes, maxTotalBytes)
  )
}

async function storeImageAsset({ assetsDir, buffer, extension, nativeImage, maxTotalBytes }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('图片数据为空')
  const image = nativeImage.createFromBuffer(buffer)
  const previewUrl = createPreviewDataUrl(image)
  await fs.mkdir(assetsDir, { recursive: true, mode: 0o700 })

  return withAssetMutationLock(assetsDir, async () => {
    const limit = maxTotalBytes ?? MAX_ASSET_TOTAL_BYTES
    if (buffer.length > limit) throw new Error('图片资源超过本地存储总容量限制')

    const assetId = crypto.randomUUID()
    const filePath = path.join(assetsDir, assetFileName(assetId, extension))
    const stagedPath = `${filePath}.tmp-${crypto.randomUUID()}`
    await fs.writeFile(stagedPath, buffer, { flag: 'wx', mode: 0o600 })

    try {
      const removedAssetIds = await pruneAssetQuotaUnlocked(assetsDir, buffer.length, limit)
      await fs.rename(stagedPath, filePath)
      return { assetId, previewUrl, filePath, removedAssetIds }
    } catch (error) {
      await fs.unlink(stagedPath).catch(() => {})
      throw error
    }
  })
}

async function findImageAsset(assetsDir, value) {
  const assetId = normalizeAssetId(value)
  if (!assetId) throw new Error('图片资源标识无效')
  const assets = await listAssets(assetsDir)
  const asset = assets.find((item) => item.assetId === assetId)
  if (!asset) throw new Error('原始图片已被清理或不存在')
  return asset
}

async function removeImageAssets(assetsDir, assetIds = null) {
  const allowedIds = assetIds ? new Set(assetIds.map(normalizeAssetId).filter(Boolean)) : null
  const assets = await listAssets(assetsDir)
  await Promise.all(
    assets
      .filter((asset) => !allowedIds || allowedIds.has(asset.assetId))
      .map((asset) => fs.unlink(asset.filePath).catch(() => {}))
  )
}

async function removeOrphanImageAssets(assetsDir, retainedAssetIds) {
  const retained = new Set((retainedAssetIds || []).map(normalizeAssetId).filter(Boolean))
  const assets = await listAssets(assetsDir)
  await Promise.all(
    assets
      .filter((asset) => !retained.has(asset.assetId))
      .map((asset) => fs.unlink(asset.filePath).catch(() => {}))
  )
}

module.exports = {
  MAX_ASSET_TOTAL_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_DATA_URL_CHARS,
  createPreviewDataUrl,
  findImageAsset,
  listAssets,
  normalizeAssetId,
  pruneAssetQuota,
  removeImageAssets,
  removeOrphanImageAssets,
  storeImageAsset
}
