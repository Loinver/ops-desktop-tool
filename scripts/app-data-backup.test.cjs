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

test('自动备份计划只暴露安全状态，并校验启用配置', () => {
  const root = tempDir()
  const outputDirectory = tempDir()
  const {
    readAutoBackupSettings,
    safeAutoBackupSettings,
    saveAutoBackupSettings,
  } = require('../src/main/utils/app-data-backup')

  assert.throws(() => saveAutoBackupSettings({
    userDataPath: root,
    input: { enabled: true, outputDirectory, categories: ['operations'] },
    encryptPassword: value => `enc:${value}`,
  }), /设置备份密码/)

  const settings = saveAutoBackupSettings({
    userDataPath: root,
    input: {
      enabled: true,
      outputDirectory,
      interval: 'daily',
      retentionCount: 99,
      categories: ['operations'],
      password: 'automatic-password',
    },
    encryptPassword: value => `enc:${value}`,
    now: 1_000,
  })

  assert.deepEqual(settings, {
    enabled: true,
    outputDirectory,
    interval: 'daily',
    retentionCount: 30,
    categories: ['operations'],
    hasPassword: true,
    lastRunAt: 0,
    nextRunAt: 1_000 + 24 * 60 * 60 * 1_000,
  })
  assert.equal('passwordEncrypted' in settings, false)
  assert.match(readAutoBackupSettings(root).passwordEncrypted, /^enc:/)
  assert.deepEqual(safeAutoBackupSettings(readAutoBackupSettings(root)), settings)
})

test('自动备份按保留策略清理旧文件并记录执行历史', () => {
  const root = tempDir()
  const outputDirectory = tempDir()
  const {
    readAutoBackupHistory,
    readAutoBackupSettings,
    runAutoBackup,
    saveAutoBackupSettings,
  } = require('../src/main/utils/app-data-backup')
  writeJson(root, 'ops-events.json', [{ id: 'auto-backup' }])
  saveAutoBackupSettings({
    userDataPath: root,
    input: {
      enabled: true,
      outputDirectory,
      interval: 'weekly',
      retentionCount: 1,
      categories: ['operations'],
      password: 'automatic-password',
    },
    encryptPassword: value => `enc:${value}`,
    now: 1_000,
  })

  const first = runAutoBackup({
    userDataPath: root,
    decryptPassword: value => value.slice(4),
    now: 2_000,
    iterations: 1_000,
  })
  const second = runAutoBackup({
    userDataPath: root,
    decryptPassword: value => value.slice(4),
    now: 3_000,
    iterations: 1_000,
  })

  assert.equal(fs.existsSync(path.join(outputDirectory, first.entry.fileName)), false)
  assert.equal(fs.existsSync(path.join(outputDirectory, second.entry.fileName)), true)
  const history = readAutoBackupHistory(root)
  assert.equal(history.length, 1)
  assert.equal(history[0].fileName, second.entry.fileName)
  assert.equal(history[0].status, 'success')
  const settings = readAutoBackupSettings(root)
  assert.equal(settings.lastRunAt, 3_000)
  assert.equal(settings.nextRunAt, 3_000 + 7 * 24 * 60 * 60 * 1_000)
})

test('恢复点可回滚当前数据，并在回滚前创建新的恢复点', () => {
  const source = tempDir()
  const target = tempDir()
  const {
    createBackupArchive: createArchive,
    listRestorePoints,
    restoreBackupArchive: restoreArchive,
    restoreRestorePoint,
  } = require('../src/main/utils/app-data-backup')
  writeJson(source, 'ops-events.json', [{ id: 'from-archive' }])
  writeJson(target, 'ops-events.json', [{ id: 'before-import' }])
  const archive = createArchive({
    userDataPath: source,
    password: 'restore-point-password',
    categories: ['operations'],
    iterations: 1_000,
  })
  restoreArchive({ userDataPath: target, archive, password: 'restore-point-password', now: 4_000 })
  const originalPoint = listRestorePoints(target)[0]
  assert.ok(originalPoint)

  writeJson(target, 'ops-events.json', [{ id: 'current-before-rollback' }])
  const result = restoreRestorePoint({ userDataPath: target, id: originalPoint.id, now: 5_000 })

  assert.equal(result.restartRequired, true)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'ops-events.json'), 'utf8')), [{ id: 'before-import' }])
  const points = listRestorePoints(target)
  assert.equal(points.length, 2)
  const reversiblePoint = points.find(point => point.id !== originalPoint.id)
  assert.ok(reversiblePoint)
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(target, 'ops-backup-restore-points', reversiblePoint.id, 'ops-events.json'), 'utf8')),
    [{ id: 'current-before-rollback' }],
  )
})

