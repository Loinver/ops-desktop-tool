const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildCopilotTimeline,
  buildReleaseRiskSummary,
  formatCopilotTimeline
} = require('../src/main/utils/ai-insights')

test('Copilot 时间线合并事件、日志、发布、Node 与 Runbook 并按时间倒序', () => {
  const result = buildCopilotTimeline({
    events: [
      {
        id: 'event-1',
        sourceType: 'release',
        severity: 'critical',
        status: 'open',
        title: '发布异常',
        timeline: [
          { id: 'timeline-1', type: 'opened', message: 'token=secret-value', createdAt: 100 }
        ]
      }
    ],
    logs: [
      { id: 'log-1', title: '应用日志', level: 'medium', headline: '发现异常', createdAt: 200 }
    ],
    releases: [
      { id: 'release-1', label: 'web', status: 'success', profileName: '测试', finishedAt: 300 }
    ],
    nodeHistory: [
      { serviceId: 'TCP:3000', protocol: 'TCP', port: 3000, state: 'offline', checkedAt: 400 },
      { serviceId: 'TCP:3000', protocol: 'TCP', port: 3000, state: 'online', checkedAt: 500 }
    ],
    runbooks: [
      {
        id: 'run-1',
        status: 'guided',
        finishedAt: 600,
        summary: { total: 2, succeeded: 1, failed: 0, guided: 1 }
      }
    ],
    redact: (value) => value.replace('secret-value', '[redacted]')
  })

  assert.equal(result.items[0].kind, 'runbook')
  assert.equal(result.items.at(-1).kind, 'event')
  assert.equal(result.items.at(-1).detail, 'token=[redacted]')
  assert.equal(result.summary.critical >= 2, true)
  assert.match(formatCopilotTimeline(result), /关联时间线/)
  assert.match(formatCopilotTimeline(result), /Runbook/)
})

test('Node 连续相同状态仅保留状态变化与最新样本', () => {
  const result = buildCopilotTimeline({
    nodeHistory: [
      { serviceId: 'TCP:3000', protocol: 'TCP', port: 3000, state: 'online', checkedAt: 100 },
      { serviceId: 'TCP:3000', protocol: 'TCP', port: 3000, state: 'online', checkedAt: 200 },
      { serviceId: 'TCP:3000', protocol: 'TCP', port: 3000, state: 'offline', checkedAt: 300 }
    ]
  })
  assert.deepEqual(
    result.items.map((item) => item.timestamp),
    [300, 100]
  )
})

test('发布风险摘要识别生产环境、指纹、健康检查、仅远程文件和失败历史', () => {
  const result = buildReleaseRiskSummary({
    profile: { id: 'prod', name: '生产环境', healthCheck: { enabled: false } },
    preflight: { total: 20, onlyLocal: 2, modified: 10, onlyRemote: 6 },
    history: [
      { profileId: 'prod', status: 'failed', finishedAt: 300 },
      { profileId: 'prod', status: 'rolled-back', action: 'deploy', finishedAt: 200 }
    ]
  })

  assert.equal(result.level, 'high')
  assert.equal(result.score, 100)
  assert.equal(
    result.factors.some((item) => item.id === 'host-fingerprint'),
    true
  )
  assert.equal(
    result.factors.some((item) => item.id === 'health-check'),
    true
  )
  assert.equal(result.history.failed, 1)
  assert.equal(result.history.rolledBack, 1)
  assert.equal(result.verificationChecklist.length > 0, true)
  assert.equal(result.rollbackChecklist.length > 0, true)
})

test('具备指纹、健康检查和成功历史的小范围发布保持低风险', () => {
  const result = buildReleaseRiskSummary({
    profile: {
      id: 'staging',
      name: '预发布',
      hostFingerprint: 'SHA256:test',
      healthCheck: { enabled: true, autoRollback: true }
    },
    preflight: { total: 100, onlyLocal: 1, modified: 1, onlyRemote: 0 },
    history: [{ profileId: 'staging', status: 'success', finishedAt: 100 }]
  })

  assert.equal(result.level, 'low')
  assert.equal(result.score < 30, true)
  assert.equal(result.history.successful, 1)
})

