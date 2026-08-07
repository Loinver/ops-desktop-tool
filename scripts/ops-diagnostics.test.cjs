const assert = require('node:assert/strict')
const test = require('node:test')

const {
  DIAGNOSTIC_LIMITS,
  OPS_DIAGNOSTICS_SCHEMA,
  OPS_DIAGNOSTICS_VERSION,
  buildOpsDiagnosticsBundle,
  redactDiagnosticText,
  redactDiagnosticValue
} = require('../src/main/utils/ops-diagnostics')

test('递归移除嵌套 secret-like 字段、Provider 配置、Prompt 和知识内容', () => {
  const bundle = buildOpsDiagnosticsBundle({
    generatedAt: 123,
    app: {
      version: '1.2.3',
      providerConfig: { apiKey: 'sk-provider-secret' },
      prompt: '不要导出这段 prompt'
    },
    events: {
      items: [
        {
          id: 'event-1',
          attributes: {
            safeMetric: 7,
            nested: {
              safeLabel: '保留',
              password: 'password-secret',
              tokens: ['token-secret'],
              providerConfig: { endpoint: 'https://provider.example', apiKey: 'sk-secret' },
              knowledge: { content: 'knowledge-content-secret' }
            }
          },
          description: 'authorization: Bearer token-secret password-secret'
        }
      ]
    },
    auditRecords: [
      {
        id: 'audit-1',
        metadata: { safe: true, refreshToken: 'refresh-secret', nested: { count: 2 } }
      }
    ]
  })

  const serialized = JSON.stringify(bundle)
  assert.doesNotMatch(
    serialized,
    /sk-provider-secret|password-secret|token-secret|knowledge-content-secret/
  )
  assert.deepEqual(bundle.events.items[0].attributes, {
    safeMetric: 7,
    nested: { safeLabel: '保留' }
  })
  assert.deepEqual(bundle.auditRecords[0].metadata, { safe: true, nested: { count: 2 } })
  assert.equal('providerConfig' in bundle.app, false)
  assert.equal('prompt' in bundle.app, false)

  const redacted = redactDiagnosticValue({ safe: 1, nested: { apiKey: 'secret', value: 'ok' } })
  assert.deepEqual(redacted, { safe: 1, nested: { value: 'ok' } })
})

test('文本移除 URL 凭据、敏感查询参数、凭据模式和绝对 home 路径', () => {
  const text = redactDiagnosticText(
    'connect https://alice:password@example.test/api?token=query-secret&region=us ' +
      'and https://example.test/?api_key=key-secret&view=full ' +
      'and sftp://deploy:password@files.example/ops?secret=secret-value&host=prod ' +
      'from /Users/alice/Library/Application Support/ops/config.json ' +
      'or C:\\Users\\alice\\AppData\\Local\\ops\\state.json ' +
      'backup path /tmp/ops-backups/archive.zip ' +
      'with apiKey=assignment-secret ' +
      'Authorization: Token authorization-secret ' +
      'node --token cli-secret --password=cli-password'
  )

  assert.match(text, /https:\/\/example\.test\/api\?region=us/)
  assert.match(text, /https:\/\/example\.test\/\?view=full/)
  assert.match(text, /sftp:\/\/files\.example\/ops\?host=prod/)
  assert.match(text, /\[HOME\]/)
  assert.doesNotMatch(
    text,
    /alice:password|query-secret|key-secret|assignment-secret|authorization-secret|cli-secret|cli-password/
  )
  assert.doesNotMatch(text, /\/Users\/alice|C:\\Users\\alice/)
  assert.doesNotMatch(text, /\/tmp\/ops-backups/)
  assert.doesNotMatch(text, /apiKey=/i)
})

