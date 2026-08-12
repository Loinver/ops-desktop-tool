const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  IMAGE_EVIDENCE_NOT_FOUND_ERROR,
  IMAGE_EVIDENCE_TTL_MS,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_NORMALIZED_IMAGE_BYTES,
  MAX_PREVIEW_DATA_URL_CHARS,
  MAX_ORIGINAL_IMAGE_BYTES,
  MAX_TOTAL_ORIGINAL_IMAGE_BYTES,
  clear,
  cleanup,
  import: importEvidence,
  list,
  remove,
  resolve
} = require('../src/main/utils/ai-image-evidence')

const workspaces = []

async function createWorkspace() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ops-ai-image-evidence-'))
  workspaces.push(directory)
  return directory
}

function imageFixture(name, width = 800, height = 600) {
  const extension = path.extname(name).slice(1).toLowerCase()
  if (extension === 'png') {
    const buffer = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
    buffer.writeUInt32BE(13, 8)
    buffer.write('IHDR', 12, 'ascii')
    buffer.writeUInt32BE(width, 16)
    buffer.writeUInt32BE(height, 20)
    return buffer
  }
  if (extension === 'jpg' || extension === 'jpeg') {
    const buffer = Buffer.alloc(23)
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]).copy(buffer)
    buffer.writeUInt16BE(height, 7)
    buffer.writeUInt16BE(width, 9)
    buffer[11] = 0x03
    buffer[21] = 0xff
    buffer[22] = 0xd9
    return buffer
  }
  if (extension === 'webp') {
    const buffer = Buffer.alloc(30)
    buffer.write('RIFF', 0, 'ascii')
    buffer.writeUInt32LE(22, 4)
    buffer.write('WEBP', 8, 'ascii')
    buffer.write('VP8X', 12, 'ascii')
    buffer.writeUInt32LE(10, 16)
    const encodedWidth = width - 1
    const encodedHeight = height - 1
    buffer[24] = encodedWidth & 0xff
    buffer[25] = (encodedWidth >> 8) & 0xff
    buffer[26] = (encodedWidth >> 16) & 0xff
    buffer[27] = encodedHeight & 0xff
    buffer[28] = (encodedHeight >> 8) & 0xff
    buffer[29] = (encodedHeight >> 16) & 0xff
    return buffer
  }
  return Buffer.from(`file-${name}`)
}

async function createImageFiles(directory, entries) {
  const paths = []
  for (const [name, size, width, height] of entries) {
    const filePath = path.join(directory, name)
    await fs.writeFile(filePath, imageFixture(name, width, height))
    if (size !== undefined) await fs.truncate(filePath, size)
    paths.push(filePath)
  }
  return paths
}

function fakeNativeImage({ width = 800, height = 600, pngBytes = 128, jpegBytes = 128 } = {}) {
  const calls = []
  const outputBytes = (value, maxDimension, quality) => {
    const resolved = typeof value === 'function' ? value(maxDimension, quality) : value
    return Buffer.alloc(resolved, 0x41)
  }
  const resizedImage = (options) => {
    const maxDimension = Math.max(options.width, options.height)
    calls.push({ type: 'resize', ...options })
    return {
      toPNG: () => outputBytes(pngBytes, maxDimension),
      toJPEG: (quality) => outputBytes(jpegBytes, maxDimension, quality)
    }
  }

  return {
    calls,
    createFromBuffer(buffer) {
      calls.push({ type: 'createFromBuffer', buffer: Buffer.from(buffer) })
      return {
        isEmpty: () => false,
        getSize: () => ({ width, height }),
        resize: resizedImage
      }
    }
  }
}

