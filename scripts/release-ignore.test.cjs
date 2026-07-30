const test = require('node:test')
const assert = require('node:assert/strict')
const { createReleaseIgnoreMatcher, normalizeRuleLines } = require('../src/main/utils/release-ignore')

test('发布忽略规则支持目录、通配符和反向规则', () => {
  const ignored = createReleaseIgnoreMatcher(['node_modules/', '*.log', 'dist/**', '!dist/keep.log'])
  assert.equal(ignored('node_modules', true), true)
  assert.equal(ignored('node_modules/a.js'), true)
  assert.equal(ignored('logs/error.log'), true)
  assert.equal(ignored('dist/assets/a.js'), true)
  assert.equal(ignored('dist/keep.log'), false)
  assert.equal(ignored('src/main.js'), false)
})

test('发布忽略规则去除空行和注释并限制数量', () => {
  assert.deepEqual(normalizeRuleLines('\n# comment\n*.map\n dist/ \n'), ['*.map', 'dist/'])
  assert.equal(normalizeRuleLines(Array.from({ length: 120 }, (_, index) => `${index}`)).length, 100)
})
