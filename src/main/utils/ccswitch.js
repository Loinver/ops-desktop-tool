/**
 * cc-switch 配置读取
 *
 * cc-switch 把中转站（供应商）配置存在 SQLite 库的 providers 表里。
 * 优先使用 Electron 内置的 node:sqlite 只读连接，以原生支持 WAL 快照；普通数据库在
 * 运行时不提供 node:sqlite 时回退到随应用打包的 sql.js，避免依赖系统 sqlite3 命令。
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const initSqlJs = require('sql.js')

const CC_SWITCH_APP_ID = 'com.ccswitch.desktop'
let sqlJsPromise = null

function uniquePaths(values, pathApi = path) {
  const seen = new Set()
  return values.filter((value) => {
    const normalized = pathApi.normalize(String(value || '').trim())
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function ccSwitchStoreDirectories({
  platform = process.platform,
  homeDir = os.homedir(),
  env = process.env,
  pathApi = platform === 'win32' ? path.win32 : path
} = {}) {
  if (platform === 'darwin') {
    return [pathApi.join(homeDir, 'Library', 'Application Support', CC_SWITCH_APP_ID)]
  }
  if (platform === 'win32') {
    return uniquePaths(
      [
        env.APPDATA && pathApi.join(env.APPDATA, CC_SWITCH_APP_ID),
        pathApi.join(homeDir, 'AppData', 'Roaming', CC_SWITCH_APP_ID),
        env.LOCALAPPDATA && pathApi.join(env.LOCALAPPDATA, CC_SWITCH_APP_ID)
      ],
      pathApi
    )
  }
  return [
    pathApi.join(env.XDG_DATA_HOME || pathApi.join(homeDir, '.local', 'share'), CC_SWITCH_APP_ID)
  ]
}

/**
 * CC Switch 允许通过 app_paths.json 把数据库目录迁移到同步盘等自定义位置。
 * 默认目录始终是 ~/.cc-switch；Tauri 应用数据目录同时作为旧版兼容候选。
 */
function databaseCandidatesFor(options = {}) {
  const homeDir = options.homeDir || os.homedir()
  const platform = options.platform || process.platform
  const pathApi = options.pathApi || (platform === 'win32' ? path.win32 : path)
  const storeDirectories = ccSwitchStoreDirectories({ ...options, platform, homeDir, pathApi })
  const customDirectories = []

  for (const storeDirectory of storeDirectories) {
    try {
      const store = JSON.parse(
        fs.readFileSync(pathApi.join(storeDirectory, 'app_paths.json'), 'utf8')
      )
      if (typeof store?.appConfigDir === 'string' && pathApi.isAbsolute(store.appConfigDir)) {
        customDirectories.push(store.appConfigDir)
      }
    } catch {
      // 未启用自定义目录或 store 尚未创建。
    }
  }

  return uniquePaths(
    [
      ...customDirectories.map((directory) => pathApi.join(directory, 'cc-switch.db')),
      pathApi.join(homeDir, '.cc-switch', 'cc-switch.db'),
      ...storeDirectories.map((directory) => pathApi.join(directory, 'cc-switch.db'))
    ],
    pathApi
  )
}

function findDatabasePath(options = {}) {
  const platform = options.platform || process.platform
  const pathApi = options.pathApi || (platform === 'win32' ? path.win32 : path)
  const candidates = Array.isArray(options.dbCandidates)
    ? uniquePaths(options.dbCandidates, pathApi)
    : databaseCandidatesFor({ ...options, platform, pathApi })
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate)
      if (stat.isFile() && stat.size > 0) return candidate
    } catch {
      // 不存在则继续找下一个
    }
  }
  return null
}

async function loadSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      // 直接提供二进制，避免打包进 app.asar 后依赖 fetch/file URL 定位 wasm。
      wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
    }).catch((error) => {
      sqlJsPromise = null
      throw error
    })
  }
  return sqlJsPromise
}

async function readStableDatabaseFile(dbPath) {
  let lastBytes = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await fs.promises.stat(dbPath)
    const bytes = await fs.promises.readFile(dbPath)
    const after = await fs.promises.stat(dbPath)
    lastBytes = bytes
    if (before.size === after.size && before.mtimeMs === after.mtimeMs) return bytes
    await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)))
  }
  return lastBytes
}

function activeWalPath(dbPath) {
  const walPath = `${dbPath}-wal`
  try {
    const stat = fs.statSync(walPath)
    return stat.isFile() && stat.size > 0 ? walPath : null
  } catch {
    return null
  }
}

function nativeDatabaseClass(options = {}) {
  if (Object.hasOwn(options, 'nativeDatabaseClass')) return options.nativeDatabaseClass
  try {
    return require('node:sqlite').DatabaseSync
  } catch {
    return null
  }
}

