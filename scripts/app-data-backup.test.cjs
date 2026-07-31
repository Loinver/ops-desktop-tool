const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  createBackupArchive,
  getBackupOverview,
  inspectBackupArchive,
  parseBackupArchive,
  restoreBackupArchive,
} = require('../src/main/utils/app-data-backup')

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-data-backup-'))
}

function writeJson(root, fileName, value) {
  fs.writeFileSync(path.join(root, fileName), JSON.stringify(value, null, 2))
}

test('备份概览按分类统计已有且有效的本地数据', () => {
  const root = tempDir()
  writeJson(root, 'ops-events.json', [{ id: 'evt-1' }])
  writeJson(root, 'release-history.json', [{ id: 'release-1' }])
  fs.writeFileSync(path.join(root, 'quick-launch.json'), '{broken')

  const overview = getBackupOverview(root)
  const operations = overview.groups.find(group => group.id === 'operations')
  const release = overview.groups.find(group => group.id === 'release')
  const desktop = overview.groups.find(group => group.id === 'desktop')

  assert.equal(operations.fileCount, 1)
  assert.equal(release.fileCount, 1)
  assert.deepEqual(desktop.invalidFiles, ['quick-launch.json'])
})

test('加密备份仅包含选中分类，错误密码无法读取', () => {
  const root = tempDir()
  writeJson(root, 'ops-events.json', [{ id: 'evt-1' }])
  writeJson(root, 'release-history.json', [{ id: 'release-1' }])

  const archive = createBackupArchive({
    userDataPath: root,
    password: 'correct-password',
    categories: ['operations'],
    appVersion: '1.2.3',
    now: 123456,
    iterations: 1_000,
  })
  const summary = inspectBackupArchive(archive, 'correct-password')
  const payload = parseBackupArchive(archive, 'correct-password')

  assert.equal(summary.appVersion, '1.2.3')
  assert.equal(summary.fileCount, 1)
  assert.deepEqual(summary.groups.map(group => group.id), ['operations'])
  assert.deepEqual(payload.entries.map(entry => entry.fileName), ['ops-events.json'])
  assert.throws(() => inspectBackupArchive(archive, 'wrong-password'), /密码错误|文件已损坏/)
})

test('篡改后的备份无法通过 AES-GCM 完整性校验', () => {
  const root = tempDir()
  writeJson(root, 'ops-events.json', [{ id: 'evt-1' }])
  const archive = createBackupArchive({ userDataPath: root, password: 'backup-pass', categories: ['operations'], iterations: 1_000 })
  const envelope = JSON.parse(archive.toString('utf8'))
  const payload = Buffer.from(envelope.payload, 'base64')
  payload[0] ^= 1
  envelope.payload = payload.toString('base64')

  assert.throws(() => inspectBackupArchive(Buffer.from(JSON.stringify(envelope)), 'backup-pass'), /密码错误|文件已损坏/)
})

test('恢复会替换备份内文件、保留其他数据并创建恢复点', () => {
  const source = tempDir()
  const target = tempDir()
  writeJson(source, 'ops-events.json', [{ id: 'from-backup' }])
  writeJson(source, 'release-history.json', [{ id: 'release-backup' }])
  writeJson(target, 'ops-events.json', [{ id: 'before-restore' }])
  writeJson(target, 'quick-launch.json', [{ id: 'keep-me' }])

  const archive = createBackupArchive({
    userDataPath: source,
    password: 'restore-password',
    categories: ['operations', 'release'],
    iterations: 1_000,
    now: 100,
  })
  const result = restoreBackupArchive({ userDataPath: target, archive, password: 'restore-password', now: 200 })

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'ops-events.json'), 'utf8')), [{ id: 'from-backup' }])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'release-history.json'), 'utf8')), [{ id: 'release-backup' }])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'quick-launch.json'), 'utf8')), [{ id: 'keep-me' }])
  assert.equal(result.restartRequired, true)

  const restoreRoot = path.join(target, 'ops-backup-restore-points')
  const point = fs.readdirSync(restoreRoot)[0]
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restoreRoot, point, 'ops-events.json'), 'utf8')), [{ id: 'before-restore' }])
})
