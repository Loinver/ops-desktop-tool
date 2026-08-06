const assert = require('node:assert/strict')
const test = require('node:test')

const { __testables } = require('../src/main/utils/release-store')
const fs = require('node:fs')
const path = require('node:path')

test('发布历史按发布环境筛选，未指定环境时保留全量历史', () => {
  const history = [
    { id: 'prod-rollback', profileId: 'prod', action: 'rollback' },
    { id: 'staging-deploy', profileId: 'staging', action: 'deploy' },
    { id: 'prod-deploy', profileId: 'prod', action: 'deploy' },
    { id: 'legacy', profileId: '', action: 'deploy' }
  ]

  assert.deepEqual(
    __testables.filterReleaseHistoryByProfile(history, 'prod').map((item) => item.id),
    ['prod-rollback', 'prod-deploy']
  )
  assert.deepEqual(
    __testables.filterReleaseHistoryByProfile(history, 'staging').map((item) => item.id),
    ['staging-deploy']
  )
  assert.deepEqual(__testables.filterReleaseHistoryByProfile(history, ''), history)
})

test('发布环境安全摘要不会在启动时解密钥匙串密码', () => {
  const profile = {
    id: 'production',
    name: '生产环境',
    host: 'deploy.example.com',
    passwordEncrypted: 'safe-storage:v1:encrypted-payload'
  }

  assert.deepEqual(__testables.safeProfile(profile), {
    id: 'production',
    name: '生产环境',
    host: 'deploy.example.com',
    hasPassword: true,
    passwordMasked: '••••••••'
  })
  assert.deepEqual(__testables.safeProfile({ id: 'empty' }), {
    id: 'empty',
    hasPassword: false,
    passwordMasked: ''
  })

  const source = fs.readFileSync(path.join(__dirname, '../src/main/utils/release-store.js'), 'utf8')
  const safeProfileSource = source.match(/function safeProfile\([\s\S]*?\n}/)?.[0] || ''
  assert.doesNotMatch(safeProfileSource, /readProfilePassword\(/)
})
