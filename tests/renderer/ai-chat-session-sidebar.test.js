import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatSessionSidebar from '../../src/renderer/views/ai-chat/ChatSessionSidebar.vue'

const IconStub = { props: ['name'], template: '<i :data-icon="name" />' }

function createSessions() {
  return [
    {
      id: 'release',
      title: '发布排障',
      createdAt: 1,
      updatedAt: 2,
      messages: [{ role: 'user', content: '检查 SFTP 主机指纹', createdAt: 1 }]
    },
    {
      id: 'node',
      title: 'Node 服务',
      createdAt: 3,
      updatedAt: 4,
      messages: [{ role: 'assistant', content: '检查端口监听', createdAt: 3 }]
    }
  ]
}

function mountSidebar(props = {}) {
  return mount(ChatSessionSidebar, {
    props: { sessions: createSessions(), ...props },
    global: { stubs: { 't-icon': IconStub } }
  })
}

describe('ChatSessionSidebar', () => {
  it('filters sessions by search text and emits the selected session id', async () => {
    const wrapper = mountSidebar({ activeId: 'release' })

    await wrapper.get('input[placeholder="搜索会话"]').setValue('端口')

    expect(wrapper.findAll('.chat-session-item')).toHaveLength(1)
    expect(wrapper.get('.chat-session-select strong').text()).toBe('Node 服务')

    await wrapper.get('.chat-session-select').trigger('click')

    expect(wrapper.emitted('select')).toEqual([['node']])
  })

  it('emits rename and delete events for session actions', async () => {
    const wrapper = mountSidebar()

    await wrapper.get('[aria-label="重命名会话"]').trigger('click')
    const renameInput = wrapper.get('input[aria-label="会话名称"]')
    expect(renameInput.element.value).toBe('发布排障')

    await renameInput.setValue('发布回滚排障')
    await wrapper.get('form.chat-session-rename').trigger('submit')
    await wrapper.get('[aria-label="删除会话"]').trigger('click')

    expect(wrapper.emitted('rename')).toEqual([[{ id: 'release', title: '发布回滚排障' }]])
    expect(wrapper.emitted('delete')).toEqual([['release']])
    expect(wrapper.find('input[aria-label="会话名称"]').exists()).toBe(false)
  })

  it('disables session selection and management actions while busy', () => {
    const wrapper = mountSidebar({ busy: true })

    expect(wrapper.findAll('.chat-session-select:disabled')).toHaveLength(2)
    expect(wrapper.findAll('[aria-label="重命名会话"]:disabled')).toHaveLength(2)
    expect(wrapper.findAll('[aria-label="删除会话"]:disabled')).toHaveLength(2)
    expect(wrapper.find('input[aria-label="会话名称"]').exists()).toBe(false)
  })
})
