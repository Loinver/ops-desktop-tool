const { eventSummary, onOpsEventChange } = require('./utils/ops-automation')

const OVERLAY_SIZE = 16

function normalizeUnreadSummary(value = {}) {
  return {
    unread: Math.max(0, Math.floor(Number(value?.unread) || 0)),
    unreadCritical: Math.max(0, Math.floor(Number(value?.unreadCritical) || 0))
  }
}

function unreadOverlayDescription(value = {}) {
  const summary = normalizeUnreadSummary(value)
  if (summary.unread === 0) return ''
  const critical = summary.unreadCritical ? `，其中 ${summary.unreadCritical} 条严重告警` : ''
  return `${summary.unread} 条未读运维事件${critical}`
}

function createUnreadOverlayBitmap(size = OVERLAY_SIZE) {
  const normalizedSize = Math.max(8, Math.floor(Number(size) || OVERLAY_SIZE))
  const bitmap = Buffer.alloc(normalizedSize * normalizedSize * 4)
  const center = (normalizedSize - 1) / 2
  const outerRadius = normalizedSize * 0.44
  const innerRadius = normalizedSize * 0.31

  for (let y = 0; y < normalizedSize; y += 1) {
    for (let x = 0; x < normalizedSize; x += 1) {
      const distance = Math.hypot(x - center, y - center)
      if (distance > outerRadius) continue
      const offset = (y * normalizedSize + x) * 4
      if (distance > innerRadius) {
        bitmap[offset] = 255
        bitmap[offset + 1] = 255
        bitmap[offset + 2] = 255
      } else {
        // Electron 的 bitmap 使用 BGRA 顺序；完全不透明像素无需额外预乘 alpha。
        bitmap[offset] = 57
        bitmap[offset + 1] = 69
        bitmap[offset + 2] = 239
      }
      bitmap[offset + 3] = 255
    }
  }

  return bitmap
}

function shouldFlashForChange(change) {
  return change?.kind === 'opened' && change.item?.severity === 'critical'
}

function createWindowsTaskbarController({
  nativeImage,
  userDataPath,
  getWindow,
  logger = console,
  platform = process.platform,
  summarizeEvents = eventSummary,
  subscribeToEvents = onOpsEventChange
}) {
  if (!nativeImage || !userDataPath || typeof getWindow !== 'function') {
    throw new Error('创建 Windows 任务栏控制器缺少必要参数')
  }

  const supported = platform === 'win32'
  const attachedWindows = new WeakSet()
  let summary = normalizeUnreadSummary()
  let overlayIcon = null
  let stopListening = null
  let flashing = false

  function getOverlayIcon() {
    if (overlayIcon) return overlayIcon
    const bitmap = createUnreadOverlayBitmap()
    overlayIcon = nativeImage.createFromBitmap(bitmap, {
      width: OVERLAY_SIZE,
      height: OVERLAY_SIZE,
      scaleFactor: 1
    })
    if (overlayIcon?.isEmpty?.()) throw new Error('Windows 任务栏未读图标为空')
    return overlayIcon
  }

  function stopFlashing(window = getWindow()) {
    if (!window || window.isDestroyed?.() || typeof window.flashFrame !== 'function') return false
    if (flashing) window.flashFrame(false)
    flashing = false
    return true
  }

  function apply(change, window = getWindow()) {
    if (!supported || !window || window.isDestroyed?.()) return false
    if (typeof window.setOverlayIcon !== 'function') return false

    try {
      if (summary.unread > 0) {
        window.setOverlayIcon(getOverlayIcon(), unreadOverlayDescription(summary))
      } else {
        window.setOverlayIcon(null, '')
      }

      if (summary.unread === 0 || window.isFocused?.()) {
        stopFlashing(window)
      } else if (shouldFlashForChange(change) && typeof window.flashFrame === 'function') {
        window.flashFrame(true)
        flashing = true
      }
      return true
    } catch (error) {
      logger.warn?.('更新 Windows 任务栏未读状态失败', { message: error?.message })
      return false
    }
  }

  function refresh(change) {
    if (!supported) return { ...summary }
    try {
      summary = normalizeUnreadSummary(summarizeEvents(userDataPath))
      apply(change)
    } catch (error) {
      logger.warn?.('读取 Windows 任务栏未读状态失败', { message: error?.message })
    }
    return { ...summary }
  }

  function attachWindow(window) {
    if (!supported || !window || window.isDestroyed?.()) return false
    if (!attachedWindows.has(window)) {
      attachedWindows.add(window)
      window.on?.('focus', () => stopFlashing(window))
    }
    return apply(null, window)
  }

  function initialize() {
    if (!supported) return { supported: false, ...summary }
    refresh()
    try {
      stopListening = subscribeToEvents((change) => refresh(change))
    } catch (error) {
      logger.warn?.('监听 Windows 任务栏运维事件失败', { message: error?.message })
    }
    return { supported: true, ...summary }
  }

  function destroy() {
    stopListening?.()
    stopListening = null
    const window = getWindow()
    if (supported && window && !window.isDestroyed?.()) {
      try {
        window.setOverlayIcon?.(null, '')
        stopFlashing(window)
      } catch (error) {
        logger.warn?.('清理 Windows 任务栏状态失败', { message: error?.message })
      }
    }
    overlayIcon = null
  }

  return {
    attachWindow,
    destroy,
    initialize,
    refresh,
    status() {
      return { supported, ...summary, flashing }
    },
    stopFlashing
  }
}

module.exports = {
  OVERLAY_SIZE,
  createUnreadOverlayBitmap,
  createWindowsTaskbarController,
  normalizeUnreadSummary,
  shouldFlashForChange,
  unreadOverlayDescription
}
