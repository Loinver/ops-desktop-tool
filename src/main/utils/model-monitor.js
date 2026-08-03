const MIN_INTERVAL_MINUTES = 5
const MAX_INTERVAL_MINUTES = 1440
const DEFAULT_INTERVAL_MINUTES = 60

function normalizeIntervalMinutes(value) {
  return Math.min(
    MAX_INTERVAL_MINUTES,
    Math.max(MIN_INTERVAL_MINUTES, Number(value) || DEFAULT_INTERVAL_MINUTES)
  )
}

function normalizeMonitorTargets(value) {
  return Array.isArray(value)
    ? value
        .slice(0, 200)
        .map((item) => ({
          providerId: String(item?.providerId || ''),
          providerName: String(item?.providerName || ''),
          appType: String(item?.appType || ''),
          model: String(item?.model || ''),
          beta1m: Boolean(item?.beta1m)
        }))
        .filter((item) => item.providerId && item.appType && item.model)
    : []
}

function normalizeMonitorSettings(value = {}) {
  const targets = normalizeMonitorTargets(value.targets)
  const enabled = Boolean(value.enabled) && targets.length > 0
  return {
    enabled,
    intervalMinutes: normalizeIntervalMinutes(value.intervalMinutes),
    notifyOnFailure: value.notifyOnFailure !== false,
    targets,
    lastRunAt: Number(value.lastRunAt) || 0,
    nextRunAt: enabled ? Number(value.nextRunAt) || 0 : 0
  }
}

function updateMonitorSettings(currentValue = {}, changes = {}, savedAt = Date.now()) {
  const current = normalizeMonitorSettings(currentValue)
  const has = (key) => Object.prototype.hasOwnProperty.call(changes, key)
  const targets = has('targets') ? normalizeMonitorTargets(changes.targets) : current.targets
  const requestedEnabled = has('enabled') ? Boolean(changes.enabled) : current.enabled
  // 显式启用仍应给出清晰错误；仅清空目标时则自动关闭，避免留下
  // “enabled=true 但没有目标”的不可运行状态。
  if (has('enabled') && requestedEnabled && targets.length === 0) {
    throw new Error('请先在模型可靠性页配置巡检目标')
  }
  const enabled = requestedEnabled && targets.length > 0

  const intervalMinutes = has('intervalMinutes')
    ? normalizeIntervalMinutes(changes.intervalMinutes)
    : current.intervalMinutes
  const notifyOnFailure = has('notifyOnFailure')
    ? changes.notifyOnFailure !== false
    : current.notifyOnFailure
  const timestamp = Number(savedAt) || Date.now()
  const shouldReschedule =
    !current.enabled || intervalMinutes !== current.intervalMinutes || !current.nextRunAt

  return {
    enabled,
    intervalMinutes,
    notifyOnFailure,
    targets,
    lastRunAt: current.lastRunAt,
    nextRunAt: enabled
      ? shouldReschedule
        ? timestamp + intervalMinutes * 60_000
        : current.nextRunAt
      : 0
  }
}

/**
 * 基于任务完成时读取到的最新设置，仅更新巡检时间字段。
 * 不能复用任务启动时的设置，否则会覆盖用户在巡检期间保存的开关等修改。
 */
function completeMonitorRun(settings = {}, completedAt = Date.now()) {
  const current = normalizeMonitorSettings(settings)
  const timestamp = Number(completedAt) || Date.now()
  return {
    ...current,
    lastRunAt: timestamp,
    nextRunAt: current.enabled ? timestamp + current.intervalMinutes * 60_000 : 0
  }
}

function countMonitorAnomalies(summary = {}) {
  const failed = Math.max(0, Number(summary.failed) || 0)
  const gateway = Math.max(0, Number(summary.gateway) || 0)
  return failed + gateway
}

module.exports = {
  completeMonitorRun,
  countMonitorAnomalies,
  normalizeMonitorSettings,
  normalizeMonitorTargets,
  updateMonitorSettings
}
