const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  assertTrustedIpcSender,
  installIpcHandleSecurity,
  isTrustedRendererUrl
} = require('../src/main/utils/ipc-security')

function trustedFixture(url = 'http://localhost:5173/#/ops-dashboard') {
  const mainFrame = { url }
  const webContents = {
    mainFrame,
    getURL: () => url,
    isDestroyed: () => false
  }
  const window = { webContents, isDestroyed: () => false }
  return {
    window,
    event: { sender: webContents, senderFrame: mainFrame }
  }
}

test('accepts only the configured development origin', () => {
  assert.equal(
    isTrustedRendererUrl('http://localhost:5173/#/ops-dashboard', {
      devServerUrl: 'http://localhost:5173'
    }),
    true
  )
  assert.equal(
    isTrustedRendererUrl('http://127.0.0.1:5173/#/ops-dashboard', {
      devServerUrl: 'http://localhost:5173'
    }),
    false
  )
  assert.equal(
    isTrustedRendererUrl('https://example.com/#/ops-dashboard', {
      devServerUrl: 'http://localhost:5173'
    }),
    false
  )
})

test('accepts only the packaged renderer entry file', () => {
  const entry = path.join(
    '/Applications',
    'Ops Desktop.app',
    'Contents',
    'Resources',
    'app.asar',
    'dist',
    'renderer',
    'index.html'
  )
  assert.equal(
    isTrustedRendererUrl(`${pathToFileURL(entry).toString()}#/ops-dashboard`, {
      isPackaged: true,
      rendererEntryPath: entry
    }),
    true
  )
  assert.equal(
    isTrustedRendererUrl(pathToFileURL(path.join(path.dirname(entry), 'other.html')).toString(), {
      isPackaged: true,
      rendererEntryPath: entry
    }),
    false
  )
})

test('rejects foreign webContents and subframes', () => {
  const { window, event } = trustedFixture()
  assert.equal(assertTrustedIpcSender(event, { getMainWindow: () => window }), true)
  assert.throws(
    () => assertTrustedIpcSender({ ...event, sender: {} }, { getMainWindow: () => window }),
    (error) => error.code === 'ERR_UNTRUSTED_IPC_SENDER'
  )
  assert.throws(
    () =>
      assertTrustedIpcSender(
        { ...event, senderFrame: { url: event.senderFrame.url } },
        { getMainWindow: () => window }
      ),
    (error) => error.code === 'ERR_UNTRUSTED_IPC_SENDER'
  )
})

test('wraps handlers with sender validation and correlated audit lifecycle', async () => {
  const handlers = new Map()
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    }
  }
  const { window, event } = trustedFixture()
  const starts = []
  const finishes = []
  const restore = installIpcHandleSecurity({
    ipcMain,
    getMainWindow: () => window,
    auditPolicies: {
      'danger:run': {
        action: 'danger.run',
        category: 'process',
        target: ([payload]) => ({ pid: payload.pid, password: payload.password })
      }
    },
    audit: {
      async start(payload) {
        starts.push(payload)
        return { requestId: 'request-1' }
      },
      async finish(context, payload) {
        finishes.push({ context, payload })
      }
    }
  })

  ipcMain.handle('danger:run', async (_event, payload) => ({ ok: true, pid: payload.pid }))
  const result = await handlers.get('danger:run')(event, { pid: 42, password: 'hidden' })
  assert.equal(result.ok, true)
  assert.equal(starts.length, 1)
  assert.deepEqual(starts[0].target, { pid: 42 })
  assert.equal(finishes[0].context.requestId, 'request-1')
  assert.equal(finishes[0].payload.status, 'succeeded')
  assert.equal(restore(), true)
})

test('records returned and thrown failures without replacing business errors', async () => {
  const handlers = new Map()
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) }
  const { window, event } = trustedFixture()
  const finishes = []
  installIpcHandleSecurity({
    ipcMain,
    getMainWindow: () => window,
    auditPolicies: {
      'danger:return': { action: 'return.fail' },
      'danger:throw': { action: 'throw.fail' }
    },
    audit: {
      start: async () => ({ requestId: 'request-2' }),
      finish: async (_context, payload) => finishes.push(payload)
    }
  })
  ipcMain.handle('danger:return', async () => ({ ok: false, error: 'not allowed' }))
  ipcMain.handle('danger:throw', async () => {
    const error = new Error('boom')
    error.code = 'E_BOOM'
    throw error
  })

  assert.equal((await handlers.get('danger:return')(event)).ok, false)
  await assert.rejects(handlers.get('danger:throw')(event), /boom/)
  assert.deepEqual(
    finishes.map((item) => [item.status, item.error, item.errorCode || '']),
    [
      ['failed', '操作返回失败', ''],
      ['failed', '操作执行失败', 'E_BOOM']
    ]
  )
  assert.equal(JSON.stringify(finishes).includes('not allowed'), false)
  assert.equal(JSON.stringify(finishes).includes('boom'), false)
})
