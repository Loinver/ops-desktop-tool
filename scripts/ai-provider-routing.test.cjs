const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  DEFAULT_SETTINGS,
  executeProviderRoute,
  getRoutingState,
  isLoopbackUrl,
  normalizeSettings,
  orderProviderCandidates,
  recordProviderFailure,
  recordProviderSuccess,
  recordRouteHistory,
  saveProviderRoutingSettings,
  statePath
} = require('../src/main/utils/ai-provider-routing')

function candidate(providerId, baseUrl) {
  return { providerId, baseUrl }
}

function temporaryUserDataPath() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-provider-routing-'))
}

test('defaults and bounds normalize without accepting invalid settings', () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS)
  assert.deepEqual(
    normalizeSettings({ enabled: true, preferLocal: false, maxAttempts: 99, cooldownMinutes: 0 }),
    {
      enabled: true,
      preferLocal: false,
      maxAttempts: 3,
      cooldownMinutes: 1
    }
  )
  assert.deepEqual(normalizeSettings({ maxAttempts: '2.9', cooldownMinutes: '60.9' }), {
    enabled: false,
    preferLocal: true,
    maxAttempts: 2,
    cooldownMinutes: 60
  })
})

test('loopback classifier accepts only localhost forms and 127/8 or ::1', () => {
  assert.equal(isLoopbackUrl('http://localhost:8080'), true)
  assert.equal(isLoopbackUrl('http://api.localhost/v1'), true)
  assert.equal(isLoopbackUrl('http://127.0.0.1:8080'), true)
  assert.equal(isLoopbackUrl('http://127.255.255.255'), true)
  assert.equal(isLoopbackUrl('http://[::1]:8080'), true)
  assert.equal(isLoopbackUrl('https://localhost.example.com'), false)
  assert.equal(isLoopbackUrl('https://127.0.0.1.example.com'), false)
  assert.equal(isLoopbackUrl('https://10.0.0.1'), false)
  assert.equal(isLoopbackUrl('not a url'), false)
})

test('disabled routing selects requested or default provider, while enabled ordering is stable and local-first', () => {
  const candidates = [
    candidate('remote-first', 'https://remote.example.test'),
    candidate('local', 'http://localhost:4310'),
    candidate('remote-last', 'https://other.example.test')
  ]

  assert.deepEqual(
    orderProviderCandidates(candidates, {
      settings: { enabled: false },
      requestedProviderId: 'remote-last'
    }).map((item) => item.providerId),
    ['remote-last']
  )
  assert.deepEqual(
    orderProviderCandidates(candidates, {
      settings: { enabled: true, preferLocal: true, maxAttempts: 3 },
      now: 1000
    }).map((item) => item.providerId),
    ['local', 'remote-first', 'remote-last']
  )
  assert.deepEqual(
    orderProviderCandidates(
      [candidate('a', 'https://a.example.test'), candidate('b', 'https://b.example.test')],
      { settings: { enabled: true, preferLocal: false, maxAttempts: 3 }, now: 1000 }
    ).map((item) => item.providerId),
    ['a', 'b']
  )
})

test('cooling providers go last and earliest expiry is the recovery probe when all are cooling', () => {
  const userDataPath = temporaryUserDataPath()
  const candidates = [
    candidate('first', 'https://first.example.test'),
    candidate('second', 'https://second.example.test'),
    candidate('available', 'https://available.example.test')
  ]

  recordProviderFailure({
    userDataPath,
    providerId: 'first',
    now: 1000,
    settings: { cooldownMinutes: 5 }
  })
  recordProviderFailure({
    userDataPath,
    providerId: 'second',
    now: 2000,
    settings: { cooldownMinutes: 5 }
  })
  assert.deepEqual(
    orderProviderCandidates(candidates, {
      userDataPath,
      settings: { enabled: true, preferLocal: false, maxAttempts: 3 },
      now: 3000
    }).map((item) => item.providerId),
    ['available', 'first', 'second']
  )

  assert.deepEqual(
    orderProviderCandidates(candidates.slice(0, 2), {
      userDataPath,
      settings: { enabled: true, preferLocal: false, maxAttempts: 1 },
      now: 3000
    }).map((item) => item.providerId),
    ['first']
  )
})

