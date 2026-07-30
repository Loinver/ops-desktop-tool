const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { __testables } = require('../src/main/ipc/sftp')

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function createZip(zipPath, sourcePath) {
  execFileSync('python3', ['-c', `
import os, sys, zipfile
zip_path, source_path = sys.argv[1:]
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as archive:
    for root, _, files in os.walk(source_path):
        for filename in files:
            file_path = os.path.join(root, filename)
            archive.write(file_path, os.path.relpath(file_path, source_path))
`, zipPath, sourcePath])
}

test('部署一个包时只替换同名包，不清空 remoteDir', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-sftp-deploy-'))
  try {
    const remoteDir = path.join(tempRoot, 'remote', 'target-app')
    const sourceDir = path.join(tempRoot, 'source')
    const remoteStage = path.join(tempRoot, 'stage')
    const remoteBackup = path.join(tempRoot, 'remote', '.target-app.ops-backup-test')
    const remoteZipPath = path.join(tempRoot, 'package-update.zip')

    // 模拟远端应用目录：只允许 module-a 被更新，module-b 与配置必须保留。
    writeFile(path.join(remoteDir, 'module-a', 'old.txt'), 'old module-a')
    writeFile(path.join(remoteDir, 'module-b', 'keep.txt'), 'must stay')
    writeFile(path.join(remoteDir, 'app.config.json'), '{"keep":true}')
    writeFile(path.join(sourceDir, 'module-a', 'new.txt'), 'new module-a')
    createZip(remoteZipPath, sourceDir)

    const archiveRoots = __testables.getArchiveRootNames([{ archivePath: 'module-a' }])
    const command = __testables.buildRemoteDeployCommand({
      normalizedRemoteDir: remoteDir,
      remoteStage,
      remoteBackup,
      remoteZipPath,
      archiveRoots,
    })
    execFileSync('/bin/sh', ['-c', command], { stdio: 'pipe' })

    assert.equal(fs.readFileSync(path.join(remoteDir, 'module-a', 'new.txt'), 'utf8'), 'new module-a')
    assert.equal(fs.existsSync(path.join(remoteDir, 'module-a', 'old.txt')), false)
    assert.equal(fs.readFileSync(path.join(remoteDir, 'module-b', 'keep.txt'), 'utf8'), 'must stay')
    assert.equal(fs.readFileSync(path.join(remoteDir, 'app.config.json'), 'utf8'), '{"keep":true}')
    assert.equal(fs.readFileSync(path.join(remoteBackup, 'module-a', 'old.txt'), 'utf8'), 'old module-a')

    const rollbackBackup = path.join(tempRoot, 'remote', '.rollback-current')
    const rollbackCommand = __testables.buildRemoteRollbackCommand({
      remoteDir,
      backupPath: remoteBackup,
      rollbackBackup,
      archiveRoots,
    })
    execFileSync('/bin/sh', ['-c', rollbackCommand], { stdio: 'pipe' })
    assert.equal(fs.readFileSync(path.join(remoteDir, 'module-a', 'old.txt'), 'utf8'), 'old module-a')
    assert.equal(fs.readFileSync(path.join(rollbackBackup, 'module-a', 'new.txt'), 'utf8'), 'new module-a')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})


test('ZIP 部署串行队列会让 B 在 A 完成后执行，且失败不阻塞后续任务', async () => {
  const enqueue = __testables.createSerialQueue()
  const calls = []
  let running = 0
  let maxRunning = 0
  let releaseFirst
  let firstStarted
  const firstStartedPromise = new Promise((resolve) => { firstStarted = resolve })
  const firstReleasePromise = new Promise((resolve) => { releaseFirst = resolve })

  const taskA = enqueue(async () => {
    calls.push('A:start')
    running++
    maxRunning = Math.max(maxRunning, running)
    firstStarted()
    await firstReleasePromise
    running--
    calls.push('A:end')
    throw new Error('A failed')
  })

  await firstStartedPromise
  const taskB = enqueue(async () => {
    calls.push('B:start')
    running++
    maxRunning = Math.max(maxRunning, running)
    running--
    calls.push('B:end')
    return 'B completed'
  })

  // B 已入队，但 A 未结束前绝不能开始。
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['A:start'])

  releaseFirst()
  await assert.rejects(taskA, /A failed/)
  assert.equal(await taskB, 'B completed')
  assert.deepEqual(calls, ['A:start', 'A:end', 'B:start', 'B:end'])
  assert.equal(maxRunning, 1)
})

