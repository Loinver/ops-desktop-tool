import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import OpsTaskCenter from '../../src/renderer/views/ops-task-center/index.vue'

const messagePlugin = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn()
}))

vi.mock('tdesign-vue-next/es/message/plugin.mjs', () => ({ default: messagePlugin }))

const IconStub = { template: '<i />' }
const NOW = Date.now()

function createApi(overrides = {}) {
  const event = {
    id: 'event-automation-1',
    sourceType: 'automation',
    sourceId: 'task-1',
    severity: 'warning',
    status: 'open',
    title: '巡检失败',
    updatedAt: NOW
  }
  const plan = {
    version: 1,
    planId: 'runbook-safe-1',
    executable: true,
    requiresConfirmation: true,
    event,
    steps: [
      {
        id: 'action-1',
        phase: 'action',
        type: 'automation-diagnostic',
        requiresConfirmation: true
      },
      {
        id: 'verification-1',
        phase: 'verification',
        type: 'automation-recheck',
        requiresConfirmation: false
      }
    ]
  }
  const runResult = {
    id: 'run-1',
    status: 'succeeded',
    actionResults: [
      {
        stepId: 'action-1',
        phase: 'action',
        status: 'succeeded',
        message: '诊断完成'
      }
    ],
    verificationResults: [
      {
        stepId: 'verification-1',
        phase: 'verification',
        status: 'succeeded',
        message: '复检通过'
      }
    ],
    summary: { succeeded: 2, failed: 0, guided: 0 }
  }
  return {
    getModelMonitorSettings: vi.fn().mockResolvedValue({
      ok: true,
      settings: {
        enabled: true,
        intervalMinutes: 60,
        notifyOnFailure: true,
        targets: [{ providerId: 'provider-1', model: 'model-1', appType: 'chat' }],
        lastRunAt: NOW - 10_000,
        nextRunAt: NOW + 60_000
      }
    }),
    getAutomationTasks: vi.fn().mockResolvedValue({
      ok: true,
      tasks: [
        {
          id: 'task-1',
          title: '站点健康检查',
          type: 'http-health',
          target: 'https://example.invalid/health',
          intervalMinutes: 5,
          timeoutMs: 8000,
          expectedStatus: 200,
          enabled: true,
          lastRunAt: NOW - 5_000,
          nextRunAt: NOW + 300_000,
          lastResult: { ok: false, message: 'HTTP 500' },
          runs: []
        }
      ]
    }),
    getNodeServiceWatches: vi.fn().mockResolvedValue({
      ok: true,
      items: [
        {
          id: 'tcp:3000',
          protocol: 'TCP',
          port: 3000,
          enabled: true,
          lastState: 'online',
          lastSeenAt: NOW - 1_000,
          updatedAt: NOW - 2_000
        }
      ]
    }),
    getAutoBackupSettings: vi.fn().mockResolvedValue({
      enabled: true,
      interval: 'daily',
      hasPassword: true,
      outputDirectory: '/safe/backup',
      lastRunAt: NOW - 86_400_000,
      nextRunAt: NOW + 86_400_000
    }),
    getAutoBackupHealth: vi.fn().mockResolvedValue({
      status: 'healthy',
      summary: '最近备份成功'
    }),
    getOpsMaintenanceWindow: vi.fn().mockResolvedValue({
      ok: true,
      window: {
        enabled: false,
        status: 'disabled',
        active: false,
        startAt: 0,
        endAt: 0,
        reason: ''
      }
    }),
    getOpsEvents: vi.fn().mockResolvedValue({ ok: true, items: [event] }),
    getOpsAuditRecords: vi.fn().mockResolvedValue({
      ok: true,
      records: [
        {
          auditId: 'audit-1',
          action: 'process.kill',
          category: 'process',
          channel: 'ports:killPid',
          status: 'failed',
          startedAt: new Date(NOW - 300).toISOString(),
          finishedAt: new Date(NOW).toISOString(),
          durationMs: 300,
          target: { id: '4321', signal: 'SIGTERM' },
          error: { message: '进程不存在' }
        }
      ],
      total: 1,
      hasMore: false,
      nextCursor: '',
      categories: ['process'],
      statusCounts: { started: 0, succeeded: 0, failed: 1 },
      retentionDays: 90,
      integrity: { valid: true, checkedCount: 1 }
    }),
    getOpsRunbookHistory: vi.fn().mockResolvedValue({ ok: true, runs: [] }),
    getOpsInsights: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        generatedAt: NOW,
        modelReliability: [
          {
            id: 'provider-1::chat::model-1',
            providerId: 'provider-1',
            providerName: 'Provider 1',
            model: 'model-1',
            successRate: 95,
            averageDurationMs: 1200,
            total: 20
          }
        ],
        evaluations: [
          {
            id: 'provider-1::model-1',
            providerId: 'provider-1',
            providerName: 'Provider 1',
            model: 'model-1',
            estimatedCostUsd: 0.0123,
            pricing: {
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 2
            }
          }
        ],
        releaseRisk: {
          score: 20,
          level: 'low',
          sampleSize: 5,
          factors: ['近期无失败'],
          disclaimer: '仅供参考'
        },
        nodeServices: [
          {
            serviceId: 'TCP:3000',
            protocol: 'TCP',
            port: 3000,
            samples: 4,
            availability: 100,
            averageCpuPercent: 2,
            averageMemoryBytes: 1024
          }
        ],
        notes: {
          nodeAvailability: '按本机样本计算',
          releaseRisk: '仅供参考'
        },
        settings: { pricing: [] }
      }
    }),
    previewOpsDiagnostics: vi.fn().mockResolvedValue({
      ok: true,
      preview: {
        generatedAt: NOW,
        counts: { events: 1, auditRecords: 1 },
        redaction: '仅导出白名单字段'
      }
    }),
    saveModelMonitorSettings: vi.fn().mockResolvedValue({ ok: true }),
    saveAutomationTask: vi.fn().mockResolvedValue({ ok: true }),
    saveAutoBackupSettings: vi.fn().mockResolvedValue({ ok: true }),
    runModelInspection: vi.fn().mockResolvedValue({ ok: true }),
    runAutomationTask: vi.fn().mockResolvedValue({ ok: true }),
    checkNodeServiceWatches: vi.fn().mockResolvedValue({ ok: true }),
    runAutoBackupNow: vi.fn().mockResolvedValue({ ok: true }),
    executeOpsTaskBatch: vi.fn().mockResolvedValue({
      ok: true,
      batch: {
        batchId: 'batch-1',
        status: 'succeeded',
        requestedCount: 1,
        succeededCount: 1,
        skippedCount: 0,
        failedCount: 0,
        results: []
      }
    }),
    saveOpsMaintenanceWindow: vi.fn().mockImplementation(async (settings) => ({
      ok: true,
      window: { ...settings, status: settings.enabled ? 'upcoming' : 'disabled', active: false }
    })),
    planOpsRunbook: vi.fn().mockResolvedValue({ ok: true, plan }),
    executeOpsRunbook: vi.fn().mockResolvedValue({ ok: true, result: runResult }),
    confirm: vi.fn().mockResolvedValue(true),
    saveOpsInsightsSettings: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        generatedAt: NOW,
        modelReliability: [],
        evaluations: [],
        releaseRisk: { score: 0, level: 'low', factors: [] },
        nodeServices: [],
        notes: {},
        settings: { pricing: [] }
      }
    }),
    exportOpsDiagnostics: vi.fn().mockResolvedValue({
      ok: true,
      canceled: false,
      fileName: 'ops-diagnostics.json',
      sizeBytes: 2048
    }),
    saveOpsAuditSettings: vi.fn().mockResolvedValue({
      ok: true,
      settings: { retentionDays: 90, integrity: { valid: true, checkedCount: 1 } }
    }),
    exportOpsAuditRecords: vi.fn().mockResolvedValue({
      ok: true,
      canceled: false,
      fileName: 'ops-audit.json',
      recordCount: 1,
      sizeBytes: 1024,
      integrity: { valid: true, checkedCount: 1 }
    }),
    clearOpsAuditRecords: vi.fn().mockResolvedValue({
      ok: true,
      result: { deletedCount: 1, remainingCount: 0, integrity: { valid: true } }
    }),
    onOpsDataChanged: vi.fn().mockReturnValue(vi.fn()),
    ...overrides
  }
}