test('direct success returns result, provider, route metadata, and clears health', async () => {
  const userDataPath = temporaryUserDataPath()
  recordProviderFailure({ userDataPath, providerId: 'direct', now: 1000 })
  const provider = candidate('direct', 'https://direct.example.test')
  const calls = []

  const routed = await executeProviderRoute({
    userDataPath,
    candidates: [provider],
    settings: { enabled: true },
    now: 2000,
    execute: async (value, context) => {
      calls.push({ value, context })
      return 'ok'
    }
  })

  assert.equal(routed.result, 'ok')
  assert.equal(routed.provider, provider)
  assert.deepEqual(routed.route.attemptedProviderIds, ['direct'])
  assert.deepEqual(calls[0].context, { attempt: 1, index: 0 })
  assert.deepEqual(getRoutingState(userDataPath).health.direct, {
    consecutiveFailures: 0,
    cooldownUntil: null,
    lastFailureAt: 1000,
    lastSuccessAt: 2000,
    lastErrorCode: null
  })
})

test('failure fails over, writes safe health, and records only safe route metadata', async () => {
  const userDataPath = temporaryUserDataPath()
  const calls = []
  const first = candidate('first', 'https://first.example.test')
  const second = candidate('second', 'https://second.example.test')

  const routed = await executeProviderRoute({
    userDataPath,
    candidates: [first, second],
    settings: { enabled: true, preferLocal: false, maxAttempts: 2 },
    now: 3000,
    execute: async (provider) => {
      calls.push(provider.providerId)
      if (provider.providerId === 'first') {
        throw Object.assign(new Error('raw secret prompt response sk-proj-abcdefghijklmnop'), {
          code: 'E_TEST_FAILURE'
        })
      }
      return { answer: 'success' }
    }
  })

  assert.deepEqual(calls, ['first', 'second'])
  assert.deepEqual(routed.route.attemptedProviderIds, ['first', 'second'])
  const state = getRoutingState(userDataPath)
  assert.equal(state.health.first.consecutiveFailures, 1)
  assert.equal(state.health.first.lastErrorCode, 'E_TEST_FAILURE')
  assert.equal(state.health.second.consecutiveFailures, 0)
  assert.equal(state.routeHistory.length, 2)
  assert.equal(state.routeHistory[0].errorCode, 'E_TEST_FAILURE')
  assert.equal(JSON.stringify(state).includes('raw secret'), false)
  assert.equal(JSON.stringify(state).includes('sk-proj-abcdefghijklmnop'), false)
})

test('cancellation, partial output, and disabled failover never switch providers', async (t) => {
  await t.test('cancellation', async () => {
    let calls = 0
    await assert.rejects(
      executeProviderRoute({
        candidates: [
          candidate('first', 'https://first.example.test'),
          candidate('second', 'https://second.example.test')
        ],
        settings: { enabled: true, preferLocal: false },
        execute: async () => {
          calls += 1
          throw Object.assign(new Error('cancelled'), { code: 'ECONNRESET' })
        },
        isCancelled: () => calls > 0
      }),
      (error) => error.code === 'AI_PROVIDER_ROUTE_CANCELLED'
    )
    assert.equal(calls, 1)
  })

  await t.test('partial stream output', async () => {
    let calls = 0
    await assert.rejects(
      executeProviderRoute({
        candidates: [
          candidate('first', 'https://first.example.test'),
          candidate('second', 'https://second.example.test')
        ],
        settings: { enabled: true, preferLocal: false },
        execute: async () => {
          calls += 1
          throw Object.assign(new Error('stream failed'), { code: 'ETIMEDOUT' })
        },
        hasPartialOutput: () => true
      }),
      (error) => error.code === 'AI_PROVIDER_ROUTE_PARTIAL_OUTPUT'
    )
    assert.equal(calls, 1)
  })

  await t.test('canFailover false', async () => {
    let calls = 0
    await assert.rejects(
      executeProviderRoute({
        candidates: [
          candidate('first', 'https://first.example.test'),
          candidate('second', 'https://second.example.test')
        ],
        settings: { enabled: true, preferLocal: false },
        execute: async () => {
          calls += 1
          throw Object.assign(new Error('provider failed'), { code: 'E_PROVIDER' })
        },
        canFailover: () => false
      }),
      (error) => error.code === 'AI_PROVIDER_ROUTE_FAILED'
    )
    assert.equal(calls, 1)
  })
})

