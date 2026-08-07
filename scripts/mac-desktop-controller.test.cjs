const assert = require('node:assert/strict')
const test = require('node:test')
const { IPC_CHANNELS } = require('../src/shared/ipc-channels')
const {
  MAC_NOTIFICATION_SETTINGS_URL,
  WINDOWS_NOTIFICATION_SETTINGS_URL,
  buildMacDockMenuTemplate,
  buildMacStatusBarMenuTemplate,
  createMacDesktopController,
  dockBadgeLabel,
  statusBarUnreadLabel
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

test('macOS 状态栏菜单提供未读事件、页面入口和显式退出', () => {
  const actions = []
  const template = buildMacStatusBarMenuTemplate({
    unreadCount: 108,
    showMainWindow: () => actions.push('show'),
    navigate: (route) => actions.push(route),
    openNotificationSettings: () => actions.push('notifications'),
    quit: () => actions.push('quit')
  })

  assert.equal(statusBarUnreadLabel(0), '查看运维事件')
  assert.equal(statusBarUnreadLabel(108), '查看 99+ 条未读运维事件')
  menuItem(template, '打开 Ops Desktop').click()
  menuItem(template, '查看 99+ 条未读运维事件').click()
  menuItem(template, '运维仪表盘').click()
  menuItem(template, '通知设置').click()
  menuItem(template, '退出应用').click()
  assert.deepEqual(actions, [
    'show',
    '/ops-control-center',
    '/ops-dashboard',
    'notifications',
    'quit'
  ])
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
  let statusBarItem = null
  class FakeTray {
    constructor(icon) {
      this.icon = icon
      this.listeners = new Map()
      statusBarItem = this
    }
    on(event, listener) {
      this.listeners.set(event, listener)
    }
    setContextMenu(menu) {
      this.menu = menu
    }
    setToolTip(value) {
      this.tooltip = value
    }
    destroy() {
      this.destroyed = true
    }
  }
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
    Tray: FakeTray,
    statusBarIcon: { template: true },
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
  assert.equal(initial.traySupported, true)
  assert.equal(badges.at(-1), '3')
  assert.ok(app.dock.menu)
  assert.equal(statusBarItem.tooltip, 'Ops Desktop · 3 条未读运维事件')
  assert.ok(statusBarItem.menu)

  unread = 120
  eventListener()
  assert.equal(badges.at(-1), '99+')
  assert.equal(statusBarItem.tooltip, 'Ops Desktop · 120 条未读运维事件')
  assert.equal(
    menuItem(statusBarItem.menu, '查看 99+ 条未读运维事件').label,
    '查看 99+ 条未读运维事件'
  )

  statusBarItem.listeners.get('click')()
  assert.deepEqual(sent.at(-1), ['show'])

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
  assert.equal(statusBarItem.destroyed, true)
})

test('macOS 最后窗口关闭后可从状态栏重建窗口并显式退出', () => {
  const sent = []
  let currentWindow = null
  let createdWindowCount = 0
  let quitCount = 0
  let listenerStopped = false
  let statusBarItem = null

  class FakeTray {
    constructor() {
      this.listeners = new Map()
      statusBarItem = this
    }
    on(event, listener) {
      this.listeners.set(event, listener)
    }
    setContextMenu(menu) {
      this.menu = menu
    }
    setToolTip() {}
    destroy() {
      this.destroyed = true
    }
  }

  function createWindow() {
    createdWindowCount += 1
    return {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        isLoadingMainFrame: () => false,
        send: (channel, payload) => sent.push([channel, payload])
      }
    }
  }

  const controller = createMacDesktopController({
    app: {
      isPackaged: true,
      quit: () => {
        quitCount += 1
      },
      dock: { setBadge() {}, setMenu() {} },
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings() {}
    },
    Menu: { buildFromTemplate: (template) => template },
    Tray: FakeTray,
    statusBarIcon: { template: true },
    shell: { openExternal: async () => {} },
    ipcMain: createIpcMain(),
    userDataPath: '/tmp/ops-mac-status-lifecycle-test',
    getMainWindow: () => currentWindow,
    showMainWindow: () => {
      if (!currentWindow) currentWindow = createWindow()
      return currentWindow
    },
    platform: 'darwin',
    summarizeEvents: () => ({ unread: 0 }),
    subscribeToEvents: () => () => {
      listenerStopped = true
    }
  })

  controller.initialize()
  assert.equal(currentWindow, null)

  statusBarItem.listeners.get('click')()
  assert.equal(createdWindowCount, 1)

  currentWindow = null
  menuItem(statusBarItem.menu, '运维中心').click()
  assert.equal(createdWindowCount, 2)
  assert.deepEqual(sent, [[IPC_CHANNELS.APP_NAVIGATE, '/ops-control-center']])

  menuItem(statusBarItem.menu, '退出应用').click()
  assert.equal(quitCount, 1)

  controller.destroy()
  assert.equal(listenerStopped, true)
  assert.equal(statusBarItem.destroyed, true)
})

