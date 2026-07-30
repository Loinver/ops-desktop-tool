const assert = require('node:assert/strict')
const test = require('node:test')

const { __testables } = require('../src/main/utils/release-store')

test('发布历史按发布环境筛选，未指定环境时保留全量历史', () => {
  const history = [
    { id: 'prod-rollback', profileId: 'prod', action: 'rollback' },
    { id: 'staging-deploy', profileId: 'staging', action: 'deploy' },
    { id: 'prod-deploy', profileId: 'prod', action: 'deploy' },
    { id: 'legacy', profileId: '', action: 'deploy' },
  ]

  assert.deepEqual(
    __testables.filterReleaseHistoryByProfile(history, 'prod').map((item) => item.id),
    ['prod-rollback', 'prod-deploy'],
  )
  assert.deepEqual(
    __testables.filterReleaseHistoryByProfile(history, 'staging').map((item) => item.id),
    ['staging-deploy'],
  )
  assert.deepEqual(__testables.filterReleaseHistoryByProfile(history, ''), history)
})
