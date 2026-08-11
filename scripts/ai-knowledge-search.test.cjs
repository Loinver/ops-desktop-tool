const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  collectKnowledgeFiles,
  importKnowledgeDirectory,
  loadKnowledgeState,
  saveKnowledgeDocument,
  searchKnowledge
} = require('../src/main/utils/ai-ops')

function temporaryWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-ai-knowledge-'))
  const userDataPath = path.join(root, 'user-data')
  const sourcePath = path.join(root, 'knowledge-source')
  fs.mkdirSync(userDataPath, { recursive: true })
  fs.mkdirSync(sourcePath, { recursive: true })
  return {
    root,
    userDataPath,
    sourcePath,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  }
}

test('知识检索混合短语、关键词和文本相似度并返回可解释元数据', () => {
  const workspace = temporaryWorkspace()
  try {
    const release = saveKnowledgeDocument(workspace.userDataPath, {
      title: '正式环境发布 SOP',
      tags: ['发布', '回滚'],
      content: '发布失败时先停止继续发布。\n确认备份完成后执行版本回滚。\n回滚后检查健康状态。'
    })
    saveKnowledgeDocument(workspace.userDataPath, {
      title: '服务器磁盘巡检',
      tags: ['服务器', '磁盘'],
      content: '检查磁盘空间、日志目录和临时文件。'
    })

    const exact = searchKnowledge(workspace.userDataPath, '正式环境如何回滚', 8)
    assert.equal(exact.length > 0, true)
    assert.equal(exact[0].documentId, release.id)
    assert.equal(['短语命中', '关键词 + 相似度', '关键词命中'].includes(exact[0].matchReason), true)
    assert.equal(exact[0].score > 0, true)
    assert.equal(exact[0].updatedAt > 0, true)
    assert.equal(exact[0].source.type, 'manual')
    assert.equal(Array.isArray(exact[0].matchedTerms), true)

    const similar = searchKnowledge(workspace.userDataPath, '版本回滚后确认健康', 8)
    assert.equal(similar.some((item) => item.documentId === release.id), true)
    assert.equal(similar.find((item) => item.documentId === release.id).similarity > 0, true)
  } finally {
    workspace.cleanup()
  }
})

test('目录知识导入具备增量语义且不会保存绝对路径', () => {
  const workspace = temporaryWorkspace()
  try {
    fs.writeFileSync(path.join(workspace.sourcePath, 'release.md'), '# 发布\n发布后检查健康状态。')
    fs.mkdirSync(path.join(workspace.sourcePath, 'nested'))
    fs.writeFileSync(path.join(workspace.sourcePath, 'nested', 'server.txt'), '服务器异常时检查端口。')
    fs.writeFileSync(path.join(workspace.sourcePath, 'ignored.bin'), 'ignored')

    const first = importKnowledgeDirectory(workspace.userDataPath, workspace.sourcePath)
    assert.deepEqual(
      {
        imported: first.summary.imported,
        updated: first.summary.updated,
        unchanged: first.summary.unchanged
      },
      { imported: 2, updated: 0, unchanged: 0 }
    )
    assert.equal(first.state.version, 2)
    assert.equal(first.state.documents.every((item) => item.source.type === 'directory'), true)
    assert.equal(
      first.state.documents.every(
        (item) =>
          !JSON.stringify(item).includes(workspace.root) &&
          item.source.collectionId &&
          item.source.fingerprint &&
          item.index?.version === 2
      ),
      true
    )

    const second = importKnowledgeDirectory(workspace.userDataPath, workspace.sourcePath)
    assert.equal(second.summary.imported, 0)
    assert.equal(second.summary.updated, 0)
    assert.equal(second.summary.unchanged, 2)
    assert.equal(second.state.documents.length, 2)

    fs.writeFileSync(path.join(workspace.sourcePath, 'release.md'), '# 发布\n发布失败后先回滚，再检查健康状态。')
    fs.writeFileSync(path.join(workspace.sourcePath, 'handoff.yaml'), 'owner: ops\nstatus: ready\n')
    const third = importKnowledgeDirectory(workspace.userDataPath, workspace.sourcePath)
    assert.equal(third.summary.imported, 1)
    assert.equal(third.summary.updated, 1)
    assert.equal(third.summary.unchanged, 1)
    assert.equal(third.state.documents.length, 3)

    const releaseDoc = third.state.documents.find((item) => item.source.name === 'release.md')
    const edited = saveKnowledgeDocument(workspace.userDataPath, {
      id: releaseDoc.id,
      title: releaseDoc.title,
      tags: releaseDoc.tags,
      content: `${releaseDoc.content}\n人工补充确认项。`
    })
    assert.equal(edited.source.type, 'directory')
    assert.equal(edited.source.name, 'release.md')
  } finally {
    workspace.cleanup()
  }
})

test('目录扫描限制文件类型、单文件大小、深度和符号链接', () => {
  const workspace = temporaryWorkspace()
  try {
    fs.writeFileSync(path.join(workspace.sourcePath, 'ok.md'), 'ok')
    fs.writeFileSync(path.join(workspace.sourcePath, 'too-large.txt'), 'x'.repeat(64))
    fs.writeFileSync(path.join(workspace.sourcePath, 'ignored.png'), 'png')
    fs.mkdirSync(path.join(workspace.sourcePath, 'level-1'))
    fs.mkdirSync(path.join(workspace.sourcePath, 'level-1', 'level-2'))
    fs.writeFileSync(path.join(workspace.sourcePath, 'level-1', 'level-2', 'deep.md'), 'deep')
    try {
      fs.symlinkSync(path.join(workspace.sourcePath, 'ok.md'), path.join(workspace.sourcePath, 'link.md'))
    } catch {
      // 部分平台或 CI 禁止创建符号链接；其余边界仍然有效。
    }

    const scan = collectKnowledgeFiles(workspace.sourcePath, {
      maxDepth: 1,
      maxFileBytes: 16,
      maxTotalBytes: 128,
      maxFiles: 10
    })
    assert.deepEqual(scan.files.map((item) => item.relativePath), ['ok.md'])
    assert.equal(scan.skipped.some((item) => item.name === 'too-large.txt'), true)
    assert.equal(scan.skipped.some((item) => item.name === 'level-2'), true)
    if (fs.existsSync(path.join(workspace.sourcePath, 'link.md')))
      assert.equal(scan.skipped.some((item) => item.name === 'link.md'), true)

    const state = loadKnowledgeState(workspace.userDataPath)
    assert.deepEqual(state.documents, [])
  } finally {
    workspace.cleanup()
  }
})
