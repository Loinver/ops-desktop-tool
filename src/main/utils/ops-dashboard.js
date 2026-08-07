const { normalizeMonitorSettings } = require('./model-monitor')

function modelSummary(item = {}) {
  return {
    total: Number(item.summary?.total) || 0,
    ok: Number(item.summary?.ok) || 0,
    failed: Number(item.summary?.failed) || 0,
    gateway: Number(item.summary?.gateway) || 0,
    durationMs: Number(item.summary?.durationMs) || 0
  }
}

function latestReleaseEntry(item) {
  if (!item) return null
  return {
    id: String(item.id || ''),
    action: item.action === 'rollback' ? 'rollback' : 'deploy',
    status: ['success', 'failed', 'rolled-back'].includes(item.status) ? item.status : 'failed',
    label: String(item.label || ''),
    message: String(item.message || ''),
    remoteDir: String(item.remoteDir || ''),
    startedAt: Number(item.startedAt) || 0,
    finishedAt: Number(item.finishedAt) || 0
  }
}

function monitorSummary(value = {}) {
  const { targets, ...settings } = normalizeMonitorSettings(value)
  return {
    ...settings,
    targetCount: targets.length
  }
}

function latestModelEntry(item) {
  if (!item) return null
  return {
    id: String(item.id || ''),
    source: item.source === 'scheduled' ? 'scheduled' : 'manual',
    label: String(item.label || ''),
    startedAt: Number(item.startedAt) || 0,
    finishedAt: Number(item.finishedAt) || 0,
    summary: modelSummary(item)
  }
}

function backupSummary({ health = {}, settings = {} } = {}) {
  const status = ['healthy', 'warning', 'error', 'disabled'].includes(health.status)
    ? health.status
    : 'disabled'
  return {
    enabled: Boolean(settings.enabled),
    status,
    summary: String(
      health.summary || (status === 'disabled' ? '自动备份计划未启用' : '自动备份状态未知')
    ),
    lastSuccessfulAt: Number(health.lastSuccessfulAt) || 0,
    nextRunAt: Number(settings.nextRunAt) || 0,
    missingCount: Math.max(0, Number(health.missingCount) || 0),
    freeBytes: Math.max(0, Number(health.freeBytes) || 0)
  }
}

