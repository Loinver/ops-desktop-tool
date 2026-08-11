const assert = require('node:assert/strict')
const test = require('node:test')
const Module = require('node:module')

const originalLoad = Module._load
Module._load = function loadWithElectronMock(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => '/tmp/ops-gpt-image-history-security-test' },
      BrowserWindow: { fromWebContents: () => null },
      dialog: {},
      ipcMain: { handle: () => {} },
      nativeImage: {},
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(String(value)),
        decryptString: (value) => Buffer.from(value).toString()
      }
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}
const { __testables } = require('../src/main/ipc/gpt-image')
Module._load = originalLoad

const assetId = '123e4567-e89b-42d3-a456-426614174000'
const previewUrl = `data:image/png;base64,${Buffer.from('preview').toString('base64')}`

test('AI 生图历史仅接受本地资源标识和受限 data URL 预览', () => {
  const history = __testables.sanitizeHistory([
    { id: 'safe', prompt: '安全记录', assetId, imageUrl: previewUrl },
    {
      id: 'remote',
      prompt: '远程记录',
      assetId,
      imageUrl: 'https://169.254.169.254/latest/meta-data'
    },
    { id: 'missing-asset', prompt: '缺少资源', imageUrl: previewUrl }
  ])

  assert.equal(history.length, 1)
  assert.equal(history[0].id, 'safe')
  assert.equal(history[0].assetId, assetId)
})

test('AI 生图历史会限制字符串和预览体积，避免巨大 JSON 再次写入', () => {
  const item = __testables.sanitizeHistoryItem({
    id: 'bounded',
    prompt: 'p'.repeat(10_000),
    fullPrompt: 'f'.repeat(30_000),
    assetId,
    imageUrl: `data:image/png;base64,${'A'.repeat(80_000)}`,
    durationMs: Number.MAX_SAFE_INTEGER
  })

  assert.equal(item.prompt.length, 4_000)
  assert.equal(item.fullPrompt.length, 12_000)
  assert.equal(item.imageUrl, '')
  assert.equal(item.durationMs, 24 * 60 * 60 * 1000)
})

test('AI 生图混合历史会保留新格式记录并逐项迁移旧版 Base64 图片', async () => {
  const migratedAssetId = '223e4567-e89b-42d3-a456-426614174000'
  const legacyImageUrl = `data:image/png;base64,${Buffer.from('legacy-image').toString('base64')}`
  const result = await __testables.normalizeStoredHistory(
    [
      { id: 'current', prompt: '新格式', assetId, imageUrl: previewUrl },
      { id: 'legacy', prompt: '旧格式', imageUrl: legacyImageUrl },
      { id: 'remote', prompt: '远程旧记录', imageUrl: 'https://example.com/image.png' }
    ],
    async (decoded) => {
      assert.deepEqual(decoded.buffer, Buffer.from('legacy-image'))
      return { assetId: migratedAssetId, previewUrl, removedAssetIds: [] }
    }
  )

  assert.equal(result.changed, true)
  assert.deepEqual(
    result.history.map((item) => [item.id, item.assetId]),
    [
      ['current', assetId],
      ['legacy', migratedAssetId]
    ]
  )
})

test('迁移旧历史触发配额淘汰时会同步移除对应历史记录', async () => {
  const migratedAssetId = '323e4567-e89b-42d3-a456-426614174000'
  const legacyImageUrl = `data:image/png;base64,${Buffer.from('legacy-image').toString('base64')}`
  const result = await __testables.normalizeStoredHistory(
    [
      { id: 'current', prompt: '将被淘汰', assetId, imageUrl: previewUrl },
      { id: 'legacy', prompt: '迁移记录', imageUrl: legacyImageUrl }
    ],
    async () => ({ assetId: migratedAssetId, previewUrl, removedAssetIds: [assetId] })
  )

  assert.deepEqual(
    result.history.map((item) => item.id),
    ['legacy']
  )
})

test('AI 生图历史会保存批量、编辑来源和重试元数据并限制边界', () => {
  const item = __testables.sanitizeHistoryItem({
    id: 'batch-item',
    prompt: '编辑图片',
    assetId,
    imageUrl: previewUrl,
    mode: 'edit',
    parentAssetId: assetId,
    batchId: 'batch-1',
    batchIndex: 99,
    batchSize: 99,
    attempts: 99
  })

  assert.equal(item.mode, 'edit')
  assert.equal(item.parentAssetId, assetId)
  assert.equal(item.batchId, 'batch-1')
  assert.equal(item.batchIndex, 3)
  assert.equal(item.batchSize, 4)
  assert.equal(item.attempts, 3)
})