test.after(async () => {
  await Promise.all(
    workspaces.map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
  cleanup()
})

test.beforeEach(() => {
  cleanup()
})

test('支持 png/jpg/jpeg/webp，并拒绝不支持的扩展名', async () => {
  const directory = await createWorkspace()
  const filePaths = await createImageFiles(directory, [
    ['one.png'],
    ['two.jpg'],
    ['three.jpeg'],
    ['four.webp']
  ])
  const nativeImage = fakeNativeImage()

  const imported = await importEvidence({ sender: { id: 101 }, filePaths, nativeImage, now: 0 })

  assert.equal(imported.length, 4)
  assert.deepEqual(
    imported.map((item) => item.name),
    ['one.png', 'two.jpg', 'three.jpeg', 'four.webp']
  )
  assert.deepEqual(
    imported.map((item) => item.mimeType),
    ['image/png', 'image/png', 'image/png', 'image/png']
  )
  assert.deepEqual(
    nativeImage.calls.filter((call) => call.type === 'createFromBuffer').map((call) => call.buffer),
    await Promise.all(filePaths.map((filePath) => fs.readFile(filePath)))
  )

  const unsupportedPath = await createImageFiles(directory, [['not-supported.gif']])
  await assert.rejects(
    importEvidence({ sender: { id: 102 }, filePaths: unsupportedPath, nativeImage }),
    /仅支持 PNG、JPG、JPEG、WEBP/
  )

  const disguisedPath = path.join(directory, 'disguised.png')
  await fs.writeFile(disguisedPath, imageFixture('actually.jpg'))
  await assert.rejects(
    importEvidence({ sender: { id: 103 }, filePaths: [disguisedPath], nativeImage }),
    /图片文件内容与扩展名不匹配/
  )

  const webpOnly = fakeNativeImage()
  webpOnly.createFromBuffer = (buffer) => {
    webpOnly.calls.push({ type: 'createFromBuffer', buffer: Buffer.from(buffer) })
    return { isEmpty: () => true }
  }
  webpOnly.createFromDataURL = (dataUrl) => {
    webpOnly.calls.push({ type: 'createFromDataURL', dataUrl })
    return {
      isEmpty: () => false,
      getSize: () => ({ width: 800, height: 600 }),
      resize: ({ width, height, ...options }) => {
        webpOnly.calls.push({ type: 'resize', width, height, ...options })
        return { toPNG: () => Buffer.alloc(128), toJPEG: () => Buffer.alloc(128) }
      }
    }
  }
  await importEvidence({
    sender: { id: 104 },
    filePaths: [filePaths[3]],
    nativeImage: webpOnly,
    now: 0
  })
  assert.ok(
    webpOnly.calls
      .find((call) => call.type === 'createFromDataURL')
      .dataUrl.startsWith('data:image/webp;base64,')
  )
})

test('限制单张和总原文件大小', async () => {
  const directory = await createWorkspace()
  const oversized = await createImageFiles(directory, [['large.png', MAX_ORIGINAL_IMAGE_BYTES + 1]])
  await assert.rejects(
    importEvidence({ sender: { id: 201 }, filePaths: oversized, nativeImage: fakeNativeImage() }),
    /单张图片不得超过 12 MiB/
  )

  const totalOversized = await createImageFiles(directory, [
    ['a.png', 11 * 1024 * 1024],
    ['b.png', 11 * 1024 * 1024],
    ['c.png', 11 * 1024 * 1024]
  ])
  await assert.rejects(
    importEvidence({
      sender: { id: 202 },
      filePaths: totalOversized,
      nativeImage: fakeNativeImage()
    }),
    /图片总大小不得超过 32 MiB/
  )
  assert.equal(MAX_TOTAL_ORIGINAL_IMAGE_BYTES, 32 * 1024 * 1024)
})

test('解码验证尺寸，并限制最多四张图片证据', async () => {
  const directory = await createWorkspace()
  const fiveFiles = await createImageFiles(
    directory,
    ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'].map((name) => [name])
  )
  await assert.rejects(
    importEvidence({ sender: { id: 301 }, filePaths: fiveFiles, nativeImage: fakeNativeImage() }),
    new RegExp(`最多选择 ${MAX_IMAGE_COUNT} 张图片`)
  )

  const tooLarge = await createImageFiles(directory, [['too-large.png']])
  await assert.rejects(
    importEvidence({
      sender: { id: 302 },
      filePaths: tooLarge,
      nativeImage: fakeNativeImage({ width: MAX_IMAGE_DIMENSION + 1, height: 1 })
    }),
    /图片尺寸无效或像素总量过大/
  )

  const emptyImage = await createImageFiles(directory, [['empty-image.png']])
  await assert.rejects(
    importEvidence({
      sender: { id: 303 },
      filePaths: emptyImage,
      nativeImage: {
        createFromBuffer: () => ({
          isEmpty: () => true,
          getSize: () => ({ width: 1, height: 1 })
        })
      }
    }),
    /图片解码失败/
  )

  const pixelBomb = await createImageFiles(directory, [
    ['pixel-bomb.png', undefined, 10_000, Math.floor(MAX_IMAGE_PIXELS / 10_000) + 1]
  ])
  const pixelBombNativeImage = fakeNativeImage()
  await assert.rejects(
    importEvidence({
      sender: { id: 304 },
      filePaths: pixelBomb,
      nativeImage: pixelBombNativeImage
    }),
    /图片尺寸无效或像素总量过大/
  )
  assert.equal(
    pixelBombNativeImage.calls.some((call) => call.type === 'createFromBuffer'),
    false
  )
})

test('并发导入仍不会绕过同一 Renderer 最多四张的限制', async () => {
  const directory = await createWorkspace()
  const first = await createImageFiles(directory, [['a.png'], ['b.png'], ['c.png']])
  const second = await createImageFiles(directory, [['d.png'], ['e.png'], ['f.png']])
  const sender = { id: 350 }
  const results = await Promise.allSettled([
    importEvidence({ sender, filePaths: first, nativeImage: fakeNativeImage() }),
    importEvidence({ sender, filePaths: second, nativeImage: fakeNativeImage() })
  ])

  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1)
  assert.match(
    results.find((item) => item.status === 'rejected').reason.message,
    /最多选择 4 张图片/
  )
  assert.equal(list(sender).length, 3)
})

