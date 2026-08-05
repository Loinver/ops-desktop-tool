const assert = require('node:assert/strict')
const test = require('node:test')
const {
  OVERLAY_SIZE,
  createUnreadOverlayBitmap,
  createWindowsTaskbarController,
  normalizeUnreadSummary,
  shouldFlashForChange,
  unreadOverlayDescription
} = require('../src/main/windows-taskbar-controller')

function createWindow() {
  const listeners = new Map()
  return {
    destroyed: false,
    focused: false,
    overlays: [],
    flashes: [],
    isDestroyed() {
      return this.destroyed
    },
    isFocused() {
      return this.focused
    },
    setOverlayIcon(icon, description) {
      this.overlays.push({ icon, description })
    },
    flashFrame(value) {
      this.flashes.push(value)
    },
    on(event, listener) {
      listeners.set(event, listener)
    },
    emit(event) {
      listeners.get(event)?.()
    }
  }
}

function createNativeImage() {
  const calls = []
  return {
    calls,
    createFromBitmap(bitmap, options) {
      const image = { bitmap, options, isEmpty: () => false }
      calls.push(image)
      return image
    }
  }
}

test('Windows 任务栏未读 overlay 生成透明背景、白色描边和红色圆点', () => {
  const bitmap = createUnreadOverlayBitmap()
  assert.equal(bitmap.length, OVERLAY_SIZE * OVERLAY_SIZE * 4)
  assert.equal(bitmap[3], 0)

  const center = Math.floor(OVERLAY_SIZE / 2)
  const centerOffset = (center * OVERLAY_SIZE + center) * 4
  assert.deepEqual([...bitmap.subarray(centerOffset, centerOffset + 4)], [57, 69, 239, 255])

  const borderOffset = (center * OVERLAY_SIZE + 1) * 4
  assert.deepEqual([...bitmap.subarray(borderOffset, borderOffset + 4)], [255, 255, 255, 255])
})

test('Windows 任务栏显示未读状态，并仅对后台严重新告警闪烁', () => {
  const window = createWindow()
  const nativeImage = createNativeImage()
  let currentSummary = { unread: 3, unreadCritical: 1 }
  let eventListener = null
  let unsubscribed = 0
  const controller = createWindowsTaskbarController({
    nativeImage,
    userDataPath: 'C:\\Users\\tester\\AppData\\Roaming\\Ops Desktop',
    getWindow: () => window,
    platform: 'win32',
    summarizeEvents: () => currentSummary,
    subscribeToEvents(listener) {
      eventListener = listener
      return () => {
        unsubscribed += 1
      }
    }
  })

  assert.deepEqual(controller.initialize(), {
    supported: true,
    unread: 3,
    unreadCritical: 1
  })
  controller.attachWindow(window)
  assert.equal(nativeImage.calls.length, 1)
  assert.equal(window.overlays.at(-1).description, '3 条未读运维事件，其中 1 条严重告警')
  assert.deepEqual(window.flashes, [])

  eventListener({ kind: 'opened', item: { severity: 'warning' } })
  assert.deepEqual(window.flashes, [])

  eventListener({ kind: 'opened', item: { severity: 'critical' } })
  assert.deepEqual(window.flashes, [true])
  assert.equal(controller.status().flashing, true)

  window.focused = true
  window.emit('focus')
  assert.deepEqual(window.flashes, [true, false])
  assert.equal(controller.status().flashing, false)

  currentSummary = { unread: 0, unreadCritical: 0 }
  eventListener({ kind: 'read', item: { severity: 'critical' } })
  assert.deepEqual(window.overlays.at(-1), { icon: null, description: '' })

  controller.destroy()
  assert.equal(unsubscribed, 1)
})

test('Windows 任务栏未读辅助函数规范化计数和闪烁条件', () => {
  assert.deepEqual(normalizeUnreadSummary({ unread: 1.9, unreadCritical: -1 }), {
    unread: 1,
    unreadCritical: 0
  })
  assert.equal(unreadOverlayDescription(), '')
  assert.equal(unreadOverlayDescription({ unread: 2 }), '2 条未读运维事件')
  assert.equal(shouldFlashForChange({ kind: 'opened', item: { severity: 'critical' } }), true)
  assert.equal(shouldFlashForChange({ kind: 'recovered', item: { severity: 'critical' } }), false)
})

test('非 Windows 平台不注册任务栏监听', () => {
  let subscribed = false
  const controller = createWindowsTaskbarController({
    nativeImage: createNativeImage(),
    userDataPath: '/tmp/ops-taskbar',
    getWindow: () => createWindow(),
    platform: 'linux',
    subscribeToEvents() {
      subscribed = true
      return () => {}
    }
  })

  assert.deepEqual(controller.initialize(), {
    supported: false,
    unread: 0,
    unreadCritical: 0
  })
  assert.equal(subscribed, false)
})
