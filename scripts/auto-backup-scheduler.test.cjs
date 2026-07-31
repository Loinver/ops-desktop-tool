const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const assert = require('node:assert/strict')
const { saveAutoBackupSettings } = require('../src/main/utils/app-data-backup')
const { listOpsEvents, onOpsEventChange } = require('../src/main/utils/ops-automation')

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-auto-backup-scheduler-'))
}

function loadScheduler() {
  const originalLoad = Module._load
  Module._load = function loadWithMockedElectron(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { getVersion: () => 'test' },
        safeStorage: {
          isEncryptionAvailable: () => true,
          decryptString: value => Buffer.from(value).toString('utf8'),
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const schedulerPath = require.resolve('../src/main/ops-auto-backup-scheduler')
  delete require.cache[schedulerPath]
  const scheduler = require(schedulerPath)
  return {
    scheduler,
    restore() {
      scheduler.stopAutoBackupScheduler()
      delete require.cache[schedulerPath]
      Module._load = originalLoad
    },
  }
}

test('自动备份执行失败会通知事件中心，下一次成功会自动恢复事件', () => {
  const userDataPath = createTempDir()
  const outputDirectory = createTempDir()
  const changes = []
  const unsubscribe = onOpsEventChange(change => changes.push(change))
  let loaded
  try {
    fs.writeFileSync(path.join(userDataPath, 'ops-events.json'), JSON.stringify([{ id: 'backup-source' }]))
    saveAutoBackupSettings({
      userDataPath,
      input: {
        enabled: true,
        outputDirectory,
        categories: ['operations'],
        password: 'auto-backup-password',
      },
      encryptPassword: value => `safe-storage:v1:${Buffer.from(value).toString('base64')}`,
    })
    fs.rmSync(outputDirectory, { recursive: true, force: true })

    loaded = loadScheduler()
    loaded.scheduler.initializeAutoBackupScheduler({ userDataPath })
    assert.throws(() => loaded.scheduler.runAutoBackupNow(), /自动备份目录不存在或无法访问/)

    const [failed] = listOpsEvents(userDataPath, { sourceType: 'data-backup' })
    assert.equal(failed.status, 'open')
    assert.equal(failed.severity, 'critical')
    assert.match(failed.description, /本地数据管理/)

    fs.mkdirSync(outputDirectory, { recursive: true })
    const result = loaded.scheduler.runAutoBackupNow()
    assert.equal(result.entry.status, 'success')

    const [recovered] = listOpsEvents(userDataPath, { sourceType: 'data-backup' })
    assert.equal(recovered.status, 'resolved')
    assert.deepEqual(changes.map(change => change.kind), ['opened', 'recovered'])
  } finally {
    loaded?.restore()
    unsubscribe()
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.rmSync(outputDirectory, { recursive: true, force: true })
  }
})
