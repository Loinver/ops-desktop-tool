const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  MAX_PREVIEW_DATA_URL_CHARS,
  findImageAsset,
  normalizeAssetId,
  removeOrphanImageAssets,
  storeImageAsset
} = require('../src/main/utils/gpt-image-assets')

function fakeNativeImage(previewBytes = 64) {
  const resized = {
    toPNG: () => Buffer.alloc(previewBytes, 1),
    toJPEG: () => Buffer.alloc(previewBytes, 2)
  }
  return {
    createFromBuffer: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 1024, height: 768 }),
      resize: () => resized
    })
  }
}

test('AI 生图原图写入独立受限目录，JSON 只需保存小预览与资源标识', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-gpt-assets-'))
  try {
    const stored = await storeImageAsset({
      assetsDir: root,
      buffer: Buffer.from('original-image-bytes'),
      extension: 'png',
      nativeImage: fakeNativeImage()
    })

    assert.match(stored.assetId, /^[0-9a-f-]{36}$/)
    assert.equal(normalizeAssetId(stored.assetId), stored.assetId)
    assert.match(stored.previewUrl, /^data:image\/png;base64,/)
    assert.ok(stored.previewUrl.length < MAX_PREVIEW_DATA_URL_CHARS)

    const asset = await findImageAsset(root, stored.assetId)
    assert.deepEqual(await fs.readFile(asset.filePath), Buffer.from('original-image-bytes'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('AI 生图总容量超限时清理最旧资源，历史清理可删除孤儿文件', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-gpt-assets-quota-'))
  try {
    const first = await storeImageAsset({
      assetsDir: root,
      buffer: Buffer.alloc(6, 1),
      extension: 'png',
      nativeImage: fakeNativeImage(),
      maxTotalBytes: 10
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await storeImageAsset({
      assetsDir: root,
      buffer: Buffer.alloc(6, 2),
      extension: 'png',
      nativeImage: fakeNativeImage(),
      maxTotalBytes: 10
    })

    assert.deepEqual(second.removedAssetIds, [first.assetId])
    await assert.rejects(findImageAsset(root, first.assetId), /已被清理或不存在/)
    assert.ok(await findImageAsset(root, second.assetId))

    await removeOrphanImageAssets(root, [])
    await assert.rejects(findImageAsset(root, second.assetId), /已被清理或不存在/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})


test('并发写入 AI 生图资源时仍串行执行配额检查', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-gpt-assets-concurrent-'))
  try {
    const results = await Promise.all([
      storeImageAsset({
        assetsDir: root,
        buffer: Buffer.alloc(6, 1),
        extension: 'png',
        nativeImage: fakeNativeImage(),
        maxTotalBytes: 10
      }),
      storeImageAsset({
        assetsDir: root,
        buffer: Buffer.alloc(6, 2),
        extension: 'png',
        nativeImage: fakeNativeImage(),
        maxTotalBytes: 10
      })
    ])

    const files = await fs.readdir(root)
    const finalAssets = files.filter((name) => !name.includes('.tmp-'))
    const totalBytes = await Promise.all(
      finalAssets.map(async (name) => (await fs.stat(path.join(root, name))).size)
    )
    assert.ok(totalBytes.reduce((sum, size) => sum + size, 0) <= 10)
    assert.equal(finalAssets.length, 1)
    assert.equal(results.flatMap((result) => result.removedAssetIds).length, 1)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
