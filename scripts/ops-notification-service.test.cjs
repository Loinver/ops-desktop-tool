const assert = require('node:assert/strict')
const test = require('node:test')
const { IPC_CHANNELS } = require('../src/shared/ipc-channels')
const { __testables } = require('../src/main/ops-notification-service')

const { notificationFallbackRoute, revealMainWindow, sendEventToWindow } = __testables

function mockWindow({ loading = false } = {}) {
  const sent = []
  const listeners = new Map()
  let minimized = true
  let visible = false
  return {
    sent,
    listeners,
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore() {
      minimized = false
    },
    isVisible: () => visible,
    show() {
      visible = true
    },
    focus() {
      this.focused = true
    },
    webContents: {
      isDestroyed: () => false,
      isLoadingMainFrame: () => loading,
      once(event, listener) {
        listeners.set(event, listener)
      },
      send(channel, payload) {
        sent.push({ channel, payload })
      }
    }
  }
}

test('桌面通知恢复或重建主窗口后再聚焦', () => {
  const window = mockWindow()
  let showCalls = 0
  const result = revealMainWindow({
    showWindow() {
      showCalls += 1
    },
    getWindow: () => window
  })

  assert.equal(result, window)
  assert.equal(showCalls, 1)
  assert.equal(window.isMinimized(), false)
  assert.equal(window.isVisible(), true)
  assert.equal(window.focused, true)
})

test('桌面通知点击发送带缓冲的页面导航和事件详情消息', () => {
  const window = mockWindow({ loading: true })
  const item = { id: 'event 1', sourceId: 'tcp:3000' }

  assert.equal(sendEventToWindow(window, item), true)
  assert.deepEqual(window.sent, [])

  window.listeners.get('did-finish-load')()
  assert.deepEqual(window.sent, [
    {
      channel: IPC_CHANNELS.APP_NAVIGATE,
      payload: '/ops-control-center?event=event+1&sourceId=tcp%3A3000'
    },
    { channel: IPC_CHANNELS.OPS_NOTIFICATION_OPEN, payload: item }
  ])
})

test('桌面通知回退路由不携带空参数', () => {
  assert.equal(notificationFallbackRoute(), '/ops-control-center')
  assert.equal(
    notificationFallbackRoute({ id: 'event-2', relatedId: 'backup-1' }),
    '/ops-control-center?event=event-2&sourceId=backup-1'
  )
})
