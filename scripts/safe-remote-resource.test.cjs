const assert = require('node:assert/strict')
const test = require('node:test')

const {
  assertPublicRemoteUrl,
  createPinnedLookup,
  fetchPublicResource,
  isBlockedIpAddress
} = require('../src/main/utils/safe-remote-resource')

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

test('远程图片地址拒绝本机、内网、链路本地与保留地址', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.8',
    '169.254.169.254',
    '192.168.1.2',
    '::1',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    '::127.0.0.1',
    '::ffff:127.0.0.1',
    '64:ff9b::c0a8:101'
  ]) {
    assert.equal(isBlockedIpAddress(address), true, address)
    const host = address.includes(':') ? `[${address}]` : address
    await assert.rejects(assertPublicRemoteUrl(`http://${host}/image.png`), /不能访问/)
  }
})

test('远程图片地址拒绝解析到私网的域名', async () => {
  await assert.rejects(
    assertPublicRemoteUrl('https://cdn.example.test/image.png', {
      lookup: async () => [{ address: '10.10.0.2', family: 4 }]
    }),
    /不能访问本机或内网/
  )
})

test('远程图片下载会逐跳校验重定向并阻止跳转到内网', async () => {
  let calls = 0
  await assert.rejects(
    fetchPublicResource('https://cdn.example.test/image.png', {
      maxBytes: 1024,
      lookup: publicLookup,
      fetchImpl: async () => {
        calls += 1
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/admin' }
        })
      }
    }),
    /不能访问本机或内网/
  )
  assert.equal(calls, 1)
})

test('远程图片下载限制响应体大小并返回受控字节', async () => {
  const allowed = await fetchPublicResource('https://cdn.example.test/image.png', {
    maxBytes: 8,
    lookup: publicLookup,
    fetchImpl: async () =>
      new Response(Buffer.from([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '4' }
      })
  })
  assert.deepEqual([...allowed.buffer], [1, 2, 3, 4])

  await assert.rejects(
    fetchPublicResource('https://cdn.example.test/large.png', {
      maxBytes: 3,
      lookup: publicLookup,
      fetchImpl: async () =>
        new Response(Buffer.from([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'image/png' }
        })
    }),
    /超过 50 MB/
  )
})

test('远程图片连接固定使用预检通过的 DNS 地址，避免二次解析被重绑定', async () => {
  const pinnedLookup = createPinnedLookup([
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
  ])

  const ipv4 = await new Promise((resolve, reject) => {
    pinnedLookup('cdn.example.test', { family: 4 }, (error, address, family) => {
      if (error) reject(error)
      else resolve({ address, family })
    })
  })
  assert.deepEqual(ipv4, { address: '93.184.216.34', family: 4 })

  const all = await new Promise((resolve, reject) => {
    pinnedLookup('cdn.example.test', { all: true }, (error, addresses) => {
      if (error) reject(error)
      else resolve(addresses)
    })
  })
  assert.deepEqual(all, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
  ])
})
