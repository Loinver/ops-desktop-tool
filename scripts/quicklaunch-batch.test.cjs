const test = require('node:test')
const assert = require('node:assert/strict')
const {
  QUICK_LAUNCH_SCHEMA,
  parseWebsiteBatch,
  makeWebsiteExport,
} = require('../src/main/utils/quicklaunch-websites')

test('批量网址 JSON 支持数组并自动补全协议', () => {
  const result = parseWebsiteBatch(JSON.stringify([
    { name: '示例', target: 'example.com' },
    { target: 'https://docs.example.com/path', color: '#22c55e', quickOpen: true },
  ]))

  assert.equal(result.items.length, 2)
  assert.equal(result.skipped, 0)
  assert.deepEqual(
    result.items.map(item => [item.name, item.type, item.target, item.color, item.quickOpen]),
    [
      ['示例', 'url', 'https://example.com/', '#6366f1', false],
      ['docs.example.com', 'url', 'https://docs.example.com/path', '#22c55e', true],
    ]
  )
})

test('批量网址 JSON 跳过无效和重复项目', () => {
  const result = parseWebsiteBatch(JSON.stringify({ items: [
    { target: 'example.com' },
    { target: 'https://example.com/' },
    { target: 'javascript:alert(1)' },
  ] }))

  assert.equal(result.items.length, 1)
  assert.equal(result.skipped, 2)
})

test('批量网址导出只包含规范化后的网址项', () => {
  const payload = makeWebsiteExport([
    { id: '1', name: '网站', type: 'url', target: 'example.com' },
    { id: '2', name: '本地应用', type: 'app', target: '/Applications/Test.app' },
  ])

  assert.equal(payload.schema, QUICK_LAUNCH_SCHEMA)
  assert.equal(payload.version, 1)
  assert.deepEqual(payload.items, [{
    name: '网站',
    type: 'url',
    target: 'https://example.com/',
    icon: '',
    color: '#6366f1',
    quickOpen: false,
  }])
})
