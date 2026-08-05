const assert = require('node:assert/strict')
const test = require('node:test')
const { IPC_CHANNELS } = require('../src/shared/ipc-channels')
const {
  MAC_NOTIFICATION_SETTINGS_URL,
  buildMacDockMenuTemplate,
  createMacDesktopController,
  dockBadgeLabel
} = require('../src/main/mac-desktop-controller')

function createIpcMain() {
  const handlers = new Map()
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    removeHandler(channel) {
      handlers.delete(channel)
    }
  }
}

function menuItem(template, label) {
  return template.find((item) => item.label === label)
}

test('Dock 未读角标限制为 99+，无未读时清空', () => {
  assert.equal(dockBadgeLabel(0), '')
  assert.equal(dockBadgeLabel(-1), '')
  assert.equal(dockBadgeLabel(8), '8')
  assert.equal(dockBadgeLabel(100), '99+')
})

test('macOS Dock 菜单提供窗口、运维页面和通知设置入口', () => {
  const actions = []
  const template = buildMacDockMenuTemplate({
    showMainWindow: () => actions.push('show'),
    navigate: (route) => actions.push(route),
    openNotificationSettings: () => actions.push('notifications')
  })

  menuItem(template, '打开 Ops Desktop').click()
  menuItem(template, '运维仪表盘').click()
  menuItem(template, '运维中心').click()
  menuItem(template, '通知设置').click()
  assert.deepEqual(actions, ['show', '/ops-dashboard', '/ops-control-center', 'notifications'])
})

test('macOS 控制器同步 Dock 角标、登录启动和通知设置 IPC', async () => {
  const badges = []
  const externalUrls = []
  const sent = []
  const ipcMain = createIpcMain()
  let unread = 3
  let openAtLogin = false
  let eventListener = null
  let listenerStopped = false
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      send: (channel, payload) => sent.push([channel, payload])
    }
  }
  const app = {
    isPackaged: true,
    dock: {
      setBadge: (value) => badges.push(value),
      setMenu: (value) => {
        app.dock.menu = value
      }
    },
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (settings) => {
      openAtLogin = settings.openAtLogin
    }
  }
  const controller = createMacDesktopController({
    app,
    Menu: { buildFromTemplate: (template) => template },
    shell: {
      openExternal: async (url) => {
        externalUrls.push(url)
      }
    },
    ipcMain,
    userDataPath: '/tmp/ops-mac-desktop-test',
    getMainWindow: () => window,
    showMainWindow: () => sent.push(['show']),
    platform: 'darwin',
    summarizeEvents: () => ({ unread }),
    subscribeToEvents: (listener) => {
      eventListener = listener
      return () => {
        listenerStopped = true
      }
    }
  })

  const initial = controller.initialize()
  assert.equal(initial.supported, true)
  assert.equal(initial.unreadCount, 3)
  assert.equal(badges.at(-1), '3')
  assert.ok(app.dock.menu)

  unread = 120
  eventListener()
  assert.equal(badges.at(-1), '99+')

  menuItem(app.dock.menu, '运维仪表盘').click()
  menuItem(app.dock.menu, '通知设置').click()
  assert.deepEqual(sent.slice(-4), [
    ['show'],
    [IPC_CHANNELS.APP_NAVIGATE, '/ops-dashboard'],
    ['show'],
    [IPC_CHANNELS.OPS_NOTIFICATION_SETTINGS_OPEN, undefined]
  ])

  const getStatus = ipcMain.handlers.get(IPC_CHANNELS.DESKTOP_INTEGRATION_GET)
  assert.equal((await getStatus()).openAtLogin, false)

  const saveLoginItem = ipcMain.handlers.get(IPC_CHANNELS.DESKTOP_LOGIN_ITEM_SAVE)
  assert.deepEqual(await saveLoginItem({}, true), { ok: true, openAtLogin: true })
  assert.equal(openAtLogin, true)

  const openNotificationSettings = ipcMain.handlers.get(
    IPC_CHANNELS.DESKTOP_NOTIFICATION_SETTINGS_OPEN
  )
  assert.deepEqual(await openNotificationSettings(), { ok: true })
  assert.deepEqual(externalUrls, [MAC_NOTIFICATION_SETTINGS_URL])

  controller.destroy()
  assert.equal(listenerStopped, true)
  assert.equal(badges.at(-1), '')
})

test('非 macOS 平台保持 no-op，并明确返回不支持', async () => {
  const ipcMain = createIpcMain()
  let subscribed = false
  const controller = createMacDesktopController({
    app: { isPackaged: true },
    Menu: { buildFromTemplate: () => [] },
    shell: { openExternal: async () => {} },
    ipcMain,
    userDataPath: '/tmp/ops-other-desktop-test',
    getMainWindow: () => null,
    showMainWindow() {},
    platform: 'win32',
    subscribeToEvents: () => {
      subscribed = true
      return () => {}
    }
  })

  assert.equal(controller.initialize().supported, false)
  assert.equal(subscribed, false)
  const saveLoginItem = ipcMain.handlers.get(IPC_CHANNELS.DESKTOP_LOGIN_ITEM_SAVE)
  assert.equal((await saveLoginItem({}, true)).ok, false)
})
