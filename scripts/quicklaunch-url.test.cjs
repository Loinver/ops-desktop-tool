const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeExternalUrl } = require('../src/main/utils/external-url')

test('快捷启动网址会自动补全 https 协议', () => {
  assert.equal(normalizeExternalUrl('example.com'), 'https://example.com/')
  assert.equal(normalizeExternalUrl('  www.example.com/docs  '), 'https://www.example.com/docs')
})

test('本机地址和显式端口默认使用 http 协议', () => {
  assert.equal(normalizeExternalUrl('localhost:3000'), 'http://localhost:3000/')
  assert.equal(normalizeExternalUrl('localhost/dashboard'), 'http://localhost/dashboard')
  assert.equal(normalizeExternalUrl('127.0.0.1:5173'), 'http://127.0.0.1:5173/')
  assert.equal(normalizeExternalUrl('192.168.1.20:8080/admin'), 'http://192.168.1.20:8080/admin')
  assert.equal(normalizeExternalUrl('devbox.local:4173'), 'http://devbox.local:4173/')
})

test('快捷启动保留允许的完整外部协议', () => {
  assert.equal(normalizeExternalUrl('http://localhost:3000'), 'http://localhost:3000/')
  assert.equal(normalizeExternalUrl('https://example.com'), 'https://example.com/')
  assert.equal(normalizeExternalUrl('mailto:ops@example.com'), 'mailto:ops@example.com')
})

test('快捷启动拒绝危险协议和无效网址', () => {
  assert.throws(() => normalizeExternalUrl('javascript:alert(1)'), /仅支持/)
  assert.throws(() => normalizeExternalUrl('file:///tmp/demo'), /仅支持/)
  assert.throws(() => normalizeExternalUrl('https://'), /网址格式无效|网址缺少域名/)
  assert.throws(() => normalizeExternalUrl(''), /请输入网址/)
})

test('macOS 使用系统 open 打开网址，避免 Electron shell 无响应', async () => {
  const { openExternalUrl } = require('../src/main/utils/external-url')
  let received
  await openExternalUrl('https://example.com/', {
    platform: 'darwin',
    execFile: (command, args, options, callback) => {
      received = { command, args, options }
      callback(null)
    },
  })

  assert.deepEqual(received, {
    command: '/usr/bin/open',
    args: ['https://example.com/'],
    options: { timeout: 15_000 },
  })
})

test('非 macOS 仍通过 Electron shell 打开网址', async () => {
  const { openExternalUrl } = require('../src/main/utils/external-url')
  let received = ''
  await openExternalUrl('https://example.com/', {
    platform: 'win32',
    shell: {
      openExternal: async (url) => { received = url },
    },
  })
  assert.equal(received, 'https://example.com/')
})