test('自动备份历史可安全校验、使用原密码恢复并删除对应文件', () => {
  const root = tempDir()
  const outputDirectory = tempDir()
  const {
    deleteAutoBackup,
    getAutoBackupHistory,
    inspectAutoBackup,
    readAutoBackupHistory,
    restoreAutoBackup,
    runAutoBackup,
    saveAutoBackupSettings,
  } = require('../src/main/utils/app-data-backup')
  writeJson(root, 'ops-events.json', [{ id: 'auto-backup-source' }])
  saveAutoBackupSettings({
    userDataPath: root,
    input: {
      enabled: true,
      outputDirectory,
      categories: ['operations'],
      password: 'original-auto-password',
    },
    encryptPassword: value => `enc:${value}`,
    now: 1_000,
  })
  const run = runAutoBackup({
    userDataPath: root,
    decryptPassword: value => value.slice(4),
    now: 2_000,
    iterations: 1_000,
  })
  const entry = run.entry
  assert.match(readAutoBackupHistory(root)[0].passwordEncrypted, /^enc:/)

  const history = getAutoBackupHistory(root)
  assert.equal(history[0].availability, 'available')
  assert.equal('passwordEncrypted' in history[0], false)
  const inspection = inspectAutoBackup({
    userDataPath: root,
    id: entry.id,
    decryptPassword: value => value.slice(4),
  })
  assert.equal(inspection.summary.fileCount, 1)

  saveAutoBackupSettings({
    userDataPath: root,
    input: { password: 'new-auto-password' },
    encryptPassword: value => `enc:${value}`,
    now: 3_000,
  })
  writeJson(root, 'ops-events.json', [{ id: 'changed-after-backup' }])
  restoreAutoBackup({
    userDataPath: root,
    id: entry.id,
    decryptPassword: value => value.slice(4),
    now: 4_000,
  })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'ops-events.json'), 'utf8')), [{ id: 'auto-backup-source' }])

  const result = deleteAutoBackup({ userDataPath: root, id: entry.id })
  assert.equal(result.deleted, true)
  assert.equal(fs.existsSync(path.join(outputDirectory, entry.fileName)), false)
  assert.deepEqual(getAutoBackupHistory(root), [])
})

test('自动备份缺失文件会标记状态，并可清理历史记录', () => {
  const root = tempDir()
  const outputDirectory = tempDir()
  const {
    deleteAutoBackup,
    getAutoBackupHistory,
    runAutoBackup,
    saveAutoBackupSettings,
  } = require('../src/main/utils/app-data-backup')
  writeJson(root, 'ops-events.json', [{ id: 'auto-backup-source' }])
  saveAutoBackupSettings({
    userDataPath: root,
    input: { enabled: true, outputDirectory, categories: ['operations'], password: 'automatic-password' },
    encryptPassword: value => `enc:${value}`,
    now: 1_000,
  })
  const { entry } = runAutoBackup({ userDataPath: root, decryptPassword: value => value.slice(4), now: 2_000, iterations: 1_000 })
  fs.unlinkSync(path.join(outputDirectory, entry.fileName))
  assert.equal(getAutoBackupHistory(root)[0].availability, 'missing')
  assert.deepEqual(deleteAutoBackup({ userDataPath: root, id: entry.id }), { deleted: false, missing: true })
  assert.deepEqual(getAutoBackupHistory(root), [])
})

test('自动备份健康检查会报告首次备份、缺失文件和不可用目录', () => {
  const root = tempDir()
  const outputDirectory = tempDir()
  const {
    getAutoBackupHealth,
    runAutoBackup,
    saveAutoBackupSettings,
  } = require('../src/main/utils/app-data-backup')
  assert.equal(getAutoBackupHealth(root, { now: 100 }).status, 'disabled')

  writeJson(root, 'ops-events.json', [{ id: 'health-check' }])
  saveAutoBackupSettings({
    userDataPath: root,
    input: { enabled: true, outputDirectory, categories: ['operations'], password: 'automatic-password' },
    encryptPassword: value => `enc:${value}`,
    now: 1_000,
  })
  const beforeFirstRun = getAutoBackupHealth(root, { now: 1_500 })
  assert.equal(beforeFirstRun.status, 'warning')
  assert.ok(beforeFirstRun.issues.some(issue => issue.id === 'first-backup'))

  const { entry } = runAutoBackup({ userDataPath: root, decryptPassword: value => value.slice(4), now: 2_000, iterations: 1_000 })
  fs.unlinkSync(path.join(outputDirectory, entry.fileName))
  const missing = getAutoBackupHealth(root, { now: 2_500 })
  assert.equal(missing.status, 'warning')
  assert.equal(missing.missingCount, 1)
  assert.ok(missing.issues.some(issue => issue.id === 'missing-files'))

  const movedDirectory = `${outputDirectory}-unavailable`
  fs.renameSync(outputDirectory, movedDirectory)
  const unavailable = getAutoBackupHealth(root, { now: 3_000 })
  assert.equal(unavailable.status, 'error')
  assert.ok(unavailable.issues.some(issue => issue.id === 'directory'))
})