function openNativeDatabase(dbPath, DatabaseSync) {
  const database = new DatabaseSync(dbPath, { readOnly: true, timeout: 2_000 })
  return {
    queryRows: (sql) => database.prepare(sql).all(),
    close: () => database.close()
  }
}

function queryRows(database, sql) {
  if (typeof database?.queryRows === 'function') return database.queryRows(sql)

  const results = database.exec(sql)
  const rows = []
  for (const result of results) {
    for (const values of result.values) {
      rows.push(Object.fromEntries(result.columns.map((column, index) => [column, values[index]])))
    }
  }
  return rows
}

async function openDatabase(dbPath, options = {}) {
  const walPath = activeWalPath(dbPath)
  const DatabaseSync = options.preferNativeSqlite === false ? null : nativeDatabaseClass(options)

  if (DatabaseSync) {
    try {
      return openNativeDatabase(dbPath, DatabaseSync)
    } catch (error) {
      if (walPath) {
        throw new Error(`无法使用内置 SQLite 读取 WAL 快照：${error.message}`, { cause: error })
      }
    }
  }

  if (walPath) {
    throw new Error(`检测到尚未 checkpoint 的 SQLite WAL，但当前运行时无法安全读取：${walPath}`)
  }

  const SQL = await loadSqlJs()
  const bytes = await readStableDatabaseFile(dbPath)
  return new SQL.Database(bytes)
}

/** 支持测试的 app 类型 */
const SUPPORTED_APP_TYPES = ['claude', 'claude-desktop', 'codex', 'gemini']

const APP_TYPE_LABELS = {
  claude: 'Claude',
  'claude-desktop': 'Claude Desktop',
  codex: 'Codex',
  gemini: 'Gemini'
}

/** Claude 模型映射的档位顺序，决定展示顺序 */
const CLAUDE_TIERS = ['OPUS', 'SONNET', 'HAIKU', 'FABLE', 'MYTHOS']
const ONE_M_MODEL_MARKER_RE = /\s*\[1m\]\s*$/i

/**
 * cc-switch 的 [1M] / [1m] 是本地能力标识，不是上游模型名的一部分。
 * 同时兼容标识前有空格、以及标识写在 _MODEL_NAME 中的配置。
 */
