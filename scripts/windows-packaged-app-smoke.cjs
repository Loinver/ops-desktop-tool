const fs = require('node:fs')
const http = require('node:http')
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
const modelTestReply = 'windows-smoke-model-available'
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

function assertWindowsPackagedSmokeResult(
  result,
  { expectCcSwitch = false, expectModelTest = false, expectModelMonitor = false } = {}
) {
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
  if (result.windowsNotificationSupported !== true) {
    throw new Error('Packaged app did not confirm Windows notification support')
  }
  if (result.windowsNotificationReady !== true) {
    throw new Error('Packaged app did not create and show a Windows notification')
  }
  if (expectCcSwitch && result.ccSwitchChecked !== true) {
    throw new Error('Packaged app did not confirm CC Switch discovery')
  }
  if (expectCcSwitch && result.providerId !== fixtureProvider.providerId) {
    throw new Error(
      `Packaged app returned an unexpected CC Switch provider: ${result.providerId || 'missing'}`
    )
  }
  if (expectModelTest && result.modelTestChecked !== true) {
    throw new Error('Packaged app did not confirm model availability testing')
  }
  if (expectModelTest && result.modelTestProviderId !== fixtureProvider.providerId) {
    throw new Error(
      `Packaged app returned an unexpected model-test provider: ${result.modelTestProviderId || 'missing'}`
    )
  }
  if (expectModelMonitor && result.modelMonitorChecked !== true) {
    throw new Error('Packaged app did not confirm model monitoring')
  }
  if (expectModelMonitor && result.modelMonitorProviderId !== fixtureProvider.providerId) {
    throw new Error(
      `Packaged app returned an unexpected model-monitor provider: ${result.modelMonitorProviderId || 'missing'}`
    )
  }
  return result
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.once('end', () => resolve(body))
    request.once('error', reject)
  })
}

async function createModelAvailabilityFixture() {
  const requests = []
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'not found' } }))
        return
      }

      const body = JSON.parse((await readRequestBody(request)) || '{}')
      if (request.headers.authorization !== `Bearer ${fixtureProvider.secret}`) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'unauthorized' } }))
        return
      }
      if (body.model !== fixtureProvider.model) {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'unexpected model' } }))
        return
      }

      requests.push({ method: request.method, url: request.url, body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          output: [{ content: [{ type: 'output_text', text: modelTestReply }] }]
        })
      )
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: error.message } }))
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Model availability fixture did not receive a TCP port')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

