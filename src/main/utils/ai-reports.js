const MAX_TEXT_LENGTH = 1000

function text(value, max = MAX_TEXT_LENGTH) {
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

function redact(value, redactor, max = MAX_TEXT_LENGTH) {
  const normalized = text(value, max)
  return typeof redactor === 'function' ? text(redactor(normalized), max) : normalized
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

function isoTime(value) {
  const normalized = timestamp(value)
  return normalized ? new Date(normalized).toISOString() : '待补充'
}

function durationLabel(start, end) {
  const startedAt = timestamp(start)
  const finishedAt = timestamp(end)
  if (!startedAt || !finishedAt || finishedAt < startedAt) return '待补充'
  const minutes = Math.max(0, Math.round((finishedAt - startedAt) / 60_000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return `${hours} 小时${remainder ? ` ${remainder} 分钟` : ''}`
}

function timelineItems(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []
}

function incidentAction(id, priority, title, detail) {
  return { id, priority, title, detail, owner: '待分配', status: '待处理' }
}

function normalizeIncidentTimeline(event, timeline, redactor) {
  const eventId = text(event.id, 100)
  const sourceType = text(event.sourceType || event.category, 60) || 'system'
  const severity = normalizeSeverity(event.severity || event.level)
  const firstOccurredAt = timestamp(event.firstOccurredAt || event.createdAt || event.updatedAt)
  const lastOccurredAt =
    timestamp(event.resolvedAt || event.recoveredAt || event.lastOccurredAt || event.updatedAt) ||
    firstOccurredAt
  const ownTimeline = (Array.isArray(event.timeline) ? event.timeline : [])
    .map((item) => ({
      id: text(item?.id, 100) || `event:${timestamp(item?.createdAt)}`,
      kind: 'event',
      sourceType,
      sourceLabel: sourceType,
      timestamp: timestamp(item?.createdAt),
      severity,
      status: text(event.status, 60),
      title: timelineTypeLabel(item?.type),
      detail: redact(item?.message || '状态已更新', redactor),
      reference: { eventId }
    }))
    .filter((item) => item.timestamp)
  const related = timelineItems(timeline)
    .filter((item) => {
      const itemTime = timestamp(item?.timestamp)
      if (!itemTime) return false
      if (text(item?.reference?.eventId, 100) === eventId) return true
      return (
        text(item?.sourceType, 60) === sourceType &&
        itemTime >= firstOccurredAt - 6 * 60 * 60_000 &&
        itemTime <= lastOccurredAt + 6 * 60 * 60_000
      )
    })
    .map((item) => ({
      id: text(item?.id, 180),
      kind: text(item?.kind, 40) || 'system',
      sourceType: text(item?.sourceType, 60) || 'system',
      sourceLabel: redact(item?.sourceLabel || item?.sourceType || '系统', redactor),
      timestamp: timestamp(item?.timestamp),
      severity: normalizeSeverity(item?.severity),
      status: text(item?.status, 60),
      title: redact(item?.title || '运维记录', redactor),
      detail: redact(item?.detail, redactor),
      reference: item?.reference && typeof item.reference === 'object' ? item.reference : {}
    }))
  const deduplicated = new Map()
  for (const item of [...ownTimeline, ...related]) {
    const key = item.id || `${item.kind}:${item.timestamp}:${item.title}`
    if (!deduplicated.has(key)) deduplicated.set(key, item)
  }
  return [...deduplicated.values()]
    .sort((first, second) => first.timestamp - second.timestamp)
    .slice(-30)
}

function buildIncidentPostmortem({
  event = {},
  timeline = [],
  redact: redactor,
  generatedAt = Date.now()
} = {}) {
  const eventId = text(event.id, 100)
  if (!eventId) throw new Error('事件不存在或已被移除')
  const sourceType = text(event.sourceType || event.category, 60) || 'system'
  const severity = normalizeSeverity(event.severity || event.level)
  const firstOccurredAt =
    timestamp(event.firstOccurredAt || event.createdAt || event.updatedAt) || generatedAt
  const lastOccurredAt =
    timestamp(event.resolvedAt || event.recoveredAt || event.lastOccurredAt || event.updatedAt) ||
    firstOccurredAt
  const incidentTimeline = normalizeIncidentTimeline(event, timeline, redactor)
  const occurrenceCount = Math.max(1, finiteNumber(event.occurrenceCount, 1))
  const resolved = text(event.status, 60) === 'resolved'
  const recovered = timestamp(event.recoveredAt) > 0
  const resolutionNote = redact(event.resolutionNote, redactor, 500)
  const description = redact(event.description, redactor)
  const evidence = Array.from(
    new Set(
      [description, resolutionNote, ...incidentTimeline.map((item) => item.detail)]
        .map((item) => text(item, 500))
        .filter(Boolean)
    )
  ).slice(0, 12)
  const contributingFactors = []
  if (occurrenceCount > 1)
    contributingFactors.push(`事件在本地记录中重复发生 ${occurrenceCount} 次。`)
  if (!event.acknowledgedAt) contributingFactors.push('未记录明确的人工确认时间。')
  if (!resolutionNote) contributingFactors.push('尚未填写处理结果或恢复说明。')
  if (!resolved) contributingFactors.push('事件当前仍未标记为已解决。')
  if (recovered) contributingFactors.push('事件由自动恢复关闭，需要确认恢复是否稳定。')
  if (!contributingFactors.length) contributingFactors.push('现有记录未显示明确的附加促成因素。')
  const actions = [
    incidentAction(
      'confirm-root-cause',
      'high',
      '确认根因与证据链',
      '补充能够复现或证伪根因的日志、监控、变更和配置证据，区分事实与推测。'
    ),
    incidentAction(
      'verify-recovery',
      severity === 'critical' ? 'high' : 'medium',
      '验证恢复稳定性',
      '确认核心入口、健康检查、后台任务和关键指标恢复，并记录观察窗口。'
    ),
    incidentAction(
      'update-runbook',
      'medium',
      '更新 Runbook 与知识库',
      '将已验证的检测、处置、回滚和验证步骤沉淀为可复用文档。'
    )
  ]
  if (occurrenceCount > 1)
    actions.push(
      incidentAction(
        'prevent-recurrence',
        'high',
        '制定防复发措施',
        '针对重复触发补充长期修复、自动化校验和完成标准。'
      )
    )
  const title = `事件复盘：${redact(event.title || '运维事件', redactor, 160)}`
  const rootCause = resolutionNote
    ? `当前处理记录：${resolutionNote}。该描述可作为调查线索，仍需用证据确认是否为根因。`
    : '现有本地证据不足以确认根因，必须补充日志、变更和复现证据。'
  const markdown = [
    `# ${title}`,
    '',
    `- 事件编号：${eventId}`,
    `- 来源：${redact(sourceType, redactor, 60)}`,
    `- 严重级别：${severity}`,
    `- 当前状态：${text(event.status, 60) || 'open'}`,
    `- 首次发生：${isoTime(firstOccurredAt)}`,
    `- 最近结束/更新：${isoTime(lastOccurredAt)}`,
    `- 持续时间：${durationLabel(firstOccurredAt, lastOccurredAt)}`,
    `- 累计发生：${occurrenceCount} 次`,
    '',
    '## 事件摘要',
    description || '待补充事件现象、影响范围和触发条件。',
    '',
    '## 影响评估',
    `本地记录显示该事件为 ${severity} 级别，累计发生 ${occurrenceCount} 次。具体用户影响、受影响服务和数据完整性仍需人工确认。`,
    '',
    '## 时间线',
    ...(incidentTimeline.length
      ? incidentTimeline.map(
          (item) =>
            `- ${isoTime(item.timestamp)} [${item.sourceLabel}] ${item.title}${item.detail ? `：${item.detail}` : ''}`
        )
      : ['- 暂无可用时间线。']),
    '',
    '## 根因分析',
    rootCause,
    '',
    '### 当前证据',
    ...(evidence.length ? evidence.map((item) => `- ${item}`) : ['- 待补充。']),
    '',
    '### 促成因素',
    ...contributingFactors.map((item) => `- ${item}`),
    '',
    '## 处置与恢复',
    resolutionNote || '待补充已执行的缓解、回滚、恢复和验证步骤。',
    '',
    '## 后续行动',
    ...actions.map(
      (item) => `- [ ] [${item.priority}] ${item.title}（负责人：${item.owner}）— ${item.detail}`
    ),
    '',
    '> 本草稿由本地记录生成。根因、影响和行动项必须由负责人复核后再归档。'
  ].join('\n')
  return {
    id: `postmortem:${eventId}:${generatedAt}`,
    eventId,
    title,
    severity,
    status: text(event.status, 60) || 'open',
    sourceType,
    generatedAt,
    period: {
      from: firstOccurredAt,
      to: lastOccurredAt,
      duration: durationLabel(firstOccurredAt, lastOccurredAt)
    },
    summary: description || '待补充事件摘要。',
    impact: `事件为 ${severity} 级别，累计发生 ${occurrenceCount} 次；具体用户影响待确认。`,
    rootCause,
    rootCauseStatus: 'needs-review',
    evidence,
    contributingFactors,
    timeline: incidentTimeline,
    actions,
    markdown
  }
}

function reportRange(kind, from, to, now = Date.now()) {
  const normalizedKind = ['daily', 'weekly', 'handoff'].includes(kind) ? kind : 'daily'
  const end = timestamp(to) || now
  const spans = {
    daily: 24 * 60 * 60_000,
    weekly: 7 * 24 * 60 * 60_000,
    handoff: 12 * 60 * 60_000
  }
  const requestedStart = timestamp(from)
  const start =
    requestedStart && requestedStart < end ? requestedStart : end - spans[normalizedKind]
  return { kind: normalizedKind, from: Math.max(0, start), to: end }
}

function inRange(value, range) {
  const itemTime = timestamp(value)
  return itemTime >= range.from && itemTime <= range.to
}

function buildOpsReport({
  kind = 'daily',
  from,
  to,
  events = [],
  releases = [],
  nodeHistory = [],
  runbooks = [],
  logs = [],
  redact: redactor,
  generatedAt = Date.now()
} = {}) {
  const range = reportRange(kind, from, to, generatedAt)
  const labels = { daily: '每日运维报告', weekly: '每周运维报告', handoff: '交接班报告' }
  const reportEvents = (Array.isArray(events) ? events : [])
    .filter((item) => inRange(item?.lastOccurredAt || item?.updatedAt || item?.createdAt, range))
    .slice(0, 100)
  const activeEvents = (Array.isArray(events) ? events : [])
    .filter((item) => text(item?.status, 60) !== 'resolved')
    .slice(0, 30)
  const reportReleases = (Array.isArray(releases) ? releases : [])
    .filter((item) => inRange(item?.finishedAt || item?.createdAt, range))
    .slice(0, 100)
  const reportNodes = (Array.isArray(nodeHistory) ? nodeHistory : [])
    .filter((item) => inRange(item?.checkedAt, range))
    .slice(0, 500)
  const reportRunbooks = (Array.isArray(runbooks) ? runbooks : [])
    .filter((item) => inRange(item?.finishedAt || item?.startedAt, range))
    .slice(0, 100)
  const reportLogs = (Array.isArray(logs) ? logs : [])
    .filter((item) => inRange(item?.createdAt || item?.analyzedAt, range))
    .slice(0, 100)
  const releaseStatuses = reportReleases.reduce((result, item) => {
    const status = text(item?.status, 40) || 'unknown'
    result[status] = (result[status] || 0) + 1
    return result
  }, {})
  const nodeServices = new Set(
    reportNodes.map((item) => text(item?.serviceId, 120)).filter(Boolean)
  )
  const offlineServices = new Set(
    reportNodes
      .filter((item) => text(item?.state, 40) === 'offline')
      .map((item) => text(item?.serviceId, 120))
      .filter(Boolean)
  )
  const findingCount = reportLogs.reduce(
    (sum, item) =>
      sum +
      (Array.isArray(item?.findings)
        ? item.findings.reduce(
            (count, finding) => count + Math.max(0, finiteNumber(finding?.count)),
            0
          )
        : 0),
    0
  )
  const metrics = {
    events: {
      total: reportEvents.length,
      critical: reportEvents.filter(
        (item) => normalizeSeverity(item?.severity || item?.level) === 'critical'
      ).length,
      resolved: reportEvents.filter((item) => text(item?.status, 60) === 'resolved').length,
      active: activeEvents.length
    },
    releases: {
      total: reportReleases.length,
      success: releaseStatuses.success || 0,
      failed: releaseStatuses.failed || 0,
      rolledBack: releaseStatuses['rolled-back'] || 0
    },
    nodes: {
      checks: reportNodes.length,
      services: nodeServices.size,
      offlineServices: offlineServices.size
    },
    runbooks: {
      total: reportRunbooks.length,
      failed: reportRunbooks.filter((item) => text(item?.status, 40) === 'failed').length,
      guided: reportRunbooks.filter((item) => text(item?.status, 40) === 'guided').length
    },
    logs: { analyses: reportLogs.length, findings: findingCount }
  }
  const risks = []
  if (activeEvents.length) risks.push(`仍有 ${activeEvents.length} 个活跃事件需要交接或继续处理。`)
  if (metrics.events.critical) risks.push(`报告期内记录了 ${metrics.events.critical} 个严重事件。`)
  if (metrics.releases.failed || metrics.releases.rolledBack)
    risks.push(
      `报告期内发布失败 ${metrics.releases.failed} 次、回滚 ${metrics.releases.rolledBack} 次。`
    )
  if (offlineServices.size) risks.push(`Node 监控记录到 ${offlineServices.size} 个服务离线。`)
  if (metrics.runbooks.failed) risks.push(`有 ${metrics.runbooks.failed} 次 Runbook 执行失败。`)
  if (findingCount) risks.push(`日志分析累计识别 ${findingCount} 条异常线索。`)
  if (!risks.length) risks.push('本地记录未显示需要升级的高优先级风险。')
  const actions = activeEvents.slice(0, 10).map((item) => ({
    id: `event:${text(item?.id, 100)}`,
    priority: normalizeSeverity(item?.severity || item?.level) === 'critical' ? 'high' : 'medium',
    title: redact(item?.title || '运维事件', redactor, 160),
    detail: `${text(item?.status, 60) || 'open'} · ${redact(item?.description, redactor) || '待补充处理进展'}`,
    owner: '待交接',
    status: '待处理'
  }))
  if (!actions.length)
    actions.push({
      id: 'routine-review',
      priority: 'low',
      title: '完成例行复核',
      detail: '复核健康检查、发布结果和下一报告周期的计划变更。',
      owner: '待交接',
      status: '待处理'
    })
  const title = labels[range.kind]
  const eventLines = reportEvents
    .slice(0, 20)
    .map(
      (item) =>
        `- [${normalizeSeverity(item?.severity || item?.level)}][${text(item?.status, 60) || 'open'}] ${redact(item?.title || '运维事件', redactor, 160)} — ${redact(item?.description, redactor) || '无补充说明'}`
    )
  const releaseLines = reportReleases
    .slice(0, 20)
    .map(
      (item) =>
        `- [${text(item?.status, 40) || 'unknown'}] ${redact(item?.label || item?.profileName || '发布记录', redactor, 200)}（${isoTime(item?.finishedAt || item?.createdAt)}）`
    )
  const runbookLines = reportRunbooks
    .slice(0, 20)
    .map(
      (item) =>
        `- [${text(item?.status, 40) || 'unknown'}] ${redact(item?.title || item?.reason || item?.id || 'Runbook', redactor, 200)}（${isoTime(item?.finishedAt || item?.startedAt)}）`
    )
  const markdown = [
    `# ${title}`,
    '',
    `- 报告范围：${isoTime(range.from)} 至 ${isoTime(range.to)}`,
    `- 生成时间：${isoTime(generatedAt)}`,
    '',
    '## 摘要指标',
    `- 事件：${metrics.events.total} 个（严重 ${metrics.events.critical}、已解决 ${metrics.events.resolved}、当前活跃 ${metrics.events.active}）`,
    `- 发布：${metrics.releases.total} 次（成功 ${metrics.releases.success}、失败 ${metrics.releases.failed}、回滚 ${metrics.releases.rolledBack}）`,
    `- Node 监控：${metrics.nodes.checks} 次采样，涉及 ${metrics.nodes.services} 个服务，离线 ${metrics.nodes.offlineServices} 个`,
    `- Runbook：${metrics.runbooks.total} 次（失败 ${metrics.runbooks.failed}、需引导 ${metrics.runbooks.guided}）`,
    `- 日志分析：${metrics.logs.analyses} 份，异常线索 ${metrics.logs.findings} 条`,
    '',
    '## 事件进展',
    ...(eventLines.length ? eventLines : ['- 报告期内无事件记录。']),
    '',
    '## 发布与变更',
    ...(releaseLines.length ? releaseLines : ['- 报告期内无发布记录。']),
    '',
    '## Runbook 执行',
    ...(runbookLines.length ? runbookLines : ['- 报告期内无 Runbook 执行记录。']),
    '',
    '## 风险与关注项',
    ...risks.map((item) => `- ${item}`),
    '',
    '## 下一步 / 交接事项',
    ...actions.map(
      (item) => `- [ ] [${item.priority}] ${item.title}（负责人：${item.owner}）— ${item.detail}`
    ),
    '',
    '> 本报告基于本机已保存的事件、发布、Node、Runbook 和日志分析记录生成；缺失的业务影响和人工处置应由值班人员补充。'
  ].join('\n')
  return {
    id: `ops-report:${range.kind}:${generatedAt}`,
    kind: range.kind,
    title,
    generatedAt,
    period: { from: range.from, to: range.to },
    metrics,
    risks,
    actions,
    markdown
  }
}

module.exports = {
  buildIncidentPostmortem,
  buildOpsReport,
  __testables: { durationLabel, normalizeIncidentTimeline, normalizeSeverity, reportRange }
}