test('route history keeps latest 50 records and ignores prompts, responses, keys, and raw errors', () => {
  const userDataPath = temporaryUserDataPath()
  for (let index = 0; index < 55; index += 1) {
    recordRouteHistory({
      userDataPath,
      providerId: 'safe-provider',
      outcome: 'failure',
      at: index,
      attempt: 1,
      index: 0,
      error: {
        code: 'E_SAFE',
        message: 'raw error with prompt response and sk-proj-abcdefghijklmnop'
      },
      prompt: 'do not persist this prompt',
      response: 'do not persist this response',
      apiKey: 'sk-proj-abcdefghijklmnop'
    })
  }

  const fileContents = fs.readFileSync(statePath(userDataPath), 'utf8')
  const state = JSON.parse(fileContents)
  assert.equal(state.version, 1)
  assert.equal(state.routeHistory.length, 50)
  assert.equal(state.routeHistory[0].at, 5)
  assert.equal(state.routeHistory.at(-1).at, 54)
  assert.equal(state.routeHistory[0].errorCode, 'E_SAFE')
  assert.doesNotMatch(fileContents, /do not persist this prompt/)
  assert.doesNotMatch(fileContents, /do not persist this response/)
  assert.doesNotMatch(fileContents, /sk-proj-abcdefghijklmnop/)
  assert.doesNotMatch(fileContents, /raw error/)
})

test('success and failure health updates use safe codes and the requested state path', () => {
  const userDataPath = temporaryUserDataPath()
  recordProviderFailure({
    userDataPath,
    providerId: 'provider',
    now: 10,
    error: { code: 'unsafe code with raw message', message: 'secret' }
  })
  let state = getRoutingState(userDataPath)
  assert.equal(state.health.provider.lastErrorCode, 'PROVIDER_ERROR')
  assert.equal(fs.existsSync(path.join(userDataPath, 'ai-provider-routing.json')), true)

  recordProviderSuccess({ userDataPath, providerId: 'provider', now: 20 })
  state = getRoutingState(userDataPath)
  assert.equal(state.health.provider.lastErrorCode, null)
  assert.equal(state.health.provider.cooldownUntil, null)
  assert.equal(state.health.provider.lastSuccessAt, 20)
  assert.doesNotMatch(fs.readFileSync(statePath(userDataPath), 'utf8'), /secret/)
})

test('saving user routing settings reports persistence failures instead of false success', () => {
  const root = temporaryUserDataPath()
  const blockedUserDataPath = path.join(root, 'not-a-directory')
  fs.writeFileSync(blockedUserDataPath, 'blocked')

  assert.throws(
    () => saveProviderRoutingSettings(blockedUserDataPath, { enabled: true }),
    (error) => error.code === 'AI_PROVIDER_ROUTING_SAVE_FAILED'
  )
})

test('in-flight route health updates preserve settings saved after the request started', async () => {
  const userDataPath = temporaryUserDataPath()
  saveProviderRoutingSettings(userDataPath, {
    enabled: true,
    preferLocal: false,
    maxAttempts: 2,
    cooldownMinutes: 5
  })

  let releaseRequest
  let markStarted
  const started = new Promise((resolve) => {
    markStarted = resolve
  })
  const blocked = new Promise((resolve) => {
    releaseRequest = resolve
  })
  const pending = executeProviderRoute({
    userDataPath,
    candidates: [candidate('slow-provider', 'https://slow.example.test')],
    requestedProviderId: 'slow-provider',
    settings: getRoutingState(userDataPath).settings,
    execute: async () => {
      markStarted()
      await blocked
      return 'ok'
    }
  })

  await started
  saveProviderRoutingSettings(userDataPath, {
    enabled: false,
    preferLocal: true,
    maxAttempts: 1,
    cooldownMinutes: 17
  })
  releaseRequest()
  await pending

  const state = getRoutingState(userDataPath)
  assert.deepEqual(state.settings, {
    enabled: false,
    preferLocal: true,
    maxAttempts: 1,
    cooldownMinutes: 17
  })
  assert.equal(state.health['slow-provider'].consecutiveFailures, 0)
  assert.equal(state.routeHistory.at(-1).providerId, 'slow-provider')
})
