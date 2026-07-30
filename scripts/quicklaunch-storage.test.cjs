const test = require('node:test')
const assert = require('node:assert/strict')
const {
  QUICK_LAUNCH_STORAGE_SCHEMA,
  QUICK_LAUNCH_STORAGE_VERSION,
  readQuickLaunchState,
  makeQuickLaunchState,
} = require('../src/main/utils/quicklaunch-storage')

test('兼容旧版快捷启动数组配置', () => {
  const items = [{ id: 'legacy', type: 'url', target: 'https://example.com' }]
  assert.deepEqual(readQuickLaunchState(items), { items })
})

test('快捷启动存储只保存用户配置的项目列表', () => {
  const items = [{ id: 'site-1', quickOpen: true }]
  const state = makeQuickLaunchState(items)

  assert.equal(state.schema, QUICK_LAUNCH_STORAGE_SCHEMA)
  assert.equal(state.version, QUICK_LAUNCH_STORAGE_VERSION)
  assert.deepEqual(readQuickLaunchState(state), { items })
  assert.equal(Object.hasOwn(state, 'defaultSitesVersion'), false)
})

test('无效快捷启动存储回退为空配置', () => {
  assert.deepEqual(readQuickLaunchState(null), { items: [] })
  assert.deepEqual(readQuickLaunchState({ items: 'invalid' }), { items: [] })
})