test('Windows 集成复用隐藏启动参数并可打开系统通知设置', async () => {
  const ipcMain = createIpcMain()
  let subscribed = false
  let loginSettings = null
  let openAtLogin = false
  let trayRefreshes = 0
  const externalUrls = []
  const controller = createMacDesktopController({
    app: {
      isPackaged: true,
      getLoginItemSettings: () => ({ openAtLogin }),
      setLoginItemSettings: (settings) => {
        loginSettings = settings
        openAtLogin = settings.openAtLogin
      }
    },
    Menu: { buildFromTemplate: () => [] },
    shell: { openExternal: async (url) => externalUrls.push(url) },
    ipcMain,
    userDataPath: '/tmp/ops-other-desktop-test',
    getMainWindow: () => null,
    showMainWindow() {},
    platform: 'win32',
    refreshWindowsTray: () => {
      trayRefreshes += 1
    },
    subscribeToEvents: () => {
      subscribed = true
      return () => {}
    }
  })

  const initial = controller.initialize()
  assert.equal(initial.supported, true)
  assert.equal(initial.platform, 'win32')
  assert.equal(initial.platformLabel, 'Windows')
  assert.equal(initial.traySupported, true)
  assert.equal(initial.dockBadgeSupported, false)
  assert.equal(initial.loginItemAvailable, true)
  assert.equal(subscribed, false)
  const saveLoginItem = ipcMain.handlers.get(IPC_CHANNELS.DESKTOP_LOGIN_ITEM_SAVE)
  assert.deepEqual(await saveLoginItem({}, true), { ok: true, openAtLogin: true })
  assert.equal(loginSettings.openAtLogin, true)
  assert.equal(loginSettings.path, process.execPath)
  assert.deepEqual(loginSettings.args, ['--hidden'])
  assert.equal(trayRefreshes, 1)

  const openNotificationSettings = ipcMain.handlers.get(
    IPC_CHANNELS.DESKTOP_NOTIFICATION_SETTINGS_OPEN
  )
  assert.deepEqual(await openNotificationSettings(), { ok: true })
  assert.deepEqual(externalUrls, [WINDOWS_NOTIFICATION_SETTINGS_URL])
})

test('Linux 平台保持 no-op，并明确返回不支持', async () => {
  const ipcMain = createIpcMain()
  const controller = createMacDesktopController({
    app: { isPackaged: true },
    Menu: { buildFromTemplate: () => [] },
    shell: { openExternal: async () => {} },
    ipcMain,
    userDataPath: '/tmp/ops-linux-desktop-test',
    getMainWindow: () => null,
    showMainWindow() {},
    platform: 'linux'
  })

  assert.equal(controller.initialize().supported, false)
  const saveLoginItem = ipcMain.handlers.get(IPC_CHANNELS.DESKTOP_LOGIN_ITEM_SAVE)
  assert.equal((await saveLoginItem({}, true)).ok, false)
})
