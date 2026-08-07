const assert = require('node:assert/strict')
const test = require('node:test')

const { modelRecheckOutcome, safeChangePayload } =
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
        results: [
          { providerId: 'provider-2', model: 'model-2', status: 'ok', message: '连接正常' }
        ]
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
