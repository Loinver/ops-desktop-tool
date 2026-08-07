import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ModelTestToolbar from '../../src/renderer/views/model-test/components/ModelTestToolbar.vue'

const IconStub = { template: '<i />' }

function mountToolbar(summary) {
  return mount(ModelTestToolbar, {
    props: {
      summary,
      appTabs: [],
      familyTabs: []
    },
    global: {
      stubs: { 't-icon': IconStub }
    }
  })
}

describe('ModelTestToolbar coverage', () => {
  it('keeps testing models in the coverage denominator', () => {
    const wrapper = mountToolbar({
      ok: 1,
      failed: 0,
      gateway: 0,
      idle: 1,
      testing: 3,
      total: 1
    })

    expect(wrapper.get('.coverage-progress-label').text()).toContain('已测 1 / 5')
    expect(wrapper.get('.coverage-progress-label strong').text()).toBe('20%')

    const progressbar = wrapper.get('[role="progressbar"]')
    expect(progressbar.attributes('aria-valuenow')).toBe('1')
    expect(progressbar.attributes('aria-valuemax')).toBe('5')
    expect(wrapper.get('.coverage-fill').attributes('style')).toContain('width: 20%')

    wrapper.unmount()
  })

  it('renders the coverage status while every model is testing', () => {
    const wrapper = mountToolbar({
      ok: 0,
      failed: 0,
      gateway: 0,
      idle: 0,
      testing: 4,
      total: 0
    })

    expect(wrapper.get('.coverage-progress-label').text()).toContain('已测 0 / 4')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuemax')).toBe('4')

    wrapper.unmount()
  })
})