test('发布目录配置会规范化服务器路径并保留本地路径', () => {
  assert.deepEqual(
    __testables.sanitizeSftpPaths({
      localDir: '  /tmp/app-dist  ',
      remoteDir: 'home\\app//dist/',
    }),
    {
      localDir: '/tmp/app-dist',
      remoteDir: '/home/app/dist',
    },
  )
  assert.equal(__testables.normalizeRemoteDir('/'), '/')
})

test('发布目录保存会在落盘前校验本地目录并规范化远端目录', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-sftp-paths-'))
  try {
    assert.deepEqual(
      __testables.validateSftpPaths({
        localDir: `  ${tempRoot}  `,
        remoteDir: 'home\\app//dist/',
      }),
      {
        localDir: tempRoot,
        remoteDir: '/home/app/dist',
      },
    )

    assert.throws(
      () => __testables.validateSftpPaths({
        localDir: path.join(tempRoot, 'missing'),
        remoteDir: '/srv/app',
      }),
      { code: 'ENOENT' },
    )
    assert.throws(
      () => __testables.validateSftpPaths({ localDir: tempRoot, remoteDir: '' }),
      /请填写服务器目录/,
    )
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('排队发布任务只允许在创建时所属的发布环境中执行', () => {
  assert.doesNotThrow(() => __testables.assertDeploymentProfile({ id: 'production' }, 'production'))
  assert.throws(
    () => __testables.assertDeploymentProfile({ id: 'staging' }, 'production'),
    /发布环境已切换/,
  )
})

test('流式 ZIP 打包不整块读取文件，且生成的压缩包可被标准工具读取', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-stream-zip-'))
  const sourceDir = path.join(tempRoot, 'source')
  const zipPath = path.join(tempRoot, 'release.zip')
  try {
    const largeContent = Buffer.alloc(3 * 1024 * 1024 + 137)
    for (let index = 0; index < largeContent.length; index += 1) largeContent[index] = index % 251
    writeFile(path.join(sourceDir, 'assets', 'large.bin'), largeContent)
    writeFile(path.join(sourceDir, 'assets', 'config.json'), '{"enabled":true}')
    writeFile(path.join(sourceDir, 'ignored', 'secret.txt'), 'must not be archived')

    // 如果实现重新退化为 fs.readFileSync 整块读文件，此处会直接失败。
    const originalReadFileSync = fs.readFileSync
    fs.readFileSync = () => { throw new Error('不应整块读取待打包文件') }
    let result
    try {
      result = await __testables.createZipArchive([
        { localPath: sourceDir, archivePath: 'app' },
      ], zipPath, ['ignored/'])
    } finally {
      fs.readFileSync = originalReadFileSync
    }

    assert.equal(result.entryCount, 4)
    assert.ok(result.size > largeContent.length)
    const digest = require('node:crypto').createHash('sha256').update(largeContent).digest('hex')
    execFileSync('python3', ['-c', `
import hashlib, sys, zipfile
zip_path, expected_digest = sys.argv[1:]
with zipfile.ZipFile(zip_path) as archive:
    assert set(archive.namelist()) == {
        'app/', 'app/assets/', 'app/assets/large.bin', 'app/assets/config.json'
    }
    info = archive.getinfo('app/assets/large.bin')
    assert info.compress_type == zipfile.ZIP_STORED
    assert info.flag_bits & 0x08
    assert hashlib.sha256(archive.read('app/assets/large.bin')).hexdigest() == expected_digest
`, zipPath, digest])
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('回滚失败历史会保留环境、目标版本和原始错误', () => {
  const record = __testables.buildRollbackFailureHistoryRecord({
    activeProfile: { id: 'staging', name: '测试环境' },
    target: {
      id: 'release-001',
      label: 'Web 站点',
      remoteDir: '/srv/web',
      archiveRoots: ['web'],
      backupPath: '/srv/.ops-release-backups/release-001',
    },
    releaseId: 'ignored-release-id',
    error: new Error('SSH connection timed out'),
    remoteDir: '/srv/web',
    archiveRoots: ['web'],
    rollbackBackup: '/srv/.ops-release-backups/release-001-rollback-1',
    startedAt: 100,
    finishedAt: 200,
  })

  assert.deepEqual(record, {
    profileId: 'staging',
    profileName: '测试环境',
    action: 'rollback',
    status: 'failed',
    label: '回滚：Web 站点',
    remoteDir: '/srv/web',
    archiveRoots: ['web'],
    backupPath: '/srv/.ops-release-backups/release-001-rollback-1',
    sourceReleaseId: 'release-001',
    message: 'SSH connection timed out',
    startedAt: 100,
    finishedAt: 200,
  })
})
