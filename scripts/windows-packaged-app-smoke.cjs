const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const initSqlJs = require('sql.js')

const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const packageJson = require(path.join(root, 'package.json'))
const productName = packageJson.build?.productName || packageJson.productName || packageJson.name
const timeoutMs = 45_000
const ccSwitchFixtureArgument = '--ccswitch-fixture'
const ccSwitchAppId = 'com.ccswitch.desktop'
const fixtureProvider = Object.freeze({
  providerId: 'windows-smoke-provider',
  name: 'Windows Smoke Gateway',
  appType: 'codex',
  protocol: 'openai',
  baseUrl: 'https://windows-smoke.example.com/v1',
  endpoint: 'https://windows-smoke-backup.example.com/v1',
  wireApi: 'responses',
  model: 'gpt-windows-smoke',
  secret: 'sk-windows-smoke-secret'
})

function requestedArchitecture() {
  const argument = process.argv.find((value) => value.startsWith('--arch='))
  return argument ? argument.slice('--arch='.length).toLowerCase() : 'x64'
}

function shouldCreateCcSwitchFixture(argv = process.argv) {
  return argv.includes(ccSwitchFixtureArgument)
}

function unpackedDirectoryName(architecture) {
  if (!architecture || architecture === 'x64') return 'win-unpacked'
  return `win-${architecture}-unpacked`
}

function packagedExecutablePath(architecture) {
  return path.join(releaseDir, unpackedDirectoryName(architecture), `${productName}.exe`)
}

async function createCcSwitchFixture(profileRoot) {
  const appDataPath = path.join(profileRoot, 'AppData', 'Roaming')
  const localAppDataPath = path.join(profileRoot, 'AppData', 'Local')
  const databaseDirectory = path.join(appDataPath, ccSwitchAppId)
  const dbPath = path.join(databaseDirectory, 'cc-switch.db')
  fs.mkdirSync(databaseDirectory, { recursive: true })
  fs.mkdirSync(localAppDataPath, { recursive: true })

  const SQL = await initSqlJs({
    wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
  })
  const database = new SQL.Database()
  const settings = JSON.stringify({
    auth: { OPENAI_API_KEY: fixtureProvider.secret },
    config: [
      `base_url = "${fixtureProvider.baseUrl}"`,
      `wire_api = "${fixtureProvider.wireApi}"`,
      `model = "${fixtureProvider.model}"`
    ].join('\n'),
    modelCatalog: {
      models: [{ model: fixtureProvider.model, displayName: 'GPT Windows Smoke' }]
    }
  })

  try {
    database.run(`
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
    `)
    database.run(
      `INSERT INTO providers
        (id, app_type, name, settings_config, website_url, sort_index, meta, is_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        fixtureProvider.providerId,
        fixtureProvider.appType,
        fixtureProvider.name,
        settings,
        'https://windows-smoke.example.com',
        1,
        '{}',
        1
      ]
    )
    database.run(`INSERT INTO provider_endpoints (provider_id, app_type, url) VALUES (?, ?, ?);`, [
      fixtureProvider.providerId,
      fixtureProvider.appType,
      `${fixtureProvider.endpoint}/`
    ])
    fs.writeFileSync(dbPath, Buffer.from(database.export()))
  } finally {
    database.close()
  }

  return {
    appDataPath,
    localAppDataPath,
    profileRoot,
    expectation: { ...fixtureProvider, dbPath }
  }
}

async function run() {
  if (process.platform !== 'win32') {
    throw new Error('Windows packaged app smoke test must run on Windows')
  }

  const architecture = requestedArchitecture()
  const executablePath = packagedExecutablePath(architecture)
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged Windows executable was not found: ${executablePath}`)
  }

  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-desktop-smoke-'))
  const smokeUserDataPath = path.join(smokeRoot, 'ops-user-data')
  let output = ''
  let timedOut = false

  try {
    const fixture = shouldCreateCcSwitchFixture()
      ? await createCcSwitchFixture(path.join(smokeRoot, 'windows-profile'))
      : null
    const childEnvironment = {
      ...process.env,
      OPS_DESKTOP_SMOKE_TEST: '1'
    }
    if (fixture) {
      Object.assign(childEnvironment, {
        USERPROFILE: fixture.profileRoot,
        APPDATA: fixture.appDataPath,
        LOCALAPPDATA: fixture.localAppDataPath,
        OPS_DESKTOP_SMOKE_CCSWITCH_EXPECTED: JSON.stringify(fixture.expectation)
      })
    }

    console.log(`Launching packaged app smoke test: ${executablePath}`)
    const child = spawn(executablePath, ['--smoke-test', `--user-data-dir=${smokeUserDataPath}`], {
      cwd: root,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false
    })

    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })

    const result = await new Promise((resolve) => {
      let settled = false
      let timer = null
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, timeoutMs)

      child.once('error', (error) => finish({ error }))
      child.once('exit', (code, signal) => finish({ code, signal }))
    })

    if (result.error) throw new Error(`Failed to launch packaged app: ${result.error.message}`)
    if (timedOut) {
      throw new Error(`Packaged app did not finish its smoke test within ${timeoutMs}ms`)
    }
    if (result.code !== 0) {
      throw new Error(
        `Packaged app smoke test failed (code=${result.code}, signal=${result.signal || 'none'})`
      )
    }

    console.log(
      fixture
        ? 'Packaged app loaded its renderer and discovered the CC Switch fixture successfully'
        : 'Packaged app loaded its renderer and exited successfully'
    )
  } catch (error) {
    if (output.trim()) console.error(output.trim())
    throw error
  } finally {
    try {
      fs.rmSync(smokeRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      })
    } catch (error) {
      console.warn(`Failed to remove smoke-test data directory: ${error.message}`)
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = {
  createCcSwitchFixture,
  fixtureProvider,
  packagedExecutablePath,
  requestedArchitecture,
  run,
  shouldCreateCcSwitchFixture,
  unpackedDirectoryName
}