async function mountTaskCenter(overrides = {}) {
  window.opsApi = createApi(overrides)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ops-task-center', component: { template: '<div />' } },
      { path: '/ops-dashboard', component: { template: '<div />' } },
      { path: '/ops-control-center', component: { template: '<div />' } },
      { path: '/model-test', component: { template: '<div />' } },
      { path: '/node-services', component: { template: '<div />' } },
      { path: '/data-management', component: { template: '<div />' } }
    ]
  })
  await router.push('/ops-task-center')
  await router.isReady()
  const wrapper = mount(OpsTaskCenter, {
    global: {
      plugins: [router],
      stubs: { 't-icon': IconStub }
    }
  })
  await flushPromises()
  return { api: window.opsApi, router, wrapper }
}

function buttonByText(wrapper, text) {
  return wrapper.findAll('button').find((button) => button.text().trim() === text)
}

beforeEach(() => {
  messagePlugin.error.mockClear()
  messagePlugin.success.mockClear()
  messagePlugin.warning.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete window.opsApi
})

describe('OpsTaskCenter closed-loop controls', () => {
  it('reuses existing schedulers and does not show a fake Node enable switch', async () => {
    const { api, wrapper } = await mountTaskCenter()

    expect(wrapper.findAll('.task-table tbody tr')).toHaveLength(4)
    expect(wrapper.findAll('.task-switch')).toHaveLength(3)
    const nodeRow = wrapper
      .findAll('.task-table tbody tr')
      .find((row) => row.text().includes('Node 服务关注'))
    expect(nodeRow.text()).toContain('持续关注')
    expect(nodeRow.text()).toContain(
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(new Date(NOW - 1_000))
    )
    expect(nodeRow.text()).not.toContain('尚未运行')

    await nodeRow.findAll('button')[0].trigger('click')
    await flushPromises()

    expect(api.checkNodeServiceWatches).toHaveBeenCalledTimes(1)
    expect(messagePlugin.success).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('paginates growing audit history and resets the window after filtering', async () => {
    const records = Array.from({ length: 45 }, (_, index) => ({
      auditId: `audit-${index + 1}`,
      action: 'process.kill',
      category: index < 30 ? 'process' : 'data',
      channel: 'ports:killPid',
      status: 'succeeded',
      startedAt: new Date(NOW - index * 1000).toISOString(),
      finishedAt: new Date(NOW - index * 1000 + 100).toISOString(),
      durationMs: 100,
      target: { id: String(index + 1) }
    }))
    const getOpsAuditRecords = vi.fn().mockImplementation(async (options = {}) => {
      const filtered = records.filter(
        (record) =>
          (!options.status || record.status === options.status) &&
          (!options.category || record.category === options.category)
      )
      const start = Number(options.cursor || 0)
      const pageSize = Number(options.pageSize) || 20
      const page = filtered.slice(start, start + pageSize)
      const next = start + page.length
      return {
        ok: true,
        records: page,
        total: filtered.length,
        hasMore: next < filtered.length,
        nextCursor: next < filtered.length ? String(next) : '',
        categories: ['data', 'process'],
        statusCounts: { started: 0, succeeded: 45, failed: 0 },
        retentionDays: 90,
        integrity: { valid: true, checkedCount: 45 }
      }
    })
    const { wrapper } = await mountTaskCenter({ getOpsAuditRecords })

    expect(wrapper.findAll('.audit-table tbody tr')).toHaveLength(20)
    expect(wrapper.get('.audit-pagination').text()).toContain('已显示 20 / 45 条')

    await buttonByText(wrapper, '加载更多（20）').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.audit-table tbody tr')).toHaveLength(40)

    await wrapper.get('select[aria-label="审计分类筛选"]').setValue('process')
    await flushPromises()
    expect(wrapper.findAll('.audit-table tbody tr')).toHaveLength(20)
    expect(wrapper.get('.audit-pagination').text()).toContain('已显示 20 / 30 条')

    await buttonByText(wrapper, '加载更多（10）').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.audit-table tbody tr')).toHaveLength(30)
    await buttonByText(wrapper, '收起').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.audit-table tbody tr')).toHaveLength(20)
    expect(getOpsAuditRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'process', cursor: '', pageSize: 20 })
    )
    wrapper.unmount()
  })

  it('saves retention, exports filtered audit records and clears a confirmed category', async () => {
    const { api, wrapper } = await mountTaskCenter()
    await wrapper.get('select[aria-label="审计分类筛选"]').setValue('process')
    await flushPromises()
    await wrapper.get('select[aria-label="审计保留周期"]').setValue('180')
    await buttonByText(wrapper, '保存周期').trigger('click')
    await flushPromises()
    expect(api.saveOpsAuditSettings).toHaveBeenCalledWith({ retentionDays: 180 })

    await buttonByText(wrapper, '导出审计').trigger('click')
    await flushPromises()
    expect(api.exportOpsAuditRecords).toHaveBeenCalledWith({ status: '', category: 'process' })

    await buttonByText(wrapper, '清理当前分类').trigger('click')
    await flushPromises()
    expect(api.confirm).toHaveBeenCalled()
    expect(api.clearOpsAuditRecords).toHaveBeenCalledWith({
      status: '',
      category: 'process',
      confirmed: true
    })
    wrapper.unmount()
  })

  it('requires confirmation before executing a server-generated Runbook', async () => {
    const { api, wrapper } = await mountTaskCenter()

    await buttonByText(wrapper, '生成安全计划').trigger('click')
    await flushPromises()
    expect(api.planOpsRunbook).toHaveBeenCalledWith('event-automation-1')
    expect(wrapper.get('.runbook-plan').text()).toContain('重新执行自动化检查')

    await buttonByText(wrapper, '确认并执行').trigger('click')
    await flushPromises()

    expect(api.confirm).toHaveBeenCalledTimes(1)
    expect(api.executeOpsRunbook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-automation-1',
        confirmed: true,
        plan: expect.objectContaining({ planId: 'runbook-safe-1' })
      })
    )
    expect(wrapper.get('.result-card').text()).toContain('复检通过')
    wrapper.unmount()
  })

  it('saves local pricing and exports only the diagnostics result metadata', async () => {
    const { api, wrapper } = await mountTaskCenter()
    const pricingSelect = wrapper.get('.pricing-form select')

    await pricingSelect.setValue('provider-1::model-1')
    const inputs = wrapper.findAll('.pricing-form input')
    await inputs[0].setValue('3.5')
    await inputs[1].setValue('7')
    await buttonByText(wrapper, '保存价格').trigger('click')
    await flushPromises()

    expect(api.saveOpsInsightsSettings).toHaveBeenCalledWith({
      providerId: 'provider-1',
      providerName: 'Provider 1',
      model: 'model-1',
      inputUsdPerMillion: 3.5,
      outputUsdPerMillion: 7
    })

    await buttonByText(wrapper, '导出 JSON').trigger('click')
    await flushPromises()
    expect(api.exportOpsDiagnostics).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.success-text').text()).toContain('ops-diagnostics.json')
    expect(wrapper.text()).not.toContain('/safe/backup')
    wrapper.unmount()
  })
})