test('优先 PNG，否则多档 JPEG/缩放，并限制规范化尺寸和大小', async () => {
  const directory = await createWorkspace()
  const [pngPath, jpegPath] = await createImageFiles(directory, [['small.png'], ['fallback.jpg']])

  const pngImport = await importEvidence({
    sender: { id: 401 },
    filePaths: [pngPath],
    nativeImage: fakeNativeImage({ width: 3000, height: 1500, pngBytes: 20, jpegBytes: 30 }),
    now: 0
  })
  assert.equal(pngImport[0].mimeType, 'image/png')
  assert.equal(pngImport[0].width, 1600)
  assert.equal(pngImport[0].height, 800)
  assert.ok(pngImport[0].sizeBytes <= MAX_NORMALIZED_IMAGE_BYTES)

  const fallbackImport = await importEvidence({
    sender: { id: 402 },
    filePaths: [jpegPath],
    nativeImage: fakeNativeImage({
      width: 4000,
      height: 2000,
      pngBytes: 2 * 1024 * 1024,
      jpegBytes: (maxDimension, quality) =>
        maxDimension === 1600 && quality > 76 ? 2 * 1024 * 1024 : 90
    }),
    now: 0
  })
  assert.equal(fallbackImport[0].mimeType, 'image/jpeg')
  assert.equal(fallbackImport[0].width, 1600)
  assert.equal(fallbackImport[0].height, 800)
  assert.ok(fallbackImport[0].sizeBytes <= MAX_NORMALIZED_IMAGE_BYTES)
})

