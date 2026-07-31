const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const BACKUP_FORMAT = 'ops-desktop-backup'
const BACKUP_VERSION = 1
const DEFAULT_ITERATIONS = 210_000
const MAX_BACKUP_BYTES = 100 * 1024 * 1024
const MAX_ENTRY_BYTES = 20 * 1024 * 1024
const RESTORE_POINT_LIMIT = 3

const BACKUP_GROUPS = Object.freeze([
  {
    id: 'operations',
    label: '运维事件与自动化',
    description: '统一事件、自动化巡检、通知偏好和 Node 服务监控配置',
    files: ['ops-events.json', 'ops-automation-tasks.json', 'ops-notification-preferences.json', 'node-service-monitor.json'],
  },
  {
    id: 'release',
    label: '系统发布',
    description: '发布环境、连接配置、目录设置和发布历史',
    files: ['sftp-config.json', 'sftp-paths.json', 'release-profiles.json', 'release-history.json'],
  },
  {
    id: 'models',
    label: '模型可靠性',
    description: '模型范围、巡检设置和测试历史',
    files: ['model-test-history.json', 'model-monitor-settings.json', 'model-list-settings.json'],
  },
  {
    id: 'ai',
    label: 'AI 与知识',
    description: 'Provider、评测、日志分析、知识库和工作流记录',
    files: ['ai-providers.json', 'ai-evaluations.json', 'ai-log-analysis.json', 'ai-knowledge.json', 'ai-workflows.json'],
  },
  {
    id: 'desktop',
    label: '本机工具',
    description: '快捷启动和剪贴板历史',
    files: ['quick-launch.json', 'clipboard-history.json'],
  },
  {
    id: 'experiments',
    label: '实验功能',
    description: 'AI 图像实验配置和生成历史（不包含图片文件本体）',
    files: ['gpt-image-config.json', 'gpt-image-history.json'],
  },
])

const FILE_TO_GROUP = new Map(BACKUP_GROUPS.flatMap(group => group.files.map(fileName => [fileName, group.id])))

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) {
    throw new Error('备份密码需为 8 至 256 个字符')
  }
  return password
}

function normalizeCategories(categories) {
  const allowed = new Set(BACKUP_GROUPS.map(group => group.id))
  const values = Array.isArray(categories) ? categories : []
  const selected = [...new Set(values.map(value => String(value || '').trim()).filter(value => allowed.has(value)))]
  if (!selected.length) throw new Error('请至少选择一个备份分类')
  return selected
}

function assertJsonContent(content, fileName) {
  if (Buffer.byteLength(content, 'utf8') > MAX_ENTRY_BYTES) throw new Error(`${fileName} 超过单文件备份大小限制`)
  try {
    JSON.parse(content)
  } catch {
    throw new Error(`${fileName} 不是有效的 JSON 数据`)
  }
}

function getBackupOverview(userDataPath) {
  return {
    groups: BACKUP_GROUPS.map(group => {
      let sizeBytes = 0
      let fileCount = 0
      const invalidFiles = []
      for (const fileName of group.files) {
        const filePath = path.join(userDataPath, fileName)
        if (!fs.existsSync(filePath)) continue
        try {
          const content = fs.readFileSync(filePath, 'utf8')
          assertJsonContent(content, fileName)
          sizeBytes += Buffer.byteLength(content, 'utf8')
          fileCount += 1
        } catch {
          invalidFiles.push(fileName)
        }
      }
      return {
        id: group.id,
        label: group.label,
        description: group.description,
        fileCount,
        sizeBytes,
        invalidFiles,
        available: fileCount > 0,
      }
    }),
  }
}

function collectEntries(userDataPath, categories) {
  const selected = normalizeCategories(categories)
  const entries = []
  for (const groupId of selected) {
    const group = BACKUP_GROUPS.find(item => item.id === groupId)
    for (const fileName of group.files) {
      const filePath = path.join(userDataPath, fileName)
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, 'utf8')
      assertJsonContent(content, fileName)
      entries.push({ fileName, category: groupId, byteLength: Buffer.byteLength(content, 'utf8'), content })
    }
  }
  if (!entries.length) throw new Error('所选分类暂无可备份的数据')
  return entries
}

function deriveKey(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
}

function createBackupArchive({ userDataPath, password, categories, appVersion = '', now = Date.now(), iterations = DEFAULT_ITERATIONS }) {
  assertPassword(password)
  if (!Number.isSafeInteger(iterations) || iterations < 1_000 || iterations > 1_000_000) throw new Error('无效的密钥派生参数')
  const entries = collectEntries(userDataPath, categories)
  const payload = Buffer.from(JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: Number(now) || Date.now(),
    appVersion: String(appVersion || '').slice(0, 80),
    entries,
  }), 'utf8')
  if (payload.length > MAX_BACKUP_BYTES) throw new Error('备份数据超过大小限制')

  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = deriveKey(password, salt, iterations)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()])
  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    encrypted: true,
    createdAt: Number(now) || Date.now(),
    cipher: {
      name: 'aes-256-gcm',
      kdf: 'pbkdf2-sha256',
      iterations,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    },
    payload: encrypted.toString('base64'),
  }
  const archive = Buffer.from(JSON.stringify(envelope), 'utf8')
  if (archive.length > MAX_BACKUP_BYTES) throw new Error('备份文件超过大小限制')
  return archive
}