test('所有诊断集合和嵌套历史均有上限', () => {
  const bundle = buildOpsDiagnosticsBundle({
    events: [
      ...Array.from({ length: DIAGNOSTIC_LIMITS.eventItems + 10 }, (_, index) => ({
        id: `event-${index}`,
        timeline: Array.from({ length: DIAGNOSTIC_LIMITS.eventTimeline + 5 }, (_, item) => ({
          id: `${index}-${item}`
        })),
        attributes: Object.fromEntries(
          Array.from({ length: DIAGNOSTIC_LIMITS.eventAttributes + 5 }, (_, item) => [
            `metric-${item}`,
            item
          ])
        )
      }))
    ],
    automationTasks: Array.from({ length: DIAGNOSTIC_LIMITS.automationTasks + 10 }, () => ({
      id: 'task'
    })),
    modelMonitor: {
      targets: Array.from({ length: DIAGNOSTIC_LIMITS.modelTargets + 10 }, () => ({
        providerId: 'provider',
        model: 'model'
      }))
    },
    modelHistory: Array.from({ length: DIAGNOSTIC_LIMITS.modelHistory + 10 }, () => ({
      results: Array.from({ length: DIAGNOSTIC_LIMITS.modelResults + 5 }, () => ({
        model: 'model'
      }))
    })),
    nodeWatches: Array.from({ length: DIAGNOSTIC_LIMITS.nodeWatches + 10 }, () => ({
      id: 'watch'
    })),
    nodeHistory: Array.from({ length: DIAGNOSTIC_LIMITS.nodeHistory + 10 }, () => ({
      id: 'history'
    })),
    releaseHistory: Array.from({ length: DIAGNOSTIC_LIMITS.releaseHistory + 10 }, () => ({
      id: 'release'
    })),
    auditRecords: Array.from({ length: DIAGNOSTIC_LIMITS.auditRecords + 10 }, () => ({
      id: 'audit'
    })),
    logEntries: Array.from({ length: DIAGNOSTIC_LIMITS.logEntries + 10 }, () => ({
      findings: Array.from({ length: DIAGNOSTIC_LIMITS.logFindings + 5 }, () => ({ type: 'error' }))
    }))
  })

  assert.equal(bundle.events.items.length, DIAGNOSTIC_LIMITS.eventItems)
  assert.equal(bundle.events.items[0].timeline.length, DIAGNOSTIC_LIMITS.eventTimeline)
  assert.equal(
    Object.keys(bundle.events.items[0].attributes).length,
    DIAGNOSTIC_LIMITS.eventAttributes
  )
  assert.equal(bundle.automationTasks.length, DIAGNOSTIC_LIMITS.automationTasks)
  assert.equal(bundle.modelMonitor.targets.length, DIAGNOSTIC_LIMITS.modelTargets)
  assert.equal(bundle.modelHistory.length, DIAGNOSTIC_LIMITS.modelHistory)
  assert.equal(bundle.modelHistory[0].results.length, DIAGNOSTIC_LIMITS.modelResults)
  assert.equal(bundle.nodeWatches.length, DIAGNOSTIC_LIMITS.nodeWatches)
  assert.equal(bundle.nodeHistory.length, DIAGNOSTIC_LIMITS.nodeHistory)
  assert.equal(bundle.releaseHistory.length, DIAGNOSTIC_LIMITS.releaseHistory)
  assert.equal(bundle.auditRecords.length, DIAGNOSTIC_LIMITS.auditRecords)
  assert.equal(bundle.logEntries.length, DIAGNOSTIC_LIMITS.logEntries)
  assert.equal(bundle.logEntries[0].findings.length, DIAGNOSTIC_LIMITS.logFindings)
})