function splitOneMModelMarker(value) {
  const raw = String(value || '').trim()
  const beta1m = ONE_M_MODEL_MARKER_RE.test(raw)
  return {
    model: (beta1m ? raw.replace(ONE_M_MODEL_MARKER_RE, '') : raw).trim(),
    beta1m
  }
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function stripTrailingSlash(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
}

/** 从 codex 的 TOML 配置文本里抽取字段（简单正则即可，不需要完整 TOML 解析） */
function matchTomlValue(configText, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm')
  const matched = pattern.exec(String(configText || ''))
  return matched ? matched[1] : ''
}

/**
 * Claude 类中转站：走 Anthropic 协议
 *
 * 模型来自 ANTHROPIC_DEFAULT_<TIER>_MODEL 这组映射。注意 cc-switch 的约定：
 * - _MODEL 的值可能带 `[1M]` 后缀，那是「启用 1M 上下文」的标记，不是模型名
 * - _MODEL_NAME 才是发给接口的真实模型 id
 */
function parseClaudeProvider(settings) {
  const env = settings?.env && typeof settings.env === 'object' ? settings.env : {}
  const baseUrl = stripTrailingSlash(env.ANTHROPIC_BASE_URL)
  // cc-switch 会根据凭据变量名选择认证头：
  // ANTHROPIC_AUTH_TOKEN -> Authorization: Bearer；ANTHROPIC_API_KEY -> x-api-key。
  // 测试请求必须复用这项选择，不能把同一 key 同时发到两个头里。
  const authToken = String(env.ANTHROPIC_AUTH_TOKEN || '').trim()
  const apiKeyValue = String(env.ANTHROPIC_API_KEY || '').trim()
  const apiKey = authToken || apiKeyValue
  const anthropicAuthType = authToken ? 'bearer' : 'x-api-key'

  // 收集所有 ANTHROPIC_DEFAULT_*_MODEL（同名的 _MODEL_NAME 不单独成条）
  const collected = new Map()
  for (const [key, value] of Object.entries(env)) {
    const matched = /^ANTHROPIC_DEFAULT_([A-Z0-9]+)_MODEL$/.exec(key)
    if (!matched) continue

    const raw = String(value || '').trim()
    if (!raw) continue

    const tier = matched[1]
    const rawParsed = splitOneMModelMarker(raw)
    // 优先用 _MODEL_NAME，退回到去掉 [1M] 后缀的 _MODEL。
    // 标识可能出现在任意一个字段中，任一字段带标识都代表启用 1M。
    const namedParsed = splitOneMModelMarker(env[`${key}_NAME`])
    const model = namedParsed.model || rawParsed.model
    const beta1m = rawParsed.beta1m || namedParsed.beta1m
    if (!model) continue

    // [1M] 只是同一上游模型的能力标记，不是另一个模型：同名模型合并为一条，
    // 任一 tier 标了 [1M] 即视为该模型启用 1M。
    const entryKey = model
    const existing = collected.get(entryKey)
    if (existing) {
      existing.tiers.push(tier)
      if (beta1m) existing.beta1m = true
    } else {
      collected.set(entryKey, { model, beta1m, tiers: [tier] })
    }
  }

  const models = [...collected.values()]
    .sort((a, b) => {
      const rank = (item) => {
        const index = CLAUDE_TIERS.indexOf(item.tiers[0])
        return index === -1 ? CLAUDE_TIERS.length : index
      }
      return rank(a) - rank(b)
    })
    .map((item) => ({
      key: item.beta1m ? `${item.model}|1m` : item.model,
      model: item.model,
      beta1m: item.beta1m,
      label: item.beta1m ? `${item.tiers.join(' / ')} · 1M` : item.tiers.join(' / ')
    }))

  const anthropicBeta = String(env.ANTHROPIC_BETA || env.ANTHROPIC_BETAS || '').trim()

  return { protocol: 'anthropic', baseUrl, apiKey, anthropicAuthType, anthropicBeta, models }
}

/**
 * Codex 类中转站：走 OpenAI 协议
 * base_url / wire_api 在 TOML 配置里，模型清单在 modelCatalog
 */
function parseCodexProvider(settings) {
  const auth = settings?.auth && typeof settings.auth === 'object' ? settings.auth : {}
  const apiKey = String(auth.OPENAI_API_KEY || auth.OPENAI_KEY || '').trim()
  const configText = typeof settings?.config === 'string' ? settings.config : ''

  const baseUrl = stripTrailingSlash(matchTomlValue(configText, 'base_url'))
  const wireApi = matchTomlValue(configText, 'wire_api') || 'chat'

  const catalog = Array.isArray(settings?.modelCatalog?.models) ? settings.modelCatalog.models : []
  const collected = new Map()
  for (const item of catalog) {
    const model = String(item?.model || '').trim()
    if (!model || collected.has(model)) continue
    collected.set(model, {
      key: model,
      model,
      label: String(item?.displayName || '').trim() || model
    })
  }

  // 目录为空时退回 TOML 里的默认 model
  if (collected.size === 0) {
    const fallback = matchTomlValue(configText, 'model')
    if (fallback) {
      collected.set(fallback, { key: fallback, model: fallback, label: `${fallback}（默认）` })
    }
  }

  return { protocol: 'openai', baseUrl, apiKey, wireApi, models: [...collected.values()] }
}

/**
 * Gemini 类中转站：走 Google Generative Language 协议
 */
function parseGeminiProvider(settings) {
  const env = settings?.env && typeof settings.env === 'object' ? settings.env : {}
  const config = settings?.config && typeof settings.config === 'object' ? settings.config : {}

  const baseUrl = stripTrailingSlash(
    env.GOOGLE_GEMINI_BASE_URL || env.GEMINI_BASE_URL || config.baseUrl || ''
  )
  const apiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || config.apiKey || '').trim()

  const rawModels = Array.isArray(config.models) ? config.models : []
  const models = rawModels
    .map((item) => String(typeof item === 'string' ? item : item?.model || '').trim())
    .filter(Boolean)
    .map((model) => ({ key: model, model, label: model }))

  if (models.length === 0 && (env.GEMINI_DEFAULT_MODEL || config.model)) {
    const model = String(env.GEMINI_DEFAULT_MODEL || config.model).trim()
    if (model) models.push({ key: model, model, label: `${model}（默认）` })
  }

  return { protocol: 'gemini', baseUrl, apiKey, models }
}

