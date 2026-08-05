const fs = require('node:fs')
const path = require('node:path')

const WINDOW_STATE_FILE = 'window-state.json'
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 80

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

function normalizeBounds(value, fallback) {
  if (!value || typeof value !== 'object') return { ...fallback }
  return {
    x: finiteNumber(value.x, fallback.x),
    y: finiteNumber(value.y, fallback.y),
    width: finiteNumber(value.width, fallback.width),
    height: finiteNumber(value.height, fallback.height)
  }
}

function intersectionSize(bounds, area) {
  const width = Math.max(
    0,
    Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  )
  const height = Math.max(
    0,
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
  )
  return { width, height }
}

function displayForBounds(bounds, displays) {
  let best = null
  let bestArea = 0
  for (const display of displays) {
    const intersection = intersectionSize(bounds, display.workArea)
    const area = intersection.width * intersection.height
    if (area > bestArea) {
      best = display
      bestArea = area
    }
  }
  if (!best) return null
  const visible = intersectionSize(bounds, best.workArea)
  return visible.width >= MIN_VISIBLE_WIDTH && visible.height >= MIN_VISIBLE_HEIGHT ? best : null
}

function primaryDisplay(displays) {
  return displays.find((display) => display.primary) || displays[0] || null
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function fitBoundsToDisplay(bounds, display, minimumSize) {
  const area = display.workArea
  const width = clamp(bounds.width, Math.min(minimumSize.width, area.width), area.width)
  const height = clamp(bounds.height, Math.min(minimumSize.height, area.height), area.height)
  return {
    x: clamp(bounds.x, area.x, area.x + area.width - width),
    y: clamp(bounds.y, area.y, area.y + area.height - height),
    width,
    height
  }
}

function centeredBounds(display, fallback, minimumSize) {
  const area = display.workArea
  const width = clamp(fallback.width, Math.min(minimumSize.width, area.width), area.width)
  const height = clamp(fallback.height, Math.min(minimumSize.height, area.height), area.height)
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height
  }
}

function resolveWindowState(rawState, { displays, fallbackBounds, minimumSize }) {
  const availableDisplays = Array.isArray(displays) ? displays.filter((item) => item?.workArea) : []
  const primary = primaryDisplay(availableDisplays)
  const fallback = normalizeBounds(fallbackBounds, { x: 0, y: 0, width: 1200, height: 800 })
  if (!primary) {
    return { bounds: fallback, isMaximized: false, isFullScreen: false }
  }

  const hasSavedBounds = rawState?.bounds && typeof rawState.bounds === 'object'
  const candidate = normalizeBounds(rawState?.bounds, fallback)
  const display = hasSavedBounds ? displayForBounds(candidate, availableDisplays) : null
  const bounds = display
    ? fitBoundsToDisplay(candidate, display, minimumSize)
    : centeredBounds(primary, fallback, minimumSize)

  return {
    bounds,
    isMaximized: rawState?.isMaximized === true,
    isFullScreen: rawState?.isFullScreen === true
  }
}

function windowStatePath(userDataPath) {
  return path.join(userDataPath, WINDOW_STATE_FILE)
}

function loadWindowState({ userDataPath, displays, fallbackBounds, minimumSize }) {
  let rawState = null
  try {
    rawState = JSON.parse(fs.readFileSync(windowStatePath(userDataPath), 'utf8'))
  } catch {
    // 首次启动、旧文件损坏或目录不可读时使用安全默认值。
  }
  return resolveWindowState(rawState, { displays, fallbackBounds, minimumSize })
}

function writeWindowState(filePath, state) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporaryPath, filePath)
  } catch {
    try {
      fs.rmSync(temporaryPath, { force: true })
    } catch {
      // 状态持久化失败不应影响窗口关闭。
    }
  }
}

function snapshotWindowState(window) {
  const normalBounds =
    typeof window.getNormalBounds === 'function' ? window.getNormalBounds() : window.getBounds()
  return {
    bounds: normalBounds,
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen()
  }
}

function trackWindowState(window, { userDataPath, debounceMs = 250 } = {}) {
  const filePath = windowStatePath(userDataPath)
  let timer = null

  const persist = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (window.isDestroyed()) return
    writeWindowState(filePath, snapshotWindowState(window))
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, debounceMs)
    timer.unref?.()
  }

  for (const eventName of [
    'move',
    'resize',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen'
  ]) {
    window.on(eventName, schedule)
  }
  window.on('close', persist)
  window.on('closed', () => {
    if (timer) clearTimeout(timer)
    timer = null
  })

  return { persist }
}

module.exports = {
  WINDOW_STATE_FILE,
  loadWindowState,
  resolveWindowState,
  snapshotWindowState,
  trackWindowState
}
