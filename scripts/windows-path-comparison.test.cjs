const assert = require('node:assert/strict')
const test = require('node:test')
const { __testables } = require('../src/main/utils/app-data-backup')

test('Windows 备份目录比较忽略盘符和目录名大小写', () => {
  assert.equal(
    __testables.pathsEqual('D:\\Backups\\Ops', 'd:\\backups\\ops\\', {
      platform: 'win32'
    }),
    true
  )
})

test('POSIX 备份目录比较保持大小写敏感', () => {
  assert.equal(
    __testables.pathsEqual('/var/backups/Ops', '/var/backups/ops', {
      platform: 'linux'
    }),
    false
  )
})
