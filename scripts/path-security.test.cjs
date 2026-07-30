const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeRemotePath, assertLocalPath } = require('../src/main/utils/path-security')

test('远程路径会规范化但保留绝对路径', () => {
  assert.equal(normalizeRemotePath('/www//app/'), '/www/app/')
})

test('远程路径拒绝相对路径和上级目录跳转', () => {
  assert.throws(() => normalizeRemotePath('www/app'), /绝对路径/)
  assert.throws(() => normalizeRemotePath('/www/../etc'), /上级目录/)
})

test('破坏性操作拒绝服务器根目录', () => {
  assert.throws(() => normalizeRemotePath('/', { allowRoot: false }), /服务器根目录/)
})

test('本地路径拒绝空值和空字节', () => {
  assert.throws(() => assertLocalPath(''), /不能为空/)
  assert.throws(() => assertLocalPath('/tmp/a\0b'), /无效/)
})
