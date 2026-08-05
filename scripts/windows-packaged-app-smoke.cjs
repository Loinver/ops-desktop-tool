const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const root = path.resolve(__dirname, '..')
const releaseDir = path.join(root, 'release')
const packageJson = require(path.join(root, 'package.json'))
const productName = packageJson.build?.productName || packageJson.productName || packageJson.name
const timeoutMs = 45_000
const ccSwitchFixtureArgument = '--ccswitch-fixture'
const ccSwitchAppId = 'com.ccswitch.desktop'
const smokeResultFileName = 'smoke-result.json'
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

function readPackagedSmokeResult(resultPath) {
  if (!fs.existsSync(resultPath)) {
    throw new Error(`Packaged app did not write its smoke-test result: ${resultPath}`)
  }

  try {
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    if (!result || typeof result !== 'object') throw new Error('result must be an object')
    return result
  } catch (error) {
    throw new Error(`Failed to parse packaged app smoke-test result: ${error.message}`, {
      cause: error
    })
  }
}

function assertWindowsPackagedSmokeResult(result, { expectCcSwitch = false } = {}) {
  if (result?.ok !== true) {
    throw new Error(
      `Packaged app reported a failed smoke test: ${result?.message || 'unknown error'}`
    )
  }
  if (result.windowsTaskbarSupported !== true) {
    throw new Error('Packaged app did not confirm Windows taskbar support')
  }
  if (result.windowsTaskbarOverlayReady !== true) {
    throw new Error('Packaged app did not create and apply a Windows taskbar overlay icon')
  }
  if (expectCcSwitch && result.ccSwitchChecked !== true) {
    throw new Error('Packaged app did not confirm CC Switch discovery')
  }
  if (expectCcSwitch && result.providerId !== fixtureProvider.providerId) {
    throw new Error(
      `Packaged app returned an unexpected CC Switch provider: ${result.providerId || 'missing'}`
    )
  }
  return result
}

async function createCcSwitchFixture(profileRoot) {
  const appDataPath = path.join(profileRoot, 'AppData', 'Roaming')
  const localAppDataPath = path.join(profileRoot, 'AppData', 'Local')
  const databaseDirectory = path.join(appDataPath, ccSwitchAppId)
  const dbPath = path.join(databaseDirectory, 'cc-switch.db')
  fs.mkdirSync(databaseDirectory, { recursive: true })
  fs.mkdirSync(localAppDataPath, { recursive: true })

  const database = new DatabaseSync(dbPath)
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

  database.prepare('PRAGMA journal_mode=WAL;').get()
  database.exec(`
    PRAGMA wal_autocheckpoint=0;
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
  database
    .prepare(
      `INSERT INTO providers
        (id, app_type, name, settings_config, website_url, sort_index, meta, is_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
    )
    .run(
      fixtureProvider.providerId,
      fixtureProvider.appType,
      fixtureProvider.name,
      settings,
      'https://windows-smoke.example.com',
      1,
      '{}',
      1
    )
  database
    .prepare('INSERT INTO provider_endpoints (provider_id, app_type, url) VALUES (?, ?, ?);')
    .run(fixtureProvider.providerId, fixtureProvider.appType, `${fixtureProvider.endpoint}/`)

  let closed = false
  return {
    appDataPath,
    localAppDataPath,
    profileRoot,
    expectation: { ...fixtureProvider, dbPath },
    close: () => {
      if (closed) return
      closed = true
      database.close()
    }
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
  const smokeResultPath = path.join(smokeRoot, smokeResultFileName)
  let output = ''
  let timedOut = false
  let fixture = null

  try {
    fixture = shouldCreateCcSwitchFixture()
      ? await createCcSwitchFixture(path.join(smokeRoot, 'windows-profile'))
      : null
    const childEnvironment = {
      ...process.env,
      OPS_DESKTOP_SMOKE_TEST: '1',
      OPS_DESKTOP_SMOKE_RESULT_PATH: smokeResultPath
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
      const reportedFailure = fs.existsSync(smokeResultPath)
        ? readPackagedSmokeResult(smokeResultPath).message
        : ''
      throw new Error(
        `Packaged app smoke test failed (code=${result.code}, signal=${result.signal || 'none'})${
          reportedFailure ? `: ${reportedFailure}` : ''
        }`
      )
    }

    const smokeResult = assertWindowsPackagedSmokeResult(readPackagedSmokeResult(smokeResultPath), {
      expectCcSwitch: Boolean(fixture)
    })

    console.log(
      fixture
        ? 'Packaged app loaded its renderer and discovered the CC Switch fixture successfully'
        : 'Packaged app loaded its renderer and exited successfully'
    )
    console.log(`Packaged smoke result: ${JSON.stringify(smokeResult)}`)
  } catch (error) {
    if (output.trim()) console.error(output.trim())
    throw error
  } finally {
    fixture?.close()
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
  assertWindowsPackagedSmokeResult,
  createCcSwitchFixture,
  fixtureProvider,
  packagedExecutablePath,
  readPackagedSmokeResult,
  requestedArchitecture,
  run,
  shouldCreateCcSwitchFixture,
  unpackedDirectoryName
}
