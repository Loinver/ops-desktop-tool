const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const siteFile = path.join(
  __dirname,
  '../src/renderer/views/quick-launch/components/site.json'
)
const quickLaunchStore = path.join(__dirname, '../src/renderer/stores/quickLaunch.js')

test('快捷启动不再内置个人默认站点，内容完全由用户配置提供', () => {
  assert.equal(fs.existsSync(siteFile), false)
  const source = fs.readFileSync(quickLaunchStore, 'utf8')
  assert.doesNotMatch(source, /components\/site\.json/)
  assert.doesNotMatch(source, /createDefaultItems|mergeDefaultItems|restoreDefaultWebsiteItems/)
})