test('保留允许的运维指标，同时严格丢弃路径、配置和原始内容', () => {
  const bundle = buildOpsDiagnosticsBundle({
    generatedAt: '2026-08-07T00:00:00.000Z',
    app: {
      version: '2.0.0',
      platform: 'darwin',
      arch: 'arm64',
      electronVersion: '43.2.0',
      nodeVersion: '24.0.0',
      isPackaged: true,
      userDataPath: '/Users/alice/secret'
    },
    system: {
      platform: 'darwin',
      arch: 'arm64',
      release: '24.6.0',
      cpuCount: 8,
      memoryTotalBytes: 16_000,
      memoryFreeBytes: 8_000,
      loadAverage: [1, 2, 3],
      hostname: 'private-host'
    },
    eventSummary: { total: 4, active: 2, critical: 1, warning: 1 },
    events: [{ id: 'event-1', severity: 'critical', status: 'open', occurrenceCount: 3 }],
    automationTasks: [
      {
        id: 'task-1',
        name: '健康检查',
        enabled: true,
        intervalMinutes: 15,
        nextRunAt: 200,
        lastResult: { ok: false, durationMs: 80, errorCount: 1, prompt: 'private prompt' },
        command: 'node private-script.js'
      }
    ],
    modelMonitor: {
      enabled: true,
      intervalMinutes: 60,
      notifyOnFailure: true,
      targets: [
        { providerId: 'provider-1', providerName: 'Provider', appType: 'chat', model: 'model-1' }
      ],
      endpoint: 'https://provider.example/private'
    },
    modelHistory: [
      {
        id: 'model-run-1',
        source: 'scheduled',
        finishedAt: 300,
        summary: { total: 3, ok: 2, failed: 1, gateway: 0, durationMs: 120 },
        results: [
          { model: 'model-1', status: 'ok', durationMs: 40, message: 'raw provider response' }
        ]
      }
    ],
    nodeWatches: [
      {
        id: 'TCP:3000',
        protocol: 'TCP',
        port: 3000,
        enabled: true,
        lastState: 'online',
        commandLabel: 'node server.js --token command-secret',
        command: 'node server.js --password command-password'
      }
    ],
    nodeHistory: [{ watchId: 'TCP:3000', state: 'online', checkedAt: 400, pid: 42 }],
    backupHealth: {
      status: 'healthy',
      checkedAt: 500,
      freeBytes: 4_000,
      missingCount: 0,
      outputDirectory: '/Users/alice/backups',
      issues: []
    },
    releaseHistory: [
      {
        id: 'release-1',
        action: 'deploy',
        status: 'success',
        entryCount: 12,
        zipSize: 800,
        backupPath: '/Users/alice/backups/release.zip'
      }
    ],
    auditRecords: [
      {
        id: 'audit-1',
        action: 'deploy',
        status: 'success',
        durationMs: 90,
        metadata: { targetCount: 1, apiKey: 'secret' }
      }
    ],
    logEntries: [
      {
        id: 'log-1',
        level: 'warning',
        rawLength: 200,
        lineCount: 4,
        message: '检查完成',
        content: 'raw knowledge or prompt content'
      }
    ]
  })

  assert.deepEqual(bundle.schema, OPS_DIAGNOSTICS_SCHEMA)
  assert.equal(bundle.version, OPS_DIAGNOSTICS_VERSION)
  assert.equal(bundle.generatedAt, '2026-08-07T00:00:00.000Z')
  assert.deepEqual(bundle.app, {
    version: '2.0.0',
    platform: 'darwin',
    arch: 'arm64',
    electronVersion: '43.2.0',
    nodeVersion: '24.0.0',
    isPackaged: true
  })
  assert.deepEqual(bundle.system, {
    platform: 'darwin',
    arch: 'arm64',
    release: '24.6.0',
    cpuCount: 8,
    memoryTotalBytes: 16_000,
    memoryFreeBytes: 8_000,
    loadAverage: [1, 2, 3]
  })
  assert.deepEqual(bundle.events.summary, { total: 4, active: 2, critical: 1, warning: 1 })
  assert.deepEqual(bundle.automationTasks[0].lastResult, {
    ok: false,
    durationMs: 80,
    errorCount: 1
  })
  assert.deepEqual(bundle.modelMonitor.targets[0], {
    providerId: 'provider-1',
    providerName: 'Provider',
    appType: 'chat',
    model: 'model-1'
  })
  assert.deepEqual(bundle.modelHistory[0].summary, {
    total: 3,
    ok: 2,
    failed: 1,
    gateway: 0,
    durationMs: 120
  })
  assert.equal('commandLabel' in bundle.nodeWatches[0], false)
  assert.equal('command' in bundle.nodeWatches[0], false)
  assert.deepEqual(bundle.backupHealth, {
    status: 'healthy',
    checkedAt: 500,
    freeBytes: 4_000,
    missingCount: 0,
    issues: []
  })
  assert.equal(bundle.releaseHistory[0].entryCount, 12)
  assert.equal(bundle.releaseHistory[0].zipSize, 800)
  assert.equal('backupPath' in bundle.releaseHistory[0], false)
  assert.deepEqual(bundle.auditRecords[0].metadata, { targetCount: 1 })
  assert.equal(bundle.logEntries[0].message, '检查完成')
  assert.equal('content' in bundle.logEntries[0], false)
  assert.equal(JSON.stringify(bundle).includes('/Users/alice'), false)
  assert.doesNotMatch(JSON.stringify(bundle), /command-secret|command-password/)
})
