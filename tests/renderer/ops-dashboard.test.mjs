import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import OpsDashboard from '../../src/renderer/views/ops-dashboard/index.vue'

const messagePlugin = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn()
}))

vi.mock('tdesign-vue-next/es/message/plugin.mjs', () => ({ default: messagePlugin }))

const IconStub = { template: '<i />' }

function dashboardData(events = []) {
  return {
    release: { total: 0, success: 0, failed: 0, latest: [] },
    model: { availability: null, inspections: 0, trend: [], latest: null },
    monitor: { enabled: false, intervalMinutes: 60, notifyOnFailure: true, targetCount: 0 },
    backup: { enabled: false, status: 'disabled', summary: '自动备份计划未启用' },
    events: {
      summary: {
        total: events.length,
        active: events.length,
        open: events.length,
        acknowledged: 0,
        resolved: 0,
        recovered: 0,
        unread: events.length,
        unreadCritical: 0,
        critical: 0,
        warning: events.length
      },
      latest: events
    },
    automation: { total: 0, enabled: 0, healthy: 0, failing: 0, pending: 0 },
    nodeServices: { total: 0, enabled: 0, online: 0, offline: 0, unknown: 0 }
  }
}

async function mountDashboard(getOpsDashboard) {
  const unsubscribe = vi.fn()
  window.opsApi = {
    getOpsDashboard,
    saveModelMonitorSettings: vi.fn(),
    runModelInspection: vi.fn(),
    onOpsDataChanged: vi.fn().mockReturnValue(unsubscribe)
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ops-dashboard', component: { template: '<div />' } },
      { path: '/ops-task-center', component: { template: '<div />' } },
      { path: '/ops-control-center', component: { template: '<div />' } },
      { path: '/system-release', component: { template: '<div />' } },
      { path: '/model-test', component: { template: '<div />' } },
      { path: '/node-services', component: { template: '<div />' } },
      { path: '/data-management', component: { template: '<div />' } },
      { path: '/ai-operations', component: { template: '<div />' } }
    ]
  })
  await router.push('/ops-dashboard')
  await router.isReady()
  const wrapper = mount(OpsDashboard, {
    global: {
      plugins: [router],
      stubs: { 't-icon': IconStub }
    }
  })
  await flushPromises()
  return { router, unsubscribe, wrapper }
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

describe('OpsDashboard loading and event navigation', () => {
  it('does not present zero values as healthy when the first load fails', async () => {
    const { wrapper } = await mountDashboard(
      vi.fn().mockResolvedValue({ ok: false, error: '仪表盘读取失败' })
    )

    expect(wrapper.get('.dashboard-error strong').text()).toBe('仪表盘数据加载失败')
    expect(wrapper.get('.dashboard-placeholder').text()).toContain('暂时无法显示仪表盘数据')
    expect(wrapper.find('.metric-grid').exists()).toBe(false)
    expect(wrapper.find('.healthy-empty').exists()).toBe(false)

    wrapper.unmount()
  })

  it('keeps the last successful data and marks it stale when refresh fails', async () => {
    const getOpsDashboard = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: dashboardData() })
      .mockResolvedValueOnce({ ok: false, error: '刷新超时' })
    const { wrapper } = await mountDashboard(getOpsDashboard)

    expect(wrapper.find('.metric-grid').exists()).toBe(true)
    await buttonByText(wrapper, '刷新').trigger('click')
    await flushPromises()

    expect(wrapper.get('.dashboard-error strong').text()).toBe(
      '仪表盘刷新失败，当前显示上次成功数据'
    )
    expect(wrapper.get('.dashboard-error p').text()).toBe('刷新超时')
    expect(wrapper.find('.metric-grid').exists()).toBe(true)

    wrapper.unmount()
  })

  it('opens an event in the source-specific handling page', async () => {
    const releaseEvent = {
      id: 'event-release-1',
      sourceType: 'release',
      sourceId: 'release-1',
      severity: 'warning',
      status: 'open',
      title: '发布失败',
      occurrenceCount: 1,
      updatedAt: Date.now()
    }
    const { router, wrapper } = await mountDashboard(
      vi.fn().mockResolvedValue({ ok: true, data: dashboardData([releaseEvent]) })
    )

    await wrapper.get('.event-overview-item').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/system-release')
    expect(router.currentRoute.value.query).toEqual({
      event: 'event-release-1',
      sourceId: 'release-1'
    })

    wrapper.unmount()
  })

  it('filters the safe latest-event projection by source, severity and time', async () => {
    const now = Date.now()
    const events = [
      {
        id: 'event-release-1',
        sourceType: 'release',
        severity: 'critical',
        status: 'open',
        title: '发布失败',
        updatedAt: now
      },
      {
        id: 'event-model-1',
        sourceType: 'model-monitor',
        severity: 'warning',
        status: 'open',
        title: '模型异常',
        updatedAt: now - 8 * 24 * 60 * 60 * 1000
      }
    ]
    const { wrapper } = await mountDashboard(
      vi.fn().mockResolvedValue({ ok: true, data: dashboardData(events) })
    )

    const filters = wrapper.findAll('.event-filter-row select')
    await filters[0].setValue('model-monitor')
    expect(wrapper.findAll('.event-overview-item')).toHaveLength(1)
    expect(wrapper.get('.event-overview-item').text()).toContain('模型异常')

    await filters[2].setValue('24h')
    expect(wrapper.findAll('.event-overview-item')).toHaveLength(0)
    expect(wrapper.get('.healthy-empty').text()).toContain('当前筛选条件没有匹配事件')

    wrapper.unmount()
  })

  it('refreshes from the main-process event signal and unsubscribes on unmount', async () => {
    const getOpsDashboard = vi.fn().mockResolvedValue({ ok: true, data: dashboardData() })
    const { unsubscribe, wrapper } = await mountDashboard(getOpsDashboard)
    const listener = window.opsApi.onOpsDataChanged.mock.calls[0][0]

    listener({ kind: 'updated', eventId: 'event-1' })
    await new Promise((resolve) => setTimeout(resolve, 240))
    await flushPromises()

    expect(getOpsDashboard).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
