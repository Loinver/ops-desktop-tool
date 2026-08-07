const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  buildOpsInsights,
  estimateTokens,
  loadOpsInsightsSettings,
  saveOpsInsightsSettings
} = require('../src/main/utils/ops-insights')

test('estimates token counts without exposing source content', () => {
  assert.equal(estimateTokens('12345'), 2)
  assert.equal(estimateTokens(''), 0)
})

test('builds model quality, estimated cost, release risk and node history insights', () => {
  const data = buildOpsInsights({
    generatedAt: 1000,
    modelHistory: [
      {
        finishedAt: 900,
        results: [
          {
            providerId: 'p1',
            providerName: 'Provider 1',
            appType: 'openai',
            model: 'model-a',
            status: 'ok',
            durationMs: 120
          },
          {
            providerId: 'p1',
            providerName: 'Provider 1',
            appType: 'openai',
            model: 'model-a',
            status: 'failed',
            durationMs: 80
          }
        ]
      }
    ],
    evaluationState: {
      cases: [{ id: 'case-1', prompt: '12345678', systemPrompt: '' }],
      runs: [
        {
          providerId: 'p1',
          providerName: 'Provider 1',
          model: 'model-a',
          finishedAt: 950,
          results: [{ id: 'case-1', ok: true, durationMs: 200, answer: '1234' }]
        }
      ]
    },
    settings: {
      pricing: [
        {
          providerId: 'p1',
          providerName: 'Provider 1',
          model: 'model-a',
          inputUsdPerMillion: 2,
          outputUsdPerMillion: 8
        }
      ]
    },
    releaseHistory: [
      { status: 'failed', action: 'deploy', entryCount: 25000 },
      { status: 'success', action: 'deploy', entryCount: 10 }
    ],
    nodeHistory: [
      {
        serviceId: 'tcp:3000',
        protocol: 'tcp',
        port: 3000,
        state: 'online',
        cpuPercent: 10,
        memoryBytes: 100,
        checkedAt: 900
      },
      {
        serviceId: 'tcp:3000',
        protocol: 'tcp',
        port: 3000,
        state: 'offline',
        cpuPercent: 0,
        memoryBytes: 0,
        checkedAt: 950
      }
    ]
  })

  assert.equal(data.generatedAt, 1000)
  assert.equal(data.modelReliability[0].successRate, 50)
  assert.equal(data.evaluations[0].passRate, 100)
  assert.equal(data.evaluations[0].estimatedInputTokens, 2)
  assert.equal(data.evaluations[0].estimatedOutputTokens, 1)
  assert.equal(data.evaluations[0].estimatedCostUsd, 0.000012)
  assert.equal(data.releaseRisk.level, 'high')
  assert.match(data.releaseRisk.disclaimer, /历史记录/)
  assert.equal(data.nodeServices[0].availability, 50)
  assert.equal(data.nodeServices[0].averageCpuPercent, 5)
  assert.equal(data.nodeServices[0].latest.state, 'offline')
  assert.equal(JSON.stringify(data).includes('12345678'), false)
})

test('persists bounded per-model pricing settings', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-insights-'))
  try {
    const saved = saveOpsInsightsSettings(userDataPath, {
      providerId: 'p1',
      providerName: 'Provider 1',
      model: 'model-a',
      inputUsdPerMillion: 1.5,
      outputUsdPerMillion: 6
    })
    assert.equal(saved.pricing.length, 1)
    assert.equal(loadOpsInsightsSettings(userDataPath).pricing[0].outputUsdPerMillion, 6)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})