function finiteNumber(value) {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

function positiveTime(value) {
  const result = finiteNumber(value)
  return result > 0 ? result : 0
}

function eventSummary(eventTotals = {}) {
  return {
    total: Math.max(0, finiteNumber(eventTotals?.total)),
    active: Math.max(0, finiteNumber(eventTotals?.active)),
    open: Math.max(0, finiteNumber(eventTotals?.open)),
    acknowledged: Math.max(0, finiteNumber(eventTotals?.acknowledged)),
    resolved: Math.max(0, finiteNumber(eventTotals?.resolved)),
    recovered: Math.max(0, finiteNumber(eventTotals?.recovered)),
    unread: Math.max(0, finiteNumber(eventTotals?.unread)),
    unreadCritical: Math.max(0, finiteNumber(eventTotals?.unreadCritical)),
    critical: Math.max(0, finiteNumber(eventTotals?.critical)),
    warning: Math.max(0, finiteNumber(eventTotals?.warning))
  }
}

function latestEventEntry(item) {
  return {
    id: String(item?.id || ''),
    sourceType: String(item?.sourceType || ''),
    sourceId: String(item?.sourceId || ''),
    severity: ['info', 'warning', 'critical'].includes(item?.severity) ? item.severity : 'info',
    status: ['open', 'acknowledged', 'resolved'].includes(item?.status) ? item.status : 'open',
    title: String(item?.title || ''),
    occurrenceCount: Math.max(0, finiteNumber(item?.occurrenceCount)),
    lastOccurredAt: finiteNumber(item?.lastOccurredAt),
    updatedAt: finiteNumber(item?.updatedAt)
  }
}

function eventsSummary({ events = [], eventTotals = {} } = {}) {
  const latest = (Array.isArray(events) ? events : [])
    .filter((item) => item?.status !== 'resolved')
    .slice()
    .sort((a, b) => finiteNumber(b?.updatedAt) - finiteNumber(a?.updatedAt))
    .slice(0, 6)
    .map(latestEventEntry)

  return { summary: eventSummary(eventTotals), latest }
}

function automationSummary(tasks = []) {
  const items = Array.isArray(tasks) ? tasks : []
  const enabledItems = items.filter((item) => item?.enabled)
  let healthy = 0
  let failing = 0
  let pending = 0

  for (const item of enabledItems) {
    if (item.lastResult?.ok === true) healthy += 1
    else if (item.lastResult?.ok === false) failing += 1
    else pending += 1
  }

  const nextRunAt = enabledItems.reduce((earliest, item) => {
    const candidate = positiveTime(item?.nextRunAt)
    return candidate && (!earliest || candidate < earliest) ? candidate : earliest
  }, 0)

  return {
    total: items.length,
    enabled: enabledItems.length,
    healthy,
    failing,
    pending,
    nextRunAt
  }
}

function nodeServicesSummary(nodeServices = []) {
  const items = Array.isArray(nodeServices) ? nodeServices : []
  const enabledItems = items.filter((item) => item?.enabled)
  let online = 0
  let offline = 0
  let unknown = 0

  const lastCheckedAt = enabledItems.reduce((latest, item) => {
    const updatedAt = positiveTime(item?.updatedAt)
    const lastSeenAt = positiveTime(item?.lastSeenAt)
    return Math.max(latest, updatedAt, lastSeenAt)
  }, 0)

  for (const item of enabledItems) {
    if (item.lastState === 'online') online += 1
    else if (item.lastState === 'offline') offline += 1
    else unknown += 1
  }

  return {
    total: items.length,
    enabled: enabledItems.length,
    online,
    offline,
    unknown,
    lastCheckedAt
  }
}

function buildOpsDashboardData({
  modelHistory = [],
  releaseHistory = [],
  monitor = {},
  backup = {},
  events = [],
  eventTotals = {},
  automationTasks = [],
  nodeServices = [],
  generatedAt = Date.now()
} = {}) {
  const recentModel = Array.isArray(modelHistory) ? modelHistory.slice(0, 20) : []
  const releases = Array.isArray(releaseHistory) ? releaseHistory : []
  // 回滚成功也会写入发布历史，但不应被首页的「发布成功/失败」指标误计为一次发布。
  const deployments = releases.filter((item) => item?.action !== 'rollback')
  const totalResults = recentModel.reduce((sum, item) => sum + modelSummary(item).total, 0)
  const okResults = recentModel.reduce((sum, item) => sum + modelSummary(item).ok, 0)

  return {
    generatedAt: Number(generatedAt) || Date.now(),
    release: {
      total: releases.length,
      success: deployments.filter((item) => item.status === 'success').length,
      failed: deployments.filter((item) => item.status === 'failed').length,
      latest: releases.slice(0, 8).map(latestReleaseEntry)
    },
    model: {
      inspections: Array.isArray(modelHistory) ? modelHistory.length : 0,
      availability: totalResults ? Math.round((okResults / totalResults) * 1000) / 10 : null,
      latest: latestModelEntry(recentModel[0]),
      trend: recentModel
        .slice()
        .reverse()
        .map((item) => {
          const summary = modelSummary(item)
          return {
            timestamp: Number(item.finishedAt) || 0,
            ok: summary.ok,
            failed: summary.failed,
            gateway: summary.gateway,
            total: summary.total
          }
        })
    },
    monitor: monitorSummary(monitor),
    backup: backupSummary(backup),
    events: eventsSummary({ events, eventTotals }),
    automation: automationSummary(automationTasks),
    nodeServices: nodeServicesSummary(nodeServices)
  }
}

module.exports = { buildOpsDashboardData }
