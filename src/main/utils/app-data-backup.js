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


const AUTO_BACKUP_SETTINGS_FILE = 'ops-auto-backup-settings.json'
const AUTO_BACKUP_HISTORY_FILE = 'ops-auto-backup-history.json'
const AUTO_BACKUP_DIRECTORY_NAME = 'ops-auto-backups'
const AUTO_BACKUP_HISTORY_LIMIT = 50
const AUTO_BACKUP_INTERVALS = Object.freeze({ daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 })

function autoBackupSettingsPath(userDataPath) { return path.join(userDataPath, AUTO_BACKUP_SETTINGS_FILE) }
function autoBackupHistoryPath(userDataPath) { return path.join(userDataPath, AUTO_BACKUP_HISTORY_FILE) }
function restorePointsPath(userDataPath) { return path.join(userDataPath, 'ops-backup-restore-points') }

function defaultAutoBackupSettings() {
  return {
    enabled: false,
    outputDirectory: '',
    interval: 'weekly',
    retentionCount: 7,
    categories: BACKUP_GROUPS.map(group => group.id),
    passwordEncrypted: '',
    lastRunAt: 0,
    nextRunAt: 0,
  }
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function normalizeAutoBackupSettings(value = {}) {
  const defaults = defaultAutoBackupSettings()
  const interval = Object.hasOwn(AUTO_BACKUP_INTERVALS, value.interval) ? value.interval : defaults.interval
  const categories = Array.isArray(value.categories)
    ? [...new Set(value.categories.map(item => String(item || '')).filter(item => BACKUP_GROUPS.some(group => group.id === item)))]
    : defaults.categories
  return {
    enabled: Boolean(value.enabled),
    outputDirectory: typeof value.outputDirectory === 'string' ? value.outputDirectory.slice(0, 4096) : '',
    interval,
    retentionCount: clampInteger(value.retentionCount, defaults.retentionCount, 1, 30),
    categories,
    passwordEncrypted: typeof value.passwordEncrypted === 'string' ? value.passwordEncrypted.slice(0, 16 * 1024) : '',
    lastRunAt: Number(value.lastRunAt) || 0,
    nextRunAt: Number(value.nextRunAt) || 0,
  }
}

function readAutoBackupSettings(userDataPath) {
  try {
    if (!fs.existsSync(autoBackupSettingsPath(userDataPath))) return defaultAutoBackupSettings()
    return normalizeAutoBackupSettings(JSON.parse(fs.readFileSync(autoBackupSettingsPath(userDataPath), 'utf8')))
  } catch {
    return defaultAutoBackupSettings()
  }
}

function safeAutoBackupSettings(settings) {
  const normalized = normalizeAutoBackupSettings(settings)
  return {
    enabled: normalized.enabled,
    outputDirectory: normalized.outputDirectory,
    interval: normalized.interval,
    retentionCount: normalized.retentionCount,
    categories: normalized.categories,
    hasPassword: Boolean(normalized.passwordEncrypted),
    lastRunAt: normalized.lastRunAt,
    nextRunAt: normalized.nextRunAt,
  }
}

function assertOutputDirectory(directory) {
  const resolved = path.resolve(String(directory || '').trim().slice(0, 4096))
  if (!resolved || resolved === path.parse(resolved).root) throw new Error('请选择一个专用的自动备份目录')
  let stat
  try { stat = fs.statSync(resolved) } catch { throw new Error('自动备份目录不存在或无法访问') }
  if (!stat.isDirectory()) throw new Error('自动备份位置必须是目录')
  return resolved
}

function saveAutoBackupSettings({ userDataPath, input = {}, encryptPassword, now = Date.now() }) {
  const current = readAutoBackupSettings(userDataPath)
  const suppliedPassword = typeof input.password === 'string' ? input.password : ''
  const next = normalizeAutoBackupSettings({
    ...current,
    ...(Object.hasOwn(input, 'enabled') ? { enabled: input.enabled } : {}),
    ...(Object.hasOwn(input, 'outputDirectory') ? { outputDirectory: input.outputDirectory } : {}),
    ...(Object.hasOwn(input, 'interval') ? { interval: input.interval } : {}),
    ...(Object.hasOwn(input, 'retentionCount') ? { retentionCount: input.retentionCount } : {}),
    ...(Object.hasOwn(input, 'categories') ? { categories: input.categories } : {}),
  })
  if (suppliedPassword) {
    assertPassword(suppliedPassword)
    if (typeof encryptPassword !== 'function') throw new Error('当前环境无法安全保存自动备份密码')
    next.passwordEncrypted = String(encryptPassword(suppliedPassword) || '')
  }
  if (next.enabled) {
    next.outputDirectory = assertOutputDirectory(next.outputDirectory)
    if (!next.categories.length) throw new Error('请至少选择一个自动备份分类')
    if (!next.passwordEncrypted) throw new Error('启用自动备份前，请设置备份密码')
    next.nextRunAt = (Number(now) || Date.now()) + AUTO_BACKUP_INTERVALS[next.interval]
  } else {
    next.nextRunAt = 0
  }
  fs.mkdirSync(userDataPath, { recursive: true })
  writeAtomic(autoBackupSettingsPath(userDataPath), JSON.stringify(next, null, 2))
  return safeAutoBackupSettings(next)
}

function normalizeAutoBackupHistory(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    id: String(item?.id || '').slice(0, 80),
    createdAt: Number(item?.createdAt) || 0,
    fileName: path.basename(String(item?.fileName || '')).slice(0, 255),
    outputDirectory: typeof item?.outputDirectory === 'string' ? item.outputDirectory.slice(0, 4096) : '',
    sizeBytes: Math.max(0, Number(item?.sizeBytes) || 0),
    status: item?.status === 'failed' ? 'failed' : 'success',
    error: item?.status === 'failed' ? String(item?.error || '自动备份失败').slice(0, 280) : '',
    categories: Array.isArray(item?.categories) ? item.categories.filter(category => BACKUP_GROUPS.some(group => group.id === category)) : [],
    passwordEncrypted: item?.status === 'failed' ? '' : (typeof item?.passwordEncrypted === 'string' ? item.passwordEncrypted.slice(0, 16 * 1024) : ''),
  })).filter(item => item.id && item.createdAt && item.outputDirectory)
}

