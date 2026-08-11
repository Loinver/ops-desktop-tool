const MAX_TIMELINE_ITEMS = 100
const MAX_DETAIL_LENGTH = 1000

function text(value, max = MAX_DETAIL_LENGTH) {
  return String(value || '')
    .trim()
    .slice(0, max)
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function timestamp(value) {
  const number = finiteNumber(value)
  return number > 0 ? number : 0
}

function redact(value, redactor) {
  const normalized = text(value)
  return typeof redactor === 'function' ? text(redactor(normalized)) : normalized
}

function normalizeSeverity(value) {
  const normalized = text(value, 40).toLowerCase()
  if (['critical', 'high', 'error', 'failed', 'offline'].includes(normalized)) return 'critical'
  if (['warning', 'medium', 'warn', 'guided', 'rolled-back', 'unknown'].includes(normalized))
    return 'warning'
  return 'info'
}

function timelineTypeLabel(value) {
  return (
    {
      opened: '事件创建',
      occurred: '再次发生',
      reopened: '重新触发',
      acknowledged: '已确认',
      resolved: '已解决',
      recovered: '自动恢复'
    }[value] || '状态更新'
  )
}

function pushTimelineItem(items, input, redactor) {
  const itemTimestamp = timestamp(input.timestamp)
  if (!itemTimestamp) return
  items.push({
    id: text(input.id, 180) || `${text(input.kind, 40) || 'item'}:${itemTimestamp}`,
    kind: text(input.kind, 40) || 'system',
    sourceType: text(input.sourceType, 60) || 'system',
    sourceLabel: redact(input.sourceLabel || input.sourceType || '系统', redactor),
    timestamp: itemTimestamp,
    severity: normalizeSeverity(input.severity),
    status: text(input.status, 60),
    title: redact(input.title || '运维记录', redactor),
    detail: redact(input.detail, redactor),
    reference:
      input.reference && typeof input.reference === 'object'
        ? Object.fromEntries(
            Object.entries(input.reference)
              .slice(0, 8)
              .map(([key, value]) => [text(key, 60), text(value, 180)])
              .filter(([key, value]) => key && value)
          )
        : {}
  })
}

function addEventTimeline(items, events, redactor) {
  for (const event of Array.isArray(events) ? events.slice(0, 50) : []) {
    const entries = Array.isArray(event?.timeline) ? event.timeline.slice(-12) : []
    if (!entries.length) {
      pushTimelineItem(
        items,
        {
          id: `event:${event?.id || timestamp(event?.updatedAt)}`,
          kind: 'event',
          sourceType: event?.sourceType || event?.category || 'system',
          sourceLabel: event?.sourceType || event?.category || '系统',
          timestamp: event?.lastOccurredAt || event?.updatedAt || event?.createdAt,
          severity: event?.severity || event?.level,
          status: event?.status,
          title: event?.title,
          detail: event?.resolutionNote || event?.description,
          reference: { eventId: event?.id, sourceId: event?.sourceId || event?.relatedId }
        },
        redactor
      )
      continue
    }
    for (const entry of entries) {
      pushTimelineItem(
        items,
        {
          id: `event:${event?.id || 'unknown'}:${entry?.id || timestamp(entry?.createdAt)}`,
          kind: 'event',
          sourceType: event?.sourceType || event?.category || 'system',
          sourceLabel: event?.sourceType || event?.category || '系统',
          timestamp: entry?.createdAt,
          severity: event?.severity || event?.level,
          status: event?.status,
          title: `${event?.title || '运维事件'} · ${timelineTypeLabel(entry?.type)}`,
          detail: entry?.message || event?.description,
          reference: { eventId: event?.id, sourceId: event?.sourceId || event?.relatedId }
        },
        redactor
      )
    }
  }
}

function addLogTimeline(items, logs, redactor) {
  for (const log of Array.isArray(logs) ? logs.slice(0, 30) : []) {
    const findingCount = Array.isArray(log?.findings)
      ? log.findings.reduce((sum, finding) => sum + Math.max(0, finiteNumber(finding?.count)), 0)
      : 0
    pushTimelineItem(
      items,
      {
        id: `log:${log?.id || timestamp(log?.createdAt || log?.analyzedAt)}`,
        kind: 'log',
        sourceType: 'log',
        sourceLabel: '日志分析',
        timestamp: log?.createdAt || log?.analyzedAt,
        severity: log?.level,
        status: findingCount > 0 ? 'findings' : 'clear',
        title: `日志分析：${log?.title || '未命名日志'}`,
        detail: [log?.headline, log?.aiSummary].filter(Boolean).join('；'),
        reference: { logId: log?.id }
      },
      redactor
    )
  }
}

function addReleaseTimeline(items, releases, redactor) {
  for (const release of Array.isArray(releases) ? releases.slice(0, 50) : []) {
    const action = release?.action === 'rollback' ? '回滚' : '发布'
    pushTimelineItem(
      items,
      {
        id: `release:${release?.id || timestamp(release?.finishedAt)}`,
        kind: 'release',
        sourceType: 'release',
        sourceLabel: '系统发布',
        timestamp: release?.finishedAt || release?.startedAt,
        severity: release?.status,
        status: release?.status,
        title: `${action}：${release?.label || '发布任务'}`,
        detail: [release?.profileName, release?.message].filter(Boolean).join(' · '),
        reference: { releaseId: release?.id, profileId: release?.profileId }
      },
      redactor
    )
  }
}

function addNodeTimeline(items, history, redactor) {
  const byService = new Map()
  for (const sample of Array.isArray(history) ? history.slice(0, 500) : []) {
    const serviceId = text(sample?.serviceId || `${sample?.protocol || 'TCP'}:${sample?.port}`, 120)
    if (!serviceId) continue
    const group = byService.get(serviceId) || []
    group.push(sample)
    byService.set(serviceId, group)
  }
  for (const [serviceId, samples] of byService) {
    const ordered = samples.sort(
      (first, second) => timestamp(first?.checkedAt) - timestamp(second?.checkedAt)
    )
    let previousState = ''
    for (let index = 0; index < ordered.length; index += 1) {
      const sample = ordered[index]
      const state = text(sample?.state, 30) || 'unknown'
      const isLatest = index === ordered.length - 1
      if (state === previousState && !isLatest) continue
      previousState = state
      const metrics = sample?.metricsAvailable
        ? `CPU ${finiteNumber(sample?.cpuPercent).toFixed(1)}%，内存 ${Math.round(finiteNumber(sample?.memoryBytes) / 1024 / 1024)} MB`
        : '无可用进程指标'
      pushTimelineItem(
        items,
        {
          id: `node:${serviceId}:${timestamp(sample?.checkedAt)}`,
          kind: 'node-service',
          sourceType: 'node-service',
          sourceLabel: 'Node 服务',
          timestamp: sample?.checkedAt,
          severity: state,
          status: state,
          title: `${sample?.protocol || 'TCP'}:${sample?.port || '—'} ${state === 'online' ? '在线' : state === 'offline' ? '离线' : '状态未知'}`,
          detail: [sample?.commandLabel, metrics].filter(Boolean).join(' · '),
          reference: { serviceId, pid: sample?.pid }
        },
        redactor
      )
    }
  }
}

function addRunbookTimeline(items, runs, redactor) {
  for (const run of Array.isArray(runs) ? runs.slice(0, 50) : []) {
    const summary = run?.summary || {}
    pushTimelineItem(
      items,
      {
        id: `runbook:${run?.id || timestamp(run?.finishedAt)}`,
        kind: 'runbook',
        sourceType: run?.sourceType || 'runbook',
        sourceLabel: 'Runbook',
        timestamp: run?.finishedAt || run?.startedAt,
        severity: run?.status,
        status: run?.status,
        title: `Runbook ${run?.status === 'succeeded' ? '执行成功' : run?.status === 'failed' ? '执行失败' : '需要人工处理'}`,
        detail:
          run?.reason ||
          `共 ${finiteNumber(summary.total)} 步，成功 ${finiteNumber(summary.succeeded)}，失败 ${finiteNumber(summary.failed)}，引导 ${finiteNumber(summary.guided)}`,
        reference: { runId: run?.id, planId: run?.planId, eventId: run?.eventId }
      },
      redactor
    )
  }
}

function buildCopilotTimeline(input = {}) {
  const items = []
  const redactor = input.redact
  addEventTimeline(items, input.events, redactor)
  addLogTimeline(items, input.logs, redactor)
  addReleaseTimeline(items, input.releases, redactor)
  addNodeTimeline(items, input.nodeHistory, redactor)
  addRunbookTimeline(items, input.runbooks, redactor)

  const requestedLimit = Math.floor(finiteNumber(input.limit, 60))
  const limit = Math.min(MAX_TIMELINE_ITEMS, Math.max(1, requestedLimit || 60))
  const timeline = items.sort((first, second) => second.timestamp - first.timestamp).slice(0, limit)
  return {
    items: timeline,
    summary: {
      total: timeline.length,
      critical: timeline.filter((item) => item.severity === 'critical').length,
      warning: timeline.filter((item) => item.severity === 'warning').length,
      sources: Object.fromEntries(
        [...new Set(timeline.map((item) => item.sourceType))].map((sourceType) => [
          sourceType,
          timeline.filter((item) => item.sourceType === sourceType).length
        ])
      )
    },
    generatedAt: Date.now()
  }
}

function formatCopilotTimeline(timeline, limit = 40) {
  const items = Array.isArray(timeline?.items) ? timeline.items.slice(0, limit) : []
  if (!items.length) return '关联时间线：无'
  return `关联时间线：\n${items
    .map(
      (item, index) =>
        `${index + 1}. [${new Date(item.timestamp).toISOString()}][${item.severity}][${item.sourceLabel}] ${item.title}${item.detail ? `：${item.detail}` : ''}`
    )
    .join('\n')}`
}

function riskFactor(id, level, title, detail, recommendation) {
  return { id, level, title, detail, recommendation }
}

function buildReleaseRiskSummary(input = {}) {
  const preflight = input.preflight && typeof input.preflight === 'object' ? input.preflight : {}
  const profile = input.profile && typeof input.profile === 'object' ? input.profile : {}
  const profileId = text(profile.id || input.profileId, 120)
  const profileName = text(profile.name || input.profileName, 80) || '当前环境'
  const total = Math.max(0, finiteNumber(preflight.total))
  const onlyLocal = Math.max(0, finiteNumber(preflight.onlyLocal))
  const modified = Math.max(0, finiteNumber(preflight.modified))
  const onlyRemote = Math.max(0, finiteNumber(preflight.onlyRemote))
  const history = (Array.isArray(input.history) ? input.history : [])
    .filter((item) => !profileId || text(item?.profileId, 120) === profileId)
    .sort(
      (first, second) =>
        timestamp(second?.finishedAt || second?.startedAt) -
        timestamp(first?.finishedAt || first?.startedAt)
    )
    .slice(0, 20)
  const healthCheck =
    profile.healthCheck && typeof profile.healthCheck === 'object' ? profile.healthCheck : {}
  const healthCheckEnabled = profile.healthCheckEnabled === true || healthCheck.enabled === true
  const autoRollback = profile.healthCheckAutoRollback === true || healthCheck.autoRollback === true
  const hasHostFingerprint = Boolean(profile.hasHostFingerprint || profile.hostFingerprint)
  const factors = []
  let score = 0

  if (/(^|\b)(prod|production)(\b|$)|生产|正式|线上/i.test(profileName)) {
    score += 20
    factors.push(
      riskFactor(
        'production-target',
        'warning',
        '疑似生产环境',
        `环境名称“${profileName}”包含生产语义。`,
        '确认变更窗口、负责人和回滚联系人。'
      )
    )
  }
  if (!hasHostFingerprint) {
    score += 25
    factors.push(
      riskFactor(
        'host-fingerprint',
        'critical',
        '未固定 SSH 主机指纹',
        '无法确认目标服务器身份，存在连接到错误主机的风险。',
        '先从可信渠道核对并保存 SHA256 主机指纹。'
      )
    )
  }
  if (!healthCheckEnabled) {
    score += 25
    factors.push(
      riskFactor(
        'health-check',
        'critical',
        '未启用发布后健康检查',
        '发布完成后不会自动验证服务是否可用。',
        '配置 HTTP/HTTPS 健康检查，至少覆盖核心入口。'
      )
    )
  } else if (!autoRollback) {
    score += 8
    factors.push(
      riskFactor(
        'manual-rollback',
        'warning',
        '健康检查失败后需手动回滚',
        '已配置健康检查，但失败时不会自动恢复发布前版本。',
        '确认值守人员可在失败后立即执行回滚。'
      )
    )
  }
  if (total <= 0) {
    score += 20
    factors.push(
      riskFactor(
        'empty-artifact',
        'critical',
        '预检未发现待比较文件',
        '空构建产物或目录选择错误可能导致无效发布。',
        '重新核对本地构建目录和发布条目。'
      )
    )
  }
  if (onlyRemote > 0) {
    const points = Math.min(25, 8 + onlyRemote * 2)
    score += points
    factors.push(
      riskFactor(
        'remote-only',
        onlyRemote >= 5 ? 'critical' : 'warning',
        `存在 ${onlyRemote} 个仅远程文件`,
        '这些文件不在本次本地产物中，目录替换或清理时可能受影响。',
        '逐项确认是否保留，并确认发布备份可用于恢复。'
      )
    )
  }
  if (modified > 0) {
    const ratio = total > 0 ? modified / total : 1
    const points = Math.min(15, Math.max(3, Math.round(ratio * 15)))
    score += points
    factors.push(
      riskFactor(
        'modified-files',
        ratio >= 0.5 ? 'warning' : 'info',
        `将更新 ${modified} 个文件`,
        total > 0 ? `约占预检文件的 ${Math.round(ratio * 100)}%。` : '修改范围需要人工核对。',
        '确认构建版本、变更清单与预期一致。'
      )
    )
  }
  if (onlyLocal > 0) {
    factors.push(
      riskFactor(
        'new-files',
        'info',
        `将新增 ${onlyLocal} 个文件`,
        '新增文件会进入目标目录。',
        '确认不包含临时文件、源码映射或本地配置。'
      )
    )
  }

  const recentFailures = history.filter((item) => item?.status === 'failed').length
  const recentRollbacks = history.filter(
    (item) => item?.status === 'rolled-back' || item?.action === 'rollback'
  ).length
  const successful = history.filter((item) => item?.status === 'success').length
  if (recentFailures > 0) {
    score += Math.min(20, 8 + recentFailures * 3)
    factors.push(
      riskFactor(
        'recent-failures',
        recentFailures >= 3 ? 'critical' : 'warning',
        `近期有 ${recentFailures} 次发布失败`,
        '同一环境近期失败会提高本次变更的不确定性。',
        '先核对失败原因是否已经关闭，并复用已验证的发布步骤。'
      )
    )
  }
  if (recentRollbacks > 0) {
    score += Math.min(15, 5 + recentRollbacks * 3)
    factors.push(
      riskFactor(
        'recent-rollbacks',
        'warning',
        `近期有 ${recentRollbacks} 次回滚记录`,
        '目标环境近期发生过发布恢复操作。',
        '确认当前远端基线与本次构建基线一致。'
      )
    )
  }
  if (!successful) {
    score += 8
    factors.push(
      riskFactor(
        'no-success-history',
        'warning',
        '缺少该环境的成功发布历史',
        '无法用本地历史证明当前发布配置曾成功运行。',
        '首次发布建议缩小范围并安排人工验证。'
      )
    )
  }

  score = Math.min(100, Math.round(score))
  const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low'
  const levelLabel = { high: '高风险', medium: '需注意', low: '低风险' }[level]
  const verificationChecklist = [
    '确认目标环境、远端目录和本地构建版本正确。',
    '核对新增、修改和仅远程文件清单，排除临时文件与本地配置。',
    healthCheckEnabled
      ? '发布后观察健康检查结果，并验证核心业务入口。'
      : '发布后手动验证核心业务入口、接口和关键后台任务。',
    '确认发布日志、服务器日志和监控指标可在异常时快速定位。'
  ]
  const rollbackChecklist = [
    '确认发布前备份已生成且对应当前目标目录。',
    '记录当前稳定版本、构建标识和恢复负责人。',
    '准备在健康检查或人工验证失败时立即回滚。',
    '回滚后再次验证健康状态，并保留失败现场日志。'
  ]

  return {
    level,
    levelLabel,
    score,
    profileId,
    profileName,
    summary: `${levelLabel}（${score}/100）：${factors.filter((item) => item.level !== 'info').length} 个需要关注的风险因素。`,
    preflight: { total, onlyLocal, modified, onlyRemote },
    history: {
      checked: history.length,
      successful,
      failed: recentFailures,
      rolledBack: recentRollbacks
    },
    factors,
    verificationChecklist,
    rollbackChecklist,
    generatedAt: Date.now()
  }
}

module.exports = {
  buildCopilotTimeline,
  buildReleaseRiskSummary,
  formatCopilotTimeline,
  __testables: { normalizeSeverity, timelineTypeLabel }
}
