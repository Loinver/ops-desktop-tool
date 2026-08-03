import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Sidebar from '../../src/renderer/components/layout/Sidebar.vue'
import { FUNCTION_MENU_ITEMS } from '../../src/renderer/config/function-menu.js'

const SIDEBAR_GROUPS_KEY = 'ops-desktop.sidebar-expanded-groups'
const IconStub = { props: ['name'], template: '<i :data-icon="name" />' }

function getGroupToggle(wrapper, groupId) {
  return wrapper.get(`#nav-group-${groupId}`).element.previousElementSibling
}

function createTestRouter(initialPath) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: FUNCTION_MENU_ITEMS.map((item) => ({
      path: item.path,
      component: { template: '<div />' },
    })),
  })
  return router.push(initialPath).then(() => router.isReady()).then(() => router)
}

async function mountSidebar(initialPath = '/system-release', props = {}) {
  const router = await createTestRouter(initialPath)
  const wrapper = mount(Sidebar, {
    props: { collapsed: false, ...props },
    global: {
      plugins: [createPinia(), router],
      stubs: { 't-icon': IconStub },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

beforeEach(() => {
  window.localStorage.clear()
  window.opsApi = {
    getAppInfo: vi.fn().mockResolvedValue({ platform: 'darwin', version: '1.0.1' }),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Sidebar navigation groups', () => {
  it('marks the active route and keeps its group expanded', async () => {
    const { wrapper } = await mountSidebar('/system-release')

    const activeItem = wrapper.get('[aria-current="page"]')
    expect(activeItem.attributes('aria-label')).toBe('系统发布')
    expect(wrapper.get('#nav-group-operations').isVisible()).toBe(true)
    expect(wrapper.get('#nav-group-operations').element.previousElementSibling.getAttribute('aria-expanded')).toBe('true')
  })

  it('persists a group toggle and restores it on the next mount', async () => {
    const { wrapper } = await mountSidebar('/system-release')
    const overviewToggle = getGroupToggle(wrapper, 'overview')

    overviewToggle.click()
    await flushPromises()

    expect(overviewToggle.getAttribute('aria-expanded')).toBe('false')
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_GROUPS_KEY))).not.toContain('overview')

    wrapper.unmount()
    const { wrapper: restoredWrapper } = await mountSidebar('/system-release')
    const restoredToggle = getGroupToggle(restoredWrapper, 'overview')
    expect(restoredToggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens and persists the destination group when navigation changes', async () => {
    window.localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(['overview']))
    const { router, wrapper } = await mountSidebar('/ops-dashboard')

    await router.push('/gpt-image')
    await flushPromises()

    const intelligenceToggle = getGroupToggle(wrapper, 'intelligence')
    expect(intelligenceToggle.getAttribute('aria-expanded')).toBe('true')
    expect(JSON.parse(window.localStorage.getItem(SIDEBAR_GROUPS_KEY))).toContain('intelligence')
  })

  it('keeps all destinations available and labels icon-only items when collapsed', async () => {
    const { wrapper } = await mountSidebar('/system-release', { collapsed: true })

    expect(wrapper.get('.nav-group-toggle').isVisible()).toBe(false)
    expect(wrapper.findAll('.nav-item')).toHaveLength(FUNCTION_MENU_ITEMS.length)
    expect(wrapper.get('[aria-label="系统发布"]').attributes('title')).toBe('系统发布')
  })

  it('emits a toggle request from the collapse control', async () => {
    const { wrapper } = await mountSidebar()

    await wrapper.get('.collapse-button').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})