function readAutoBackupHistory(userDataPath) {
  try {
    if (!fs.existsSync(autoBackupHistoryPath(userDataPath))) return []
    return normalizeAutoBackupHistory(JSON.parse(fs.readFileSync(autoBackupHistoryPath(userDataPath), 'utf8')))
  } catch {
    return []
  }
}

function autoBackupFileState(entry) {
  if (entry.status !== 'success') return 'failed'
  try {
    const filePath = safeAutoBackupFilePath(entry.outputDirectory, entry.fileName)
    const stat = fs.lstatSync(filePath)
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_BACKUP_BYTES ? 'available' : 'missing'
  } catch {
    return 'missing'
  }
}

function safeAutoBackupHistory(entries) {
  return normalizeAutoBackupHistory(entries).map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    fileName: entry.fileName,
    sizeBytes: entry.sizeBytes,
    status: entry.status,
    error: entry.error,
    categories: entry.categories,
    availability: autoBackupFileState(entry),
  }))
}

function getAutoBackupHistory(userDataPath) {
  return safeAutoBackupHistory(readAutoBackupHistory(userDataPath))
}

function writeAutoBackupHistory(userDataPath, entries) {
  writeAtomic(autoBackupHistoryPath(userDataPath), JSON.stringify(normalizeAutoBackupHistory(entries).slice(0, AUTO_BACKUP_HISTORY_LIMIT), null, 2))
}

function safeAutoBackupFilePath(outputDirectory, fileName) {
  const directory = assertOutputDirectory(outputDirectory)
  const safeName = path.basename(String(fileName || ''))
  if (!/^ops-desktop-auto-[0-9TZ-]+-[a-f0-9]{8}\.opsbackup$/.test(safeName)) throw new Error('自动备份文件名无效')
  const result = path.resolve(directory, safeName)
  if (path.dirname(result) !== directory) throw new Error('自动备份文件路径无效')
  return result
}

function compactTimestamp(value) {
  return new Date(value).toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')
}

function findAutoBackupHistoryEntry(userDataPath, id) {
  const entryId = String(id || '').slice(0, 80)
  if (!entryId) throw new Error('自动备份标识无效')
  const entry = readAutoBackupHistory(userDataPath).find(item => item.id === entryId)
  if (!entry || entry.status !== 'success') throw new Error('自动备份记录不存在或不可恢复')
  return entry
}

function readAutoBackupArchive(userDataPath, id) {
  const entry = findAutoBackupHistoryEntry(userDataPath, id)
  let filePath
  let stat
  try {
    filePath = safeAutoBackupFilePath(entry.outputDirectory, entry.fileName)
    stat = fs.lstatSync(filePath)
  } catch {
    throw new Error('自动备份文件已不存在')
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_BACKUP_BYTES) {
    throw new Error('自动备份文件不可用')
  }
  return { entry, filePath, archive: fs.readFileSync(filePath) }
}

function getAutoBackupPassword({ userDataPath, entry, decryptPassword }) {
  if (typeof decryptPassword !== 'function') throw new Error('当前环境无法解密自动备份密码')
  const settings = readAutoBackupSettings(userDataPath)
  const encrypted = entry.passwordEncrypted || settings.passwordEncrypted
  if (!encrypted) throw new Error('自动备份密码不可用，请重新设置后手动恢复')
  const password = decryptPassword(encrypted)
  assertPassword(password)
  return password
}