test('导入和列表只返回安全元数据，预览受限且不泄露原文件内容', async () => {
  const directory = await createWorkspace()
  const originalSecret = 'ORIGINAL-LOCAL-IMAGE-SECRET'
  const filePath = path.join(directory, 'secret.png')
  await fs.writeFile(
    filePath,
    Buffer.concat([imageFixture('secret.png'), Buffer.from(originalSecret)])
  )
  const imported = await importEvidence({
    sender: { id: 501 },
    filePaths: [filePath],
    nativeImage: fakeNativeImage({
      width: 1200,
      height: 800,
      pngBytes: (maxDimension) => (maxDimension > 384 ? 100_000 : 64),
      jpegBytes: 64
    }),
    now: 0
  })
  const metadata = imported[0]

  assert.ok(metadata.previewDataUrl.startsWith('data:image/'))
  assert.ok(metadata.previewDataUrl.length <= MAX_PREVIEW_DATA_URL_CHARS)
  assert.equal('data' in metadata, false)
  assert.equal(JSON.stringify(metadata).includes(filePath), false)
  assert.equal(metadata.previewDataUrl.includes(originalSecret), false)

  const providerImage = resolve({ sender: { id: 501 }, id: metadata.id, now: 1 })
  assert.deepEqual(Object.keys(providerImage).sort(), [
    'data',
    'height',
    'id',
    'mimeType',
    'name',
    'sizeBytes',
    'width'
  ])
  assert.equal(Buffer.from(providerImage.data, 'base64').length, providerImage.sizeBytes)
  assert.equal(providerImage.data.includes(Buffer.from(originalSecret).toString('base64')), false)
})

test('按 sender.id 隔离，越权、缺失和过期统一返回相同错误', async () => {
  const directory = await createWorkspace()
  const [filePath] = await createImageFiles(directory, [['isolated.png']])
  const [metadata] = await importEvidence({
    sender: { id: 601 },
    filePaths: [filePath],
    nativeImage: fakeNativeImage(),
    now: 10
  })

  assert.equal(list({ sender: { id: 602 }, now: 10 }).length, 0)
  assert.throws(
    () => resolve({ sender: { id: 602 }, id: metadata.id, now: 10 }),
    new RegExp(IMAGE_EVIDENCE_NOT_FOUND_ERROR)
  )
  assert.throws(
    () => resolve({ sender: { id: 601 }, id: 'not-a-uuid', now: 10 }),
    new RegExp(IMAGE_EVIDENCE_NOT_FOUND_ERROR)
  )
  assert.throws(
    () => resolve({ sender: { id: 601 }, id: metadata.id, now: 10 + IMAGE_EVIDENCE_TTL_MS }),
    new RegExp(IMAGE_EVIDENCE_NOT_FOUND_ERROR)
  )
})

test('支持 TTL 清理、单项删除和按 sender 清空', async () => {
  const directory = await createWorkspace()
  const files = await createImageFiles(directory, [['one.png'], ['two.png'], ['three.png']])
  const sender = { id: 701 }
  const imported = await importEvidence({
    sender,
    filePaths: files,
    nativeImage: fakeNativeImage(),
    now: 100
  })

  assert.equal(list({ sender, now: 100 }).length, 3)
  assert.equal(remove({ sender, id: imported[0].id, now: 101 }), true)
  assert.equal(list({ sender, now: 101 }).length, 2)
  assert.equal(clear({ sender, now: 102 }), 2)
  assert.equal(list({ sender, now: 102 }).length, 0)
  assert.equal(clear({ sender, now: 102 }), 0)

  const [expired] = await importEvidence({
    sender: { id: 702 },
    filePaths: [files[0]],
    nativeImage: fakeNativeImage(),
    now: 200
  })
  assert.equal(cleanup(200 + IMAGE_EVIDENCE_TTL_MS - 1), 0)
  assert.equal(cleanup(200 + IMAGE_EVIDENCE_TTL_MS), 1)
  assert.throws(
    () => resolve({ sender: { id: 702 }, id: expired.id, now: 200 + IMAGE_EVIDENCE_TTL_MS }),
    new RegExp(IMAGE_EVIDENCE_NOT_FOUND_ERROR)
  )
})
