const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  createWindowsTrayController,
  loadDesktopBehaviorSettings,
  normalizeDesktopBehaviorSettings
} = require('../src/main/windows-tray-controller')

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-windows-tray-'))
}

class MockTray {
  constructor(icon) {
    this.icon = icon
    this.listeners = new Map()
    this.destroyed = false
  }

  setToolTip(value) {
    this.tooltip = value
  }

  setContextMenu(value) {
    this.menu = value
  }

  on(event, listener) {
    this.listeners.set(event, listener)
  }

  destroy() {
    this.destroyed = true
  }
}

const MockMenu = {
  buildFromTemplate(template) {
    return template
  }
}

function menuItem(tray, label) {
  return tray.menu.find((item) => item.label === label || item.label?.startsWith(label))
}

test('Windows 托盘默认保持后台运行，并持久化关闭窗口行为', () => {
  const root = tempDir()
  let tray
  let shown = 0
  const app = {
    isPackaged: true,
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings() {},
    quit() {}
  }

  const controller = createWindowsTrayController({
    app,
    Tray: class extends MockTray {
      constructor(icon) {
        super(icon)
        tray = this
      }
    },
    Menu: MockMenu,
    icon: { id: 'icon' },
    userDataPath: root,
    showWindow: () => {
      shown += 1
    }
  })

  assert.equal(controller.shouldHideOnClose(), true)
  assert.equal(controller.shouldKeepAlive(), true)
  assert.equal(tray.tooltip, 'Ops Desktop')

  tray.listeners.get('click')()
  assert.equal(shown, 1)

  const closeToTray = menuItem(tray, '关闭窗口时最小化到托盘')
  closeToTray.click({ checked: false })
  assert.equal(controller.shouldHideOnClose(), false)
  assert.deepEqual(loadDesktopBehaviorSettings(root), { closeToTray: false })

  controller.destroy()
  assert.equal(tray.destroyed, true)
})

test('Windows 托盘使用隐藏启动参数配置开机启动，并支持明确退出', () => {
  const root = tempDir()
  let tray
  let loginSettings = null
  let quitCount = 0
  const app = {
    isPackaged: true,
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings(value) {
      loginSettings = value
    },
    quit() {
      quitCount += 1
    }
  }

  const controller = createWindowsTrayController({
    app,
    Tray: class extends MockTray {
      constructor(icon) {
        super(icon)
        tray = this
      }
    },
    Menu: MockMenu,
    icon: { id: 'icon' },
    userDataPath: root,
    showWindow() {}
  })

  menuItem(tray, '开机自动启动').click({ checked: true })
  assert.equal(loginSettings.openAtLogin, true)
  assert.equal(loginSettings.path, process.execPath)
  assert.deepEqual(loginSettings.args, ['--hidden'])

  app.getLoginItemSettings = () => ({ openAtLogin: true })
  controller.refresh()
  assert.equal(menuItem(tray, '开机自动启动').checked, true)

  menuItem(tray, '退出应用').click()
  assert.equal(quitCount, 1)
  assert.equal(controller.shouldKeepAlive(), false)
})

test('桌面运行设置只接受明确的 false 关闭托盘模式', () => {
  assert.deepEqual(normalizeDesktopBehaviorSettings(), { closeToTray: true })
  assert.deepEqual(normalizeDesktopBehaviorSettings({ closeToTray: false }), {
    closeToTray: false
  })
  assert.deepEqual(normalizeDesktopBehaviorSettings({ closeToTray: 'false' }), {
    closeToTray: true
  })
})