function inspectAutoBackup({ userDataPath, id, decryptPassword }) {
  const { entry, archive } = readAutoBackupArchive(userDataPath, id)
  return {
    fileName: entry.fileName,
    createdAt: entry.createdAt,
    summary: inspectBackupArchive(archive, getAutoBackupPassword({ userDataPath, entry, decryptPassword })),
  }
}

function restoreAutoBackup({ userDataPath, id, decryptPassword, now = Date.now() }) {
  const { entry, archive } = readAutoBackupArchive(userDataPath, id)
  return restoreBackupArchive({
    userDataPath,
    archive,
    password: getAutoBackupPassword({ userDataPath, entry, decryptPassword }),
    now,
  })
}

function deleteAutoBackup({ userDataPath, id }) {
  const entry = findAutoBackupHistoryEntry(userDataPath, id)
  let deleted = false
  try {
    const filePath = safeAutoBackupFilePath(entry.outputDirectory, entry.fileName)
    const stat = fs.lstatSync(filePath)
    if (stat.isFile() && !stat.isSymbolicLink()) {
      fs.unlinkSync(filePath)
      deleted = true
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  writeAutoBackupHistory(userDataPath, readAutoBackupHistory(userDataPath).filter(item => item.id !== entry.id))
  return { deleted, missing: !deleted }
}

function getAutoBackupDirectory({ userDataPath, id }) {
  const entry = findAutoBackupHistoryEntry(userDataPath, id)
  return assertOutputDirectory(entry.outputDirectory)
}

function pruneAutoBackups({ userDataPath, outputDirectory, retentionCount }) {
  const directory = assertOutputDirectory(outputDirectory)
  const history = readAutoBackupHistory(userDataPath)
  const active = []
  const removable = []
  for (const entry of history) {
    if (path.resolve(entry.outputDirectory) !== directory || entry.status !== 'success') {
      active.push(entry)
      continue
    }
    if (active.filter(item => path.resolve(item.outputDirectory) === directory && item.status === 'success').length < retentionCount) active.push(entry)
    else removable.push(entry)
  }
  for (const entry of removable) {
    try {
      const filePath = safeAutoBackupFilePath(directory, entry.fileName)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {}
  }
  writeAutoBackupHistory(userDataPath, active)
  return active
}

function updateAutoBackupTiming(userDataPath, settings, now) {
  const next = normalizeAutoBackupSettings({
    ...settings,
    lastRunAt: Number(now) || Date.now(),
    nextRunAt: (Number(now) || Date.now()) + AUTO_BACKUP_INTERVALS[settings.interval],
  })
  writeAtomic(autoBackupSettingsPath(userDataPath), JSON.stringify(next, null, 2))
  return next
}

function runAutoBackup({ userDataPath, decryptPassword, appVersion = '', now = Date.now(), iterations = DEFAULT_ITERATIONS }) {
  const settings = readAutoBackupSettings(userDataPath)
  if (!settings.enabled) throw new Error('自动备份尚未启用')
  settings.outputDirectory = assertOutputDirectory(settings.outputDirectory)
  if (!settings.passwordEncrypted || typeof decryptPassword !== 'function') throw new Error('自动备份密码不可用，请重新设置')
  const password = decryptPassword(settings.passwordEncrypted)
  assertPassword(password)
  const archive = createBackupArchive({ userDataPath, password, categories: settings.categories, appVersion, now, iterations })
  const fileName = `ops-desktop-auto-${compactTimestamp(now)}-${crypto.randomBytes(4).toString('hex')}.opsbackup`
  const filePath = safeAutoBackupFilePath(settings.outputDirectory, fileName)
  fs.writeFileSync(filePath, archive, { mode: 0o600 })
  try { fs.chmodSync(filePath, 0o600) } catch {}

  const entry = {
    id: crypto.randomUUID(),
    createdAt: Number(now) || Date.now(),
    fileName,
    outputDirectory: settings.outputDirectory,
    sizeBytes: archive.length,
    status: 'success',
    categories: settings.categories,
    passwordEncrypted: settings.passwordEncrypted,
  }
  writeAutoBackupHistory(userDataPath, [entry, ...readAutoBackupHistory(userDataPath)])
  pruneAutoBackups({ userDataPath, outputDirectory: settings.outputDirectory, retentionCount: settings.retentionCount })
  const updated = updateAutoBackupTiming(userDataPath, settings, now)
  return { entry, settings: safeAutoBackupSettings(updated) }
}

function recordAutoBackupFailure({ userDataPath, error, now = Date.now() }) {
  const settings = readAutoBackupSettings(userDataPath)
  if (!settings.enabled || !settings.outputDirectory) return safeAutoBackupSettings(settings)
  const entry = {
    id: crypto.randomUUID(),
    createdAt: Number(now) || Date.now(),
    fileName: '',
    outputDirectory: settings.outputDirectory,
    sizeBytes: 0,
    status: 'failed',
    error: String(error?.message || error || '自动备份失败').slice(0, 280),
    categories: settings.categories,
  }
  writeAutoBackupHistory(userDataPath, [entry, ...readAutoBackupHistory(userDataPath)])
  return safeAutoBackupSettings(updateAutoBackupTiming(userDataPath, settings, now))
}

function listRestorePoints(userDataPath) {
  const root = restorePointsPath(userDataPath)
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(item => item.isDirectory() && /^\d+-[a-f0-9]{8}$/.test(item.name))
    .map((item) => {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, item.name, 'manifest.json'), 'utf8'))
        const files = Array.isArray(manifest.files) ? manifest.files.filter(fileName => FILE_TO_GROUP.has(fileName)) : []
        const groups = [...new Set(files.map(fileName => FILE_TO_GROUP.get(fileName)))].map(id => BACKUP_GROUPS.find(group => group.id === id)?.label).filter(Boolean)
        return {
          id: item.name,
          createdAt: Number(manifest.createdAt) || 0,
          sourceCreatedAt: Number(manifest.sourceCreatedAt) || 0,
          fileCount: files.length,
          groups,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
}

function createRestorePoint(userDataPath, fileNames, { now = Date.now(), sourceCreatedAt = 0 } = {}) {
  const root = restorePointsPath(userDataPath)
  const point = path.join(root, `${Number(now) || Date.now()}-${crypto.randomBytes(4).toString('hex')}`)
  const files = []
  fs.mkdirSync(point, { recursive: true, mode: 0o700 })
  for (const fileName of fileNames) {
    if (!FILE_TO_GROUP.has(fileName)) continue
    const targetPath = path.join(userDataPath, fileName)
    if (!fs.existsSync(targetPath)) continue
    const content = fs.readFileSync(targetPath, 'utf8')
    assertJsonContent(content, fileName)
    fs.copyFileSync(targetPath, path.join(point, fileName))
    try { fs.chmodSync(path.join(point, fileName), 0o600) } catch {}
    files.push(fileName)
  }
  writeAtomic(path.join(point, 'manifest.json'), JSON.stringify({ createdAt: Number(now) || Date.now(), sourceCreatedAt, files }, null, 2))
  pruneRestorePoints(root)
  return point
}

function restoreRestorePoint({ userDataPath, id, now = Date.now() }) {
  const pointId = String(id || '')
  if (!/^\d+-[a-f0-9]{8}$/.test(pointId)) throw new Error('恢复点标识无效')
  const point = path.join(restorePointsPath(userDataPath), pointId)
  const resolvedPoint = path.resolve(point)
  if (path.dirname(resolvedPoint) !== path.resolve(restorePointsPath(userDataPath))) throw new Error('恢复点路径无效')
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(path.join(resolvedPoint, 'manifest.json'), 'utf8')) } catch { throw new Error('恢复点已损坏或不存在') }
  const files = Array.isArray(manifest.files) ? [...new Set(manifest.files.filter(fileName => FILE_TO_GROUP.has(fileName)))] : []
  if (!files.length) throw new Error('恢复点不包含可恢复的数据')
  const records = files.map((fileName) => {
    const content = fs.readFileSync(path.join(resolvedPoint, fileName), 'utf8')
    assertJsonContent(content, fileName)
    return { fileName, content }
  })
  createRestorePoint(userDataPath, files, { now, sourceCreatedAt: Number(manifest.createdAt) || 0 })
  for (const record of records) writeAtomic(path.join(userDataPath, record.fileName), record.content)
  return { restoredAt: Number(now) || Date.now(), fileCount: records.length, restartRequired: true }
}

module.exports = {
  AUTO_BACKUP_INTERVALS,
  BACKUP_FORMAT,
  BACKUP_GROUPS,
  BACKUP_VERSION,
  MAX_BACKUP_BYTES,
  createBackupArchive,
  deleteAutoBackup,
  getAutoBackupDirectory,
  getAutoBackupHistory,
  getBackupOverview,
  inspectAutoBackup,
  inspectBackupArchive,
  listRestorePoints,
  parseBackupArchive,
  readAutoBackupHistory,
  readAutoBackupSettings,
  recordAutoBackupFailure,
  restoreAutoBackup,
  restoreBackupArchive,
  restoreRestorePoint,
  runAutoBackup,
  safeAutoBackupHistory,
  safeAutoBackupSettings,
  saveAutoBackupSettings,
}