function readEnvelope(archive) {
  const buffer = Buffer.isBuffer(archive) ? archive : Buffer.from(archive || '')
  if (!buffer.length || buffer.length > MAX_BACKUP_BYTES) throw new Error('备份文件为空或超过大小限制')
  let envelope
  try {
    envelope = JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error('无法识别此备份文件')
  }
  if (envelope?.format !== BACKUP_FORMAT || envelope?.version !== BACKUP_VERSION || envelope?.encrypted !== true) {
    throw new Error('备份格式或版本不受支持')
  }
  const cipher = envelope.cipher || {}
  if (cipher.name !== 'aes-256-gcm' || cipher.kdf !== 'pbkdf2-sha256') throw new Error('备份加密方式不受支持')
  if (!Number.isSafeInteger(cipher.iterations) || cipher.iterations < 1_000 || cipher.iterations > 1_000_000) throw new Error('备份加密参数无效')
  return envelope
}

function parseBackupArchive(archive, password) {
  assertPassword(password)
  const envelope = readEnvelope(archive)
  let payload
  try {
    const salt = Buffer.from(envelope.cipher.salt, 'base64')
    const iv = Buffer.from(envelope.cipher.iv, 'base64')
    const tag = Buffer.from(envelope.cipher.tag, 'base64')
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('invalid cipher fields')
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt, envelope.cipher.iterations), iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.payload, 'base64')), decipher.final()])
    if (decrypted.length > MAX_BACKUP_BYTES) throw new Error('payload too large')
    payload = JSON.parse(decrypted.toString('utf8'))
  } catch {
    throw new Error('备份密码错误，或文件已损坏')
  }

  if (payload?.format !== BACKUP_FORMAT || payload?.version !== BACKUP_VERSION || !Array.isArray(payload.entries)) {
    throw new Error('备份内容无效')
  }
  const seen = new Set()
  const entries = payload.entries.map((entry) => {
    const fileName = String(entry?.fileName || '')
    const category = String(entry?.category || '')
    const content = typeof entry?.content === 'string' ? entry.content : ''
    if (!FILE_TO_GROUP.has(fileName) || FILE_TO_GROUP.get(fileName) !== category || seen.has(fileName)) throw new Error('备份包含不允许的数据文件')
    assertJsonContent(content, fileName)
    seen.add(fileName)
    return { fileName, category, byteLength: Buffer.byteLength(content, 'utf8'), content }
  })
  if (!entries.length) throw new Error('备份中没有可恢复的数据')
  return {
    createdAt: Number(payload.createdAt) || Number(envelope.createdAt) || 0,
    appVersion: String(payload.appVersion || '').slice(0, 80),
    entries,
  }
}

function summarizeBackup(payload) {
  const counts = new Map()
  let sizeBytes = 0
  for (const entry of payload.entries) {
    counts.set(entry.category, (counts.get(entry.category) || 0) + 1)
    sizeBytes += entry.byteLength
  }
  return {
    createdAt: payload.createdAt,
    appVersion: payload.appVersion,
    fileCount: payload.entries.length,
    sizeBytes,
    groups: BACKUP_GROUPS.filter(group => counts.has(group.id)).map(group => ({
      id: group.id,
      label: group.label,
      fileCount: counts.get(group.id),
    })),
  }
}

function inspectBackupArchive(archive, password) {
  return summarizeBackup(parseBackupArchive(archive, password))
}

function writeAtomic(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tempPath, filePath)
  try { fs.chmodSync(filePath, 0o600) } catch {}
}

function pruneRestorePoints(rootPath) {
  if (!fs.existsSync(rootPath)) return
  const items = fs.readdirSync(rootPath, { withFileTypes: true })
    .filter(item => item.isDirectory())
    .map(item => ({ name: item.name, mtimeMs: fs.statSync(path.join(rootPath, item.name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const item of items.slice(RESTORE_POINT_LIMIT)) fs.rmSync(path.join(rootPath, item.name), { recursive: true, force: true })
}

function restoreBackupArchive({ userDataPath, archive, password, now = Date.now() }) {
  const payload = parseBackupArchive(archive, password)
  fs.mkdirSync(userDataPath, { recursive: true })
  const restoreRoot = path.join(userDataPath, 'ops-backup-restore-points')
  const restorePoint = path.join(restoreRoot, `${Number(now) || Date.now()}-${crypto.randomBytes(4).toString('hex')}`)
  const previousFiles = new Set()
  fs.mkdirSync(restorePoint, { recursive: true, mode: 0o700 })

  try {
    for (const entry of payload.entries) {
      const targetPath = path.join(userDataPath, entry.fileName)
      if (!fs.existsSync(targetPath)) continue
      const previousPath = path.join(restorePoint, entry.fileName)
      fs.copyFileSync(targetPath, previousPath)
      try { fs.chmodSync(previousPath, 0o600) } catch {}
      previousFiles.add(entry.fileName)
    }
    writeAtomic(path.join(restorePoint, 'manifest.json'), JSON.stringify({
      createdAt: Number(now) || Date.now(),
      sourceCreatedAt: payload.createdAt,
      files: [...previousFiles],
    }, null, 2))

    for (const entry of payload.entries) writeAtomic(path.join(userDataPath, entry.fileName), entry.content)
  } catch (error) {
    for (const entry of payload.entries) {
      const targetPath = path.join(userDataPath, entry.fileName)
      const previousPath = path.join(restorePoint, entry.fileName)
      try {
        if (previousFiles.has(entry.fileName) && fs.existsSync(previousPath)) fs.copyFileSync(previousPath, targetPath)
        else if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath)
      } catch {}
    }
    throw error
  }

  pruneRestorePoints(restoreRoot)
  return {
    ...summarizeBackup(payload),
    restoredAt: Number(now) || Date.now(),
    restartRequired: true,
  }
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_GROUPS,
  BACKUP_VERSION,
  MAX_BACKUP_BYTES,
  createBackupArchive,
  getBackupOverview,
  inspectBackupArchive,
  parseBackupArchive,
  restoreBackupArchive,
}
