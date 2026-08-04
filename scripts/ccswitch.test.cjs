const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const initSqlJs = require('sql.js')
const { loadProviders, __testables } = require('../src/main/utils/ccswitch')

let SQL

test.before(async () => {
  SQL = await initSqlJs({
    wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
  })
})

function createDatabase(sql) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-ccswitch-'))
  const dbPath = path.join(directory, 'cc-switch.db')
  const database = new SQL.Database()
  try {
    database.run(sql)
    fs.writeFileSync(dbPath, Buffer.from(database.export()))
  } finally {
    database.close()
  }
  return { directory, dbPath }
}

test('Windows 候选路径使用 APPDATA/LOCALAPPDATA，而不是依赖固定用户目录', () => {
  const candidates = __testables.databaseCandidatesFor({
    platform: 'win32',
    homeDir: 'D:\\Profiles\\alice',
    env: {
      APPDATA: 'R:\\Roaming',
      LOCALAPPDATA: 'D:\\Profiles\\alice\\Local'
    }
  })

  assert.deepEqual(candidates, [
    'D:\\Profiles\\alice\\.cc-switch\\cc-switch.db',
    'R:\\Roaming\\com.ccswitch.desktop\\cc-switch.db',
    'D:\\Profiles\\alice\\AppData\\Roaming\\com.ccswitch.desktop\\cc-switch.db',
    'D:\\Profiles\\alice\\Local\\com.ccswitch.desktop\\cc-switch.db'
  ])
})

test('会优先读取 CCSwitch app_paths.json 中配置的自定义数据库目录', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-ccswitch-paths-'))
  const appData = path.join(directory, 'app-data')
  const customConfig = path.join(directory, 'synced-ccswitch')
  const storeDirectory = path.join(appData, 'com.ccswitch.desktop')
  fs.mkdirSync(storeDirectory, { recursive: true })
  fs.writeFileSync(
    path.join(storeDirectory, 'app_paths.json'),
    JSON.stringify({ appConfigDir: customConfig })
  )

  const candidates = __testables.databaseCandidatesFor({
    platform: 'linux',
    homeDir: path.join(directory, 'home'),
    env: { XDG_DATA_HOME: appData }
  })

  assert.equal(candidates[0], path.join(customConfig, 'cc-switch.db'))
})

test('不依赖外部 sqlite3 命令即可读取 CCSwitch Provider 和备用端点', async () => {
  const settings = JSON.stringify({
    auth: { OPENAI_API_KEY: 'sk-windows-test' },
    config:
      'base_url = "https://gateway.example.com/v1"\nwire_api = "responses"\nmodel = "gpt-test"',
    modelCatalog: { models: [{ model: 'gpt-test', displayName: 'GPT Test' }] }
  }).replaceAll("'", "''")
  const { directory, dbPath } = createDatabase(`
    CREATE TABLE providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      website_url TEXT,
      sort_index INTEGER,
      meta TEXT NOT NULL DEFAULT '{}',
      is_current BOOLEAN NOT NULL DEFAULT 0,
      PRIMARY KEY (id, app_type)
    );
    CREATE TABLE provider_endpoints (
      provider_id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      url TEXT NOT NULL
    );
    INSERT INTO providers
      (id, app_type, name, settings_config, website_url, sort_index, meta, is_current)
    VALUES
      ('provider-1', 'codex', 'Windows Gateway', '${settings}', 'https://example.com', 1, '{}', 1);
    INSERT INTO provider_endpoints (provider_id, app_type, url)
    VALUES ('provider-1', 'codex', 'https://backup.example.com/v1/');
  `)

  try {
    const result = await loadProviders({ dbCandidates: [dbPath] })
    assert.equal(result.ok, true, result.message)
    assert.equal(result.providers.length, 1)
    assert.deepEqual(
      {
        id: result.providers[0].id,
        protocol: result.providers[0].protocol,
        wireApi: result.providers[0].wireApi,
        baseUrl: result.providers[0].baseUrl,
        apiKey: result.providers[0].apiKey,
        testable: result.providers[0].testable,
        models: result.providers[0].models,
        endpoints: result.providers[0].endpoints
      },
      {
        id: 'provider-1',
        protocol: 'openai',
        wireApi: 'responses',
        baseUrl: 'https://gateway.example.com/v1',
        apiKey: 'sk-windows-test',
        testable: true,
        models: [{ key: 'gpt-test', model: 'gpt-test', label: 'GPT Test' }],
        endpoints: ['https://gateway.example.com/v1', 'https://backup.example.com/v1']
      }
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('旧版数据库缺少 provider_endpoints 和可选字段时仍可加载', async () => {
  const settings = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: 'https://anthropic.example.com',
      ANTHROPIC_AUTH_TOKEN: 'token-test',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-test'
    }
  }).replaceAll("'", "''")
  const { directory, dbPath } = createDatabase(`
    CREATE TABLE providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      PRIMARY KEY (id, app_type)
    );
    INSERT INTO providers (id, app_type, name, settings_config)
    VALUES ('legacy-1', 'claude', 'Legacy', '${settings}');
  `)

  try {
    const result = await loadProviders({ dbCandidates: [dbPath] })
    assert.equal(result.ok, true, result.message)
    assert.equal(result.providers[0].testable, true)
    assert.deepEqual(result.providers[0].endpoints, ['https://anthropic.example.com'])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