async function createCcSwitchFixture(profileRoot, { baseUrl, endpoint, modelTest } = {}) {
  const provider = {
    ...fixtureProvider,
    baseUrl: baseUrl || fixtureProvider.baseUrl,
    endpoint: endpoint || baseUrl || fixtureProvider.endpoint
  }
  const appDataPath = path.join(profileRoot, 'AppData', 'Roaming')
  const localAppDataPath = path.join(profileRoot, 'AppData', 'Local')
  const databaseDirectory = path.join(appDataPath, ccSwitchAppId)
  const dbPath = path.join(databaseDirectory, 'cc-switch.db')
  fs.mkdirSync(databaseDirectory, { recursive: true })
  fs.mkdirSync(localAppDataPath, { recursive: true })

  const database = new DatabaseSync(dbPath)
  const settings = JSON.stringify({
    auth: { OPENAI_API_KEY: provider.secret },
    config: [
      `base_url = "${provider.baseUrl}"`,
      `wire_api = "${provider.wireApi}"`,
      `model = "${provider.model}"`
    ].join('\n'),
    modelCatalog: {
      models: [{ model: provider.model, displayName: 'GPT Windows Smoke' }]
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
      provider.providerId,
      provider.appType,
      provider.name,
      settings,
      'https://windows-smoke.example.com',
      1,
      '{}',
      1
    )
  database
    .prepare('INSERT INTO provider_endpoints (provider_id, app_type, url) VALUES (?, ?, ?);')
    .run(provider.providerId, provider.appType, `${provider.endpoint}/`)

  let closed = false
  return {
    appDataPath,
    localAppDataPath,
    profileRoot,
    expectation: { ...provider, dbPath },
    modelTestExpectation: modelTest
      ? {
          providerId: provider.providerId,
          model: provider.model,
          baseUrl: provider.baseUrl,
          endpoint: provider.baseUrl,
          httpStatus: 200,
          reply: modelTest.reply || modelTestReply
        }
      : null,
    modelMonitorExpectation: modelTest
      ? {
          providerId: provider.providerId,
          providerName: provider.name,
          appType: provider.appType,
          model: provider.model,
          // 巡检已由本地服务收到的第二个请求验证；不再耦合渲染层的端点展示字符串。
          httpStatus: 200
        }
      : null,
    close: () => {
      if (closed) return
      closed = true
      database.close()
    }
  }
}

async function runPackagedExecutableSmoke({ executablePath, smokeRoot, fixture = null }) {
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged Windows executable was not found: ${executablePath}`)
  }
  fs.mkdirSync(smokeRoot, { recursive: true })

  const smokeUserDataPath = path.join(smokeRoot, 'ops-user-data')
  const smokeResultPath = path.join(smokeRoot, smokeResultFileName)
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
    if (fixture.modelTestExpectation) {
      childEnvironment.OPS_DESKTOP_SMOKE_MODEL_TEST_EXPECTED = JSON.stringify(
        fixture.modelTestExpectation
      )
    }
    if (fixture.modelMonitorExpectation) {
      childEnvironment.OPS_DESKTOP_SMOKE_MODEL_MONITOR_EXPECTED = JSON.stringify(
        fixture.modelMonitorExpectation
      )
    }
  }

  let output = ''
  let timedOut = false
  try {
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
      expectCcSwitch: Boolean(fixture),
      expectModelTest: Boolean(fixture?.modelTestExpectation),
      expectModelMonitor: Boolean(fixture?.modelMonitorExpectation)
    })
    console.log(`Packaged smoke result: ${JSON.stringify(smokeResult)}`)
    return smokeResult
  } catch (error) {
    if (output.trim()) console.error(output.trim())
    throw error
  }
}

async function run() {
  if (process.platform !== 'win32') {
    throw new Error('Windows packaged app smoke test must run on Windows')
  }

  const architecture = requestedArchitecture()
  const executablePath = packagedExecutablePath(architecture)

  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-desktop-smoke-'))
  let fixture = null
  let modelFixture = null

  try {
    if (shouldCreateCcSwitchFixture()) {
      modelFixture = await createModelAvailabilityFixture()
      fixture = await createCcSwitchFixture(path.join(smokeRoot, 'windows-profile'), {
        baseUrl: modelFixture.baseUrl,
        endpoint: modelFixture.baseUrl,
        modelTest: { reply: modelTestReply }
      })
    }
    await runPackagedExecutableSmoke({
      executablePath,
      smokeRoot: path.join(smokeRoot, 'app-run'),
      fixture
    })
    if (modelFixture && modelFixture.requests.length < 2) {
      throw new Error(
        'Packaged app did not complete both model test and monitoring requests to the local fixture'
      )
    }

    console.log(
      fixture
        ? 'Packaged app loaded its renderer, discovered CC Switch, and completed model availability testing'
        : 'Packaged app loaded its renderer and exited successfully'
    )
  } finally {
    try {
      fixture?.close()
    } catch (error) {
      console.warn(`Failed to close CC Switch fixture: ${error.message}`)
    }
    try {
      await modelFixture?.close()
    } catch (error) {
      console.warn(`Failed to close model availability fixture: ${error.message}`)
    }
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
  createModelAvailabilityFixture,
  fixtureProvider,
  modelTestReply,
  packagedExecutablePath,
  readPackagedSmokeResult,
  requestedArchitecture,
  runPackagedExecutableSmoke,
  run,
  shouldCreateCcSwitchFixture,
  unpackedDirectoryName
}
