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

function buildOpsDashboardData({
  modelHistory = [],
  releaseHistory = [],
  monitor = {},
  backup = {},
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
    backup: backupSummary(backup)
  }
}

module.exports = { buildOpsDashboardData }
