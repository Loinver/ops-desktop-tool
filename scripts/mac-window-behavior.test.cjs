const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { EventEmitter } = require('node:events')

const {
  WINDOW_STATE_FILE,
  loadWindowState,
  resolveWindowState,
  trackWindowState
} = require('../src/main/window-state')
const { buildMacMenuTemplate } = require('../src/main/mac-application-menu')

const displays = [
  {
    primary: true,
    workArea: { x: 0, y: 25, width: 1440, height: 875 }
  },
  {
    primary: false,
    workArea: { x: 1440, y: 0, width: 1920, height: 1080 }
  }
]
const options = {
  displays,
  fallbackBounds: { x: 0, y: 0, width: 1400, height: 900 },
  minimumSize: { width: 960, height: 640 }
}

function findMenuItem(template, label) {
  for (const menu of template) {
    const item = menu.submenu?.find((entry) => entry.label === label)
    if (item) return item
  }
  return null
}

test('首次启动把窗口居中放入主显示器工作区', () => {
  assert.deepEqual(resolveWindowState(null, options), {
    bounds: { x: 20, y: 25, width: 1400, height: 875 },
    isMaximized: false,
    isFullScreen: false
  })
})

test('外接显示器断开后把旧窗口拉回主显示器', () => {
  const state = resolveWindowState(
    {
      bounds: { x: 3800, y: 120, width: 1300, height: 820 },
      isMaximized: true,
      isFullScreen: false
    },
    options
  )
  assert.deepEqual(state, {
    bounds: { x: 20, y: 25, width: 1400, height: 875 },
    isMaximized: true,
    isFullScreen: false
  })
})

test('恢复窗口时限制尺寸并确保完整位于可见工作区', () => {
  const state = resolveWindowState(
    {
      bounds: { x: 1300, y: -100, width: 2200, height: 1400 },
      isFullScreen: true
    },
    options
  )
  assert.deepEqual(state, {
    bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
    isMaximized: false,
    isFullScreen: true
  })
})

test('窗口移动和关闭时持久化 normal bounds、最大化与全屏状态', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-window-state-'))
  class MockWindow extends EventEmitter {
    isDestroyed() {
      return false
    }
    getNormalBounds() {
      return { x: 80, y: 70, width: 1200, height: 760 }
    }
    isMaximized() {
      return true
    }
    isFullScreen() {
      return false
    }
  }

  const window = new MockWindow()
  trackWindowState(window, { userDataPath: root, debounceMs: 5 })
  window.emit('move')
  await new Promise((resolve) => setTimeout(resolve, 15))

  const filePath = path.join(root, WINDOW_STATE_FILE)
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
    bounds: { x: 80, y: 70, width: 1200, height: 760 },
    isMaximized: true,
    isFullScreen: false
  })

  window.emit('close')
  const loaded = loadWindowState({ userDataPath: root, ...options })
  assert.equal(loaded.isMaximized, true)
  fs.rmSync(root, { recursive: true, force: true })
})

test('macOS 原生菜单提供标准角色、设置快捷键和页面导航', () => {
  const routes = []
  const themeModes = []
  const template = buildMacMenuTemplate({
    appName: 'Ops Desktop',
    isDev: false,
    navigate: (route) => routes.push(route),
    setThemeMode: (mode) => themeModes.push(mode),
    openLogs() {},
    openDataDirectory() {}
  })

  assert.equal(template[0].label, 'Ops Desktop')
  assert.ok(template[0].submenu.some((item) => item.role === 'about'))
  assert.ok(template[2].submenu.some((item) => item.role === 'pasteAndMatchStyle'))
  assert.ok(template[4].submenu.some((item) => item.role === 'minimize'))
  assert.equal(
    template[3].submenu.some((item) => item.role === 'toggleDevTools'),
    false
  )

  const settings = findMenuItem(template, '设置…')
  assert.equal(settings.accelerator, 'CommandOrControl+,')
  settings.click()
  findMenuItem(template, '系统信息').click()

  const appearance = findMenuItem(template, '外观')
  assert.deepEqual(
    appearance.submenu.map((item) => item.label),
    ['跟随系统', '浅色', '深色']
  )
  appearance.submenu.forEach((item) => item.click())

  assert.deepEqual(routes, ['/data-management', '/system-info'])
  assert.deepEqual(themeModes, ['system', 'light', 'dark'])
})
