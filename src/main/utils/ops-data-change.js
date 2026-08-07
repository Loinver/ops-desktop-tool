const { EventEmitter } = require('node:events')

const opsDataEmitter = new EventEmitter()

function safeText(value, maxLength) {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
}

function normalizeOpsDataChange(change = {}) {
  return {
    kind: safeText(change.kind, 40) || 'updated',
    sourceType: safeText(change.sourceType, 60),
    sourceId: safeText(change.sourceId, 180),
    eventId: safeText(change.eventId, 120),
    severity: safeText(change.severity, 30),
    status: safeText(change.status, 30),
    updatedAt: Number(change.updatedAt) || Date.now()
  }
}

function emitOpsDataChange(change = {}) {
  const payload = normalizeOpsDataChange(change)
  for (const listener of opsDataEmitter.listeners('change')) {
    try {
      listener(payload)
    } catch (error) {
      console.error('运维数据变更监听器执行失败:', error)
    }
  }
  return payload
}

function onOpsDataChange(listener) {
  if (typeof listener !== 'function') throw new TypeError('运维数据变更监听器必须是函数')
  opsDataEmitter.on('change', listener)
  return () => opsDataEmitter.off('change', listener)
}

module.exports = {
  emitOpsDataChange,
  normalizeOpsDataChange,
  onOpsDataChange
}
