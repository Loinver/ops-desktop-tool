const assert = require('node:assert/strict')
const test = require('node:test')

const {
  buildImageFileName,
  decodeDataImageUrl,
  ensureImageExtension,
  extensionForContentType,
} = require('../src/main/utils/gpt-image-file')

test('解析 Base64 data URL 并保留图片类型', () => {
  const image = decodeDataImageUrl('data:image/webp;base64,AQIDBA==')

  assert.equal(image.contentType, 'image/webp')
  assert.equal(image.extension, 'webp')
  assert.deepEqual([...image.buffer], [1, 2, 3, 4])
})

test('拒绝非图片或无效的 data URL', () => {
  assert.throws(
    () => decodeDataImageUrl('data:text/plain;base64,SGVsbG8='),
    /仅支持保存图片数据/,
  )
  assert.throws(
    () => decodeDataImageUrl('data:image/png;base64,not-valid-base64'),
    /图片 Base64 数据无效/,
  )
})

test('保存文件名会去除路径并补齐扩展名', () => {
  assert.equal(buildImageFileName('../unsafe/name', 'png'), 'name.png')
  assert.equal(buildImageFileName('already.webp', 'png'), 'already.webp')
  assert.equal(ensureImageExtension('/tmp/result', 'jpg'), '/tmp/result.jpg')
  assert.equal(ensureImageExtension('/tmp/result.png', 'jpg'), '/tmp/result.png')
  assert.equal(extensionForContentType('image/jpeg; charset=binary'), 'jpg')
})