function parseProviderRow(row, endpointMap) {
  const appType = String(row.app_type || '')
  const settings = parseJson(row.settings_config, {})
  const meta = parseJson(row.meta, {})

  let parsed
  if (appType === 'claude' || appType === 'claude-desktop') {
    parsed = parseClaudeProvider(settings)
  } else if (appType === 'codex') {
    parsed = parseCodexProvider(settings)
  } else if (appType === 'gemini') {
    parsed = parseGeminiProvider(settings)
  } else {
    parsed = { protocol: 'unknown', baseUrl: '', apiKey: '', models: [] }
  }

  const endpoints = endpointMap.get(`${row.id}::${appType}`) || []
  // 某些 cc-switch 配置会预置 Anthropic beta；读取后与 1M beta 合并，
  // 不要在探测时把已有标识覆盖掉。
  const anthropicBeta = String(
    meta.anthropicBeta || meta.anthropic_beta || parsed.anthropicBeta || ''
  ).trim()
  // 有备用线路时，把主 baseUrl 也并进候选列表（去重）
  const allEndpoints = [...new Set([parsed.baseUrl, ...endpoints].filter(Boolean))]

  const issues = []
  if (!parsed.baseUrl) issues.push('未配置 baseUrl')
  if (!parsed.apiKey) issues.push('未配置 apiKey')

  return {
    id: row.id,
    appType,
    appLabel: APP_TYPE_LABELS[appType] || appType,
    name: String(row.name || '未命名'),
    websiteUrl: String(row.website_url || ''),
    isCurrent: Boolean(row.is_current),
    protocol: parsed.protocol,
    wireApi: parsed.wireApi || '',
    baseUrl: parsed.baseUrl,
    // cc-switch 可为某些兼容中转站指定客户端标识；探测时必须沿用。
    customUserAgent: String(meta.customUserAgent || '').trim(),
    anthropicAuthType: parsed.anthropicAuthType || '',
    anthropicBeta,
    apiKey: parsed.apiKey,
    // 只回传掩码，真实 key 不进渲染进程
    apiKeyMasked: maskKey(parsed.apiKey),
    endpoints: allEndpoints,
    models: parsed.models,
    issues,
    testable: issues.length === 0
  }
}

function maskKey(key) {
  const value = String(key || '')
  if (!value) return ''
  if (value.length <= 12) return `${value.slice(0, 3)}***`
  return `${value.slice(0, 6)}***${value.slice(-4)}`
}

/**
 * 读取所有中转站配置
 * @returns {Promise<{ok: boolean, dbPath?: string, providers?: Array, message?: string}>}
 */
async function loadProviders(options = {}) {
  const platform = options.platform || process.platform
  const pathApi = options.pathApi || (platform === 'win32' ? path.win32 : path)
  const candidates = Array.isArray(options.dbCandidates)
    ? uniquePaths(options.dbCandidates, pathApi)
    : databaseCandidatesFor({ ...options, platform, pathApi })
  const dbPath = findDatabasePath({ ...options, platform, pathApi, dbCandidates: candidates })
  if (!dbPath) {
    return {
      ok: false,
      message: `未找到 cc-switch 数据库，已尝试：\n${candidates.join('\n')}`
    }
  }

  const appFilter = SUPPORTED_APP_TYPES.map((type) => `'${type}'`).join(', ')
  let database
  try {
    database = await openDatabase(dbPath, options)
    const providerColumns = new Set(
      queryRows(database, 'PRAGMA table_info(providers);').map((column) => String(column.name))
    )
    const requiredColumns = ['id', 'app_type', 'name', 'settings_config']
    const missingColumns = requiredColumns.filter((column) => !providerColumns.has(column))
    if (missingColumns.length) {
      throw new Error(`cc-switch providers 表缺少字段：${missingColumns.join(', ')}`)
    }

    const optionalColumn = (name, fallback) =>
      providerColumns.has(name) ? name : `${fallback} AS ${name}`
    const rows = queryRows(
      database,
      `SELECT id, app_type, name,
              settings_config,
              ${optionalColumn('meta', "'{}'")},
              ${optionalColumn('website_url', "''")},
              ${optionalColumn('is_current', '0')},
              ${optionalColumn('sort_index', '0')}
         FROM providers
        WHERE app_type IN (${appFilter})
        ORDER BY app_type, sort_index, name;`
    )

    const endpointColumns = new Set(
      queryRows(database, 'PRAGMA table_info(provider_endpoints);').map((column) =>
        String(column.name)
      )
    )
    const endpointRows = ['provider_id', 'app_type', 'url'].every((column) =>
      endpointColumns.has(column)
    )
      ? queryRows(database, 'SELECT provider_id, app_type, url FROM provider_endpoints;')
      : []

    const endpointMap = new Map()
    for (const item of endpointRows) {
      const key = `${item.provider_id}::${item.app_type}`
      if (!endpointMap.has(key)) endpointMap.set(key, [])
      endpointMap.get(key).push(stripTrailingSlash(item.url))
    }

    const providers = rows.map((row) => parseProviderRow(row, endpointMap))
    return { ok: true, dbPath, providers }
  } catch (error) {
    return { ok: false, message: `读取 cc-switch 数据库失败：${error.message}` }
  } finally {
    database?.close()
  }
}

module.exports = {
  loadProviders,
  findDatabasePath,
  SUPPORTED_APP_TYPES,
  __testables: {
    ccSwitchStoreDirectories,
    activeWalPath,
    databaseCandidatesFor,
    nativeDatabaseClass,
    openDatabase,
    queryRows
  }
}
