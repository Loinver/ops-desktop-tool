import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import OpsControlCenter from '../../src/renderer/views/ops-control-center/index.vue'

const messagePlugin = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warning: vi.fn()
}))

vi.mock('tdesign-vue-next/es/message/plugin.mjs', () => ({ default: messagePlugin }))
vi.mock('tdesign-vue-next/es/select/index.mjs', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Select: defineComponent({
      name: 'TSelectTestDouble',
      inheritAttrs: true,
      props: {
        inputProps: { type: Object, default: () => ({}) },
        modelValue: { type: [String, Number], default: '' },
        options: { type: Array, default: () => [] }
      },
      setup(props) {
        return () => h('div', {}, [h('input', { ...props.inputProps, value: props.modelValue })])
      }
    })
  }
})

const IconStub = { template: '<i />' }

beforeEach(() => {
  window.opsApi = {
    getOpsEvents: vi.fn().mockResolvedValue({ ok: true, items: [], summary: {} }),
    getAutomationTasks: vi.fn().mockResolvedValue({ ok: true, tasks: [] }),
    getAiOpsState: vi.fn().mockResolvedValue({
      ok: true,
      providers: { activeProviderId: '', providers: [] }
    })
  }
})

afterEach(() => {
  delete window.opsApi
  vi.restoreAllMocks()
})

describe('OpsControlCenter event filters', () => {
  it('gives both TDesign select inputs an accessible name', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/ops-control-center', component: { template: '<div />' } }]
    })
    await router.push('/ops-control-center')
    await router.isReady()

    const wrapper = mount(OpsControlCenter, {
      global: {
        plugins: [router],
        stubs: { 't-icon': IconStub }
      }
    })
    await flushPromises()

    const inputs = wrapper.findAll('.event-filter-select input')
    expect(inputs).toHaveLength(2)
    expect(inputs[0].attributes('aria-label')).toBe('事件状态')
    expect(inputs[1].attributes('aria-label')).toBe('事件来源')

    wrapper.unmount()
  })
})