const { buildIncidentPostmortem, buildOpsReport } = require('../src/main/utils/ai-reports')

test('事件复盘基于事件 ID 和关联时间线生成可审阅草稿，不把处理说明直接断言为根因', () => {
  const result = buildIncidentPostmortem({
    generatedAt: 10_000,
    event: {
      id: 'event-1',
      title: '发布异常',
      sourceType: 'release',
      severity: 'critical',
      status: 'resolved',
      description: '部署后接口超时，token=secret-value',
      resolutionNote: '回滚后恢复',
      occurrenceCount: 2,
      firstOccurredAt: 1_000,
      acknowledgedAt: 2_000,
      resolvedAt: 5_000,
      timeline: [
        { id: 'opened', type: 'opened', message: '检测到异常', createdAt: 1_000 },
        { id: 'resolved', type: 'resolved', message: 'token=secret-value', createdAt: 5_000 }
      ]
    },
    timeline: {
      items: [
        {
          id: 'release-1',
          kind: 'release',
          sourceType: 'release',
          sourceLabel: '系统发布',
          timestamp: 3_000,
          severity: 'critical',
          title: '发布失败',
          detail: '上游接口超时'
        }
      ]
    },
    redact: (value) => value.replace('secret-value', '[redacted]')
  })

  assert.equal(result.eventId, 'event-1')
  assert.equal(result.timeline.map((item) => item.timestamp).join(','), '1000,3000,5000')
  assert.equal(result.rootCauseStatus, 'needs-review')
  assert.match(result.rootCause, /仍需用证据确认/)
  assert.match(result.markdown, /\[redacted\]/)
  assert.doesNotMatch(result.markdown, /secret-value/)
  assert.equal(
    result.actions.some((item) => item.id === 'prevent-recurrence'),
    true
  )
})

test('运维报告按报告期汇总事件、发布、Node、Runbook 和日志并输出交接风险', () => {
  const now = Date.parse('2026-08-11T12:00:00.000Z')
  const inRange = now - 60 * 60_000
  const outside = now - 9 * 24 * 60 * 60_000
  const result = buildOpsReport({
    kind: 'weekly',
    generatedAt: now,
    events: [
      {
        id: 'event-active',
        status: 'open',
        severity: 'critical',
        title: '服务不可用',
        description: 'password=secret-value',
        lastOccurredAt: inRange
      },
      {
        id: 'event-old',
        status: 'resolved',
        severity: 'warning',
        title: '旧事件',
        lastOccurredAt: outside
      }
    ],
    releases: [
      { id: 'release-1', status: 'failed', label: '生产发布', finishedAt: inRange },
      { id: 'release-old', status: 'success', label: '旧发布', finishedAt: outside }
    ],
    nodeHistory: [
      { serviceId: 'TCP:3000', state: 'offline', checkedAt: inRange },
      { serviceId: 'TCP:3000', state: 'online', checkedAt: inRange - 1_000 }
    ],
    runbooks: [{ id: 'run-1', status: 'failed', finishedAt: inRange }],
    logs: [
      {
        id: 'log-1',
        createdAt: inRange,
        findings: [
          { type: 'error', count: 2 },
          { type: 'timeout', count: 1 }
        ]
      }
    ],
    redact: (value) => value.replace('secret-value', '[redacted]')
  })

  assert.equal(result.kind, 'weekly')
  assert.equal(result.metrics.events.total, 1)
  assert.equal(result.metrics.events.active, 1)
  assert.equal(result.metrics.releases.failed, 1)
  assert.equal(result.metrics.nodes.offlineServices, 1)
  assert.equal(result.metrics.runbooks.failed, 1)
  assert.equal(result.metrics.logs.findings, 3)
  assert.equal(result.risks.length >= 5, true)
  assert.match(result.markdown, /\[redacted\]/)
  assert.doesNotMatch(result.markdown, /secret-value/)
})
