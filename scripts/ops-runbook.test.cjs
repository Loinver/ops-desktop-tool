const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  ALLOWED_STEP_TYPES,
  MAX_RUNBOOK_HISTORY,
  SOURCE_STEP_DEFINITIONS,
  appendRunbookHistory,
  buildRunbookPlan,
  executeRunbook,
  historyPath,
  loadRunbookHistory,
  normalizeOpsEvent
} = require('../src/main/utils/ops-runbook')

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-runbook-test-'))
}

function event(overrides = {}) {
  return {
    id: 'event-1',
    sourceType: 'automation',
    sourceId: 'task-1',
    severity: 'warning',
    title: '自动化巡检失败',
    description: '需要检查任务状态',
    attributes: {
      taskType: 'http-health',
      command: 'rm -rf /should-never-run',
      targetUrl: 'https://attacker.invalid/run'
    },
    ...overrides
  }
}

test('支持的事件来源映射到固定的诊断与复检步骤', () => {
  const aliases = { backup: 'data-backup' }
  for (const [sourceType, definition] of Object.entries(SOURCE_STEP_DEFINITIONS)) {
    const plan = buildRunbookPlan(event({ sourceType: aliases[sourceType] || sourceType }))
    assert.equal(plan.event.sourceType, sourceType)
    assert.equal(plan.executable, true)
    assert.equal(plan.requiresConfirmation, true)
    assert.deepEqual(
      plan.steps.map((step) => [step.phase, step.type, step.handlerKey]),
      [
        ['action', definition.actionType, definition.actionHandler],
        ['verification', definition.verificationType, definition.verificationHandler]
      ]
    )
    assert.ok(plan.steps.every((step) => ALLOWED_STEP_TYPES.has(step.type)))
    assert.equal(JSON.stringify(plan).includes('targetUrl'), false)
    assert.equal(JSON.stringify(plan).includes('command'), false)
  }
})

test('可执行 Runbook 必须显式确认，未确认时不调用处理器', async () => {
  const userDataPath = createTempDir()
  const calls = []
  const handlers = {
    'automation.diagnose': async () => calls.push('action'),
    'automation.recheck': async () => calls.push('recheck')
  }
  try {
    const guided = await executeRunbook({ userDataPath, event: event(), handlers, now: 100 })
    assert.equal(guided.status, 'guided')
    assert.equal(guided.confirmationRequired, true)
    assert.deepEqual(calls, [])

    const executed = await executeRunbook({
      userDataPath,
      event: event(),
      handlers,
      confirmed: true,
      now: 200
    })
    assert.equal(executed.status, 'succeeded')
    assert.equal(executed.confirmationRequired, false)
    assert.deepEqual(calls, ['action', 'recheck'])
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('渲染层篡改步骤会被拒绝，服务端不会执行篡改后的处理器', async () => {
  const userDataPath = createTempDir()
  const calls = []
  const plan = buildRunbookPlan(event())
  const tamperedPlan = structuredClone(plan)
  tamperedPlan.steps[0].handlerKey = 'shell.execute'
  tamperedPlan.steps[0].input = { command: 'echo unsafe' }
  try {
    const result = await executeRunbook({
      userDataPath,
      event: event(),
      plan: tamperedPlan,
      handlers: {
        'automation.diagnose': () => calls.push('safe'),
        'shell.execute': () => calls.push('unsafe')
      },
      confirmed: true,
      now: 300
    })
    assert.equal(result.planRejected, true)
    assert.equal(result.status, 'failed')
    assert.equal(result.summary.failed, 1)
    assert.deepEqual(calls, [])
    assert.equal(loadRunbookHistory(userDataPath).runs[0].planRejected, true)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('先完整执行 action phase，再执行 verification/recheck phase', async () => {
  const userDataPath = createTempDir()
  const calls = []
  try {
    const result = await executeRunbook({
      userDataPath,
      event: event({ sourceType: 'node-service', sourceId: 'tcp:3000' }),
      confirmed: true,
      now: 400,
      handlers: {
        'node-service.diagnose': async () => {
          calls.push('action')
          await Promise.resolve()
          calls.push('action-done')
        },
        'node-service.recheck': async () => calls.push('recheck')
      }
    })
    assert.equal(result.status, 'succeeded')
    assert.deepEqual(calls, ['action', 'action-done', 'recheck'])
    assert.deepEqual(
      [...result.actionResults, ...result.verificationResults].map((item) => item.phase),
      ['action', 'verification']
    )
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('任一处理器失败会聚合为 failed，并仍然执行复检', async () => {
  const userDataPath = createTempDir()
  const calls = []
  try {
    const result = await executeRunbook({
      userDataPath,
      event: event({ sourceType: 'release', sourceId: 'production' }),
      confirmed: true,
      now: 500,
      handlers: {
        'release.diagnose': async () => {
          calls.push('action')
          return { ok: false, message: 'diagnostic failed' }
        },
        'release.recheck': async () => {
          calls.push('recheck')
          return { guided: true, message: 'manual verification required' }
        }
      }
    })
    assert.deepEqual(calls, ['action', 'recheck'])
    assert.equal(result.status, 'failed')
    assert.deepEqual(result.summary, {
      total: 2,
      succeeded: 0,
      failed: 1,
      guided: 1,
      status: 'failed'
    })
    assert.equal(result.verificationResults[0].status, 'guided')
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('Runbook 历史按固定上限保存，并限制每条记录的步骤与消息大小', () => {
  const userDataPath = createTempDir()
  try {
    for (let index = 0; index < MAX_RUNBOOK_HISTORY + 10; index += 1) {
      appendRunbookHistory(userDataPath, {
        id: `run-${index}`,
        planId: 'plan-1',
        sourceType: 'automation',
        sourceId: 'task-1',
        status: 'succeeded',
        actionResults: Array.from({ length: 30 }, (_, stepIndex) => ({
          stepId: `action-${stepIndex}`,
          type: 'automation-diagnostic',
          phase: 'action',
          status: 'succeeded',
          message: 'x'.repeat(2_000)
        })),
        verificationResults: Array.from({ length: 30 }, (_, stepIndex) => ({
          stepId: `verification-${stepIndex}`,
          type: 'automation-recheck',
          phase: 'verification',
          status: 'guided',
          message: 'y'.repeat(2_000)
        }))
      })
    }
    const history = loadRunbookHistory(userDataPath)
    assert.equal(history.version, 1)
    assert.equal(history.runs.length, MAX_RUNBOOK_HISTORY)
    assert.equal(history.runs[0].id, `run-${MAX_RUNBOOK_HISTORY + 9}`)
    assert.ok(
      history.runs[0].actionResults.length + history.runs[0].verificationResults.length <= 20
    )
    assert.ok(history.runs[0].actionResults.every((item) => item.message.length <= 500))
    assert.ok(fs.statSync(historyPath(userDataPath)).size < 1_000_000)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('事件规范化只保留用于诊断的有界字段', () => {
  const normalized = normalizeOpsEvent(event({ sourceType: 'copilot' }))
  assert.equal(normalized.sourceType, 'copilot')
  assert.deepEqual(normalized.attributes, { taskType: 'http-health' })
})
