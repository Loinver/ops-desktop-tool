const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { modelRecheckOutcome, safeChangePayload, saveMaintenanceSettings } =
  require('../src/main/ipc/ops-platform').__testables

const event = {
  attributes: {
    providerId: 'provider-1',
    model: 'model-1'
  }
}

test('模型 Runbook 只在原事件目标复检成功时通过', () => {
  assert.deepEqual(
    modelRecheckOutcome(
      {
        summary: { ok: 1, failed: 0, gateway: 0 },
        results: [
          {
            providerId: 'provider-1',
            model: 'model-1',
            status: 'ok',
            message: '连接正常'
          }
        ]
      },
      event
    ),
    {
      ok: true,
      message: 'model-1：连接正常'
    }
  )
})

test('模型 Runbook 不会用其他目标全绿结果关闭未覆盖的原事件', () => {
  assert.deepEqual(
    modelRecheckOutcome(
      {
        summary: { ok: 2, failed: 0, gateway: 0 },
        results: [{ providerId: 'provider-2', model: 'model-2', status: 'ok', message: '连接正常' }]
      },
      event
    ),
    {
      ok: false,
      message: '本次巡检未覆盖原事件目标，事件不会自动关闭'
    }
  )
})

test('模型 Runbook 保留原事件目标的失败状态', () => {
  assert.deepEqual(
    modelRecheckOutcome(
      {
        summary: { ok: 0, failed: 1, gateway: 0 },
        results: [
          {
            providerId: 'provider-1',
            model: 'model-1',
            status: 'failed',
            message: '请求失败'
          }
        ]
      },
      event
    ),
    {
      ok: false,
      message: 'model-1：请求失败'
    }
  )
})

test('发往 Renderer 的实时变更信号不携带自由文本或敏感字段', () => {
  assert.deepEqual(
    safeChangePayload({
      kind: 'automation-run',
      sourceType: 'automation',
      sourceId: 'task-1',
      eventId: 'event-1',
      severity: 'warning',
      status: 'failed',
      updatedAt: 123,
      command: 'node --token secret',
      error: '/Users/operator/private'
    }),
    {
      kind: 'automation-run',
      sourceType: 'automation',
      sourceId: 'task-1',
      eventId: 'event-1',
      severity: 'warning',
      status: 'failed',
      updatedAt: 123
    }
  )
})

test('维护窗口启用、缩短或关闭后都会立即重排自动备份', () => {
  const currentUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-platform-maintenance-'))
  const calls = []
  const now = Date.now()
  const rescheduleAutoBackup = () => calls.push(Date.now())

  try {
    const active = saveMaintenanceSettings({
      currentUserDataPath,
      settings: {
        enabled: true,
        confirmed: true,
        startAt: now - 1_000,
        endAt: now + 60_000,
        reason: '数据库维护'
      },
      rescheduleAutoBackup
    })
    assert.equal(active.status, 'active')

    const shortened = saveMaintenanceSettings({
      currentUserDataPath,
      settings: {
        enabled: true,
        confirmed: true,
        startAt: now - 1_000,
        endAt: now + 30_000,
        reason: '提前完成'
      },
      rescheduleAutoBackup
    })
    assert.equal(shortened.resumeAt, now + 30_000)

    const disabled = saveMaintenanceSettings({
      currentUserDataPath,
      settings: { enabled: false },
      rescheduleAutoBackup
    })
    assert.equal(disabled.status, 'disabled')
    assert.equal(calls.length, 3)
  } finally {
    fs.rmSync(currentUserDataPath, { recursive: true, force: true })
  }
})

test('未确认的维护窗口不会保存或触发自动备份重排', () => {
  const currentUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-platform-maintenance-'))
  let calls = 0
  try {
    assert.throws(
      () =>
        saveMaintenanceSettings({
          currentUserDataPath,
          settings: {
            enabled: true,
            startAt: Date.now(),
            endAt: Date.now() + 60_000
          },
          rescheduleAutoBackup: () => {
            calls += 1
          }
        }),
      /必须完成确认/
    )
    assert.equal(calls, 0)
    assert.equal(
      fs.existsSync(path.join(currentUserDataPath, 'ops-maintenance-window.json')),
      false
    )
  } finally {
    fs.rmSync(currentUserDataPath, { recursive: true, force: true })
  }
})
