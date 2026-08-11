<template>
  <aside class="chat-sessions" aria-label="AI 对话会话列表">
    <div class="chat-sessions__heading">
      <div>
        <strong>会话</strong>
        <small>{{ sessions.length }}/{{ MAX_CHAT_SESSIONS }}</small>
      </div>
      <t-icon name="chat" aria-hidden="true" />
    </div>

    <label class="chat-sessions__search">
      <t-icon name="search" aria-hidden="true" />
      <input v-model="search" type="search" maxlength="200" placeholder="搜索会话" />
    </label>

    <div class="chat-session-list" role="list">
      <div v-if="filteredSessions.length === 0" class="chat-session-empty">没有匹配的会话</div>
      <div
        v-for="session in filteredSessions"
        :key="session.id"
        :class="['chat-session-item', { 'chat-session-item--active': session.id === activeId }]"
        role="listitem"
      >
        <form
          v-if="editingId === session.id"
          class="chat-session-rename"
          @submit.prevent="submitRename(session)"
        >
          <input
            v-model="renameDraft"
            autofocus
            maxlength="80"
            aria-label="会话名称"
            @keydown.esc.prevent="cancelRename"
          />
          <button type="submit" title="保存名称" aria-label="保存名称">
            <t-icon name="check" />
          </button>
        </form>
        <template v-else>
          <button
            class="chat-session-select"
            type="button"
            :disabled="busy"
            @click="$emit('select', session.id)"
          >
            <strong>{{ session.title }}</strong>
            <small
              >{{ session.messages.length }} 条 · {{ formatUpdatedAt(session.updatedAt) }}</small
            >
          </button>
          <div class="chat-session-actions">
            <button
              type="button"
              title="重命名"
              aria-label="重命名会话"
              :disabled="busy"
              @click="beginRename(session)"
            >
              <t-icon name="edit" />
            </button>
            <button
              class="chat-session-delete"
              type="button"
              title="删除"
              aria-label="删除会话"
              :disabled="busy"
              @click="$emit('delete', session.id)"
            >
              <t-icon name="delete" />
            </button>
          </div>
        </template>
      </div>
    </div>

    <p class="chat-sessions__note">仅保存在本机，并按总量自动清理旧会话</p>
  </aside>
</template>

<script setup>
import { computed, ref } from 'vue'
import { MAX_CHAT_SESSIONS, filterChatSessions } from './chat-history.js'

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
  busy: { type: Boolean, default: false }
})
const emit = defineEmits(['select', 'rename', 'delete'])

const search = ref('')
const editingId = ref('')
const renameDraft = ref('')
const filteredSessions = computed(() => filterChatSessions(props.sessions, search.value))

function beginRename(session) {
  if (props.busy) return
  editingId.value = session.id
  renameDraft.value = session.title
}

function cancelRename() {
  editingId.value = ''
  renameDraft.value = ''
}

function submitRename(session) {
  emit('rename', { id: session.id, title: renameDraft.value })
  cancelRename()
}

function formatUpdatedAt(value) {
  const date = new Date(Number(value) || Date.now())
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
</script>

<style scoped>
.chat-sessions {
  display: flex;
  width: 236px;
  min-width: 0;
  flex: 0 0 236px;
  flex-direction: column;
  border-right: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-subtle) 78%, var(--card-bg));
}

.chat-sessions__heading,
.chat-sessions__heading > div,
.chat-sessions__search,
.chat-session-item,
.chat-session-rename,
.chat-session-actions {
  display: flex;
  align-items: center;
}

.chat-sessions__heading {
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-md) var(--spacing-sm);
  color: var(--text-secondary);
}

.chat-sessions__heading > div {
  gap: 6px;
}

.chat-sessions__heading strong {
  font-size: 13px;
}

.chat-sessions__heading small,
.chat-sessions__note,
.chat-session-select small {
  color: var(--text-muted);
  font-size: 11px;
}

.chat-sessions__search {
  gap: 6px;
  margin: 0 var(--spacing-sm) var(--spacing-sm);
  padding: 0 9px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: var(--card-bg);
}

.chat-sessions__search:focus-within {
  border-color: color-mix(in srgb, var(--primary) 52%, var(--border));
  box-shadow: var(--focus-ring);
}

.chat-sessions__search input {
  width: 100%;
  min-width: 0;
  height: var(--control-height-sm);
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 12px;
}

.chat-session-list {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0 var(--spacing-sm) var(--spacing-sm);
}

.chat-session-empty {
  padding: var(--spacing-lg) var(--spacing-sm);
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.chat-session-item {
  position: relative;
  gap: 3px;
  min-width: 0;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
}

.chat-session-item + .chat-session-item {
  margin-top: 3px;
}

.chat-session-item:hover,
.chat-session-item--active {
  border-color: color-mix(in srgb, var(--primary) 18%, var(--border-light));
  background: var(--card-bg);
}

.chat-session-item--active {
  box-shadow: inset 2px 0 var(--primary);
}

.chat-session-select {
  min-width: 0;
  flex: 1 1 auto;
  padding: 7px 6px;
  border: 0;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.chat-session-select strong,
.chat-session-select small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-session-select strong {
  margin-bottom: 3px;
  font-size: 12px;
  font-weight: 600;
}

.chat-session-select:disabled,
.chat-session-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.chat-session-actions {
  flex: 0 0 auto;
  gap: 1px;
  opacity: 0;
}

.chat-session-item:hover .chat-session-actions,
.chat-session-item--active .chat-session-actions,
.chat-session-actions:focus-within {
  opacity: 1;
}

.chat-session-actions button,
.chat-session-rename button {
  display: grid;
  width: 25px;
  height: 25px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  place-items: center;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.chat-session-actions button:hover:not(:disabled),
.chat-session-rename button:hover {
  color: var(--primary);
  background: var(--primary-light);
}

.chat-session-actions .chat-session-delete:hover:not(:disabled) {
  color: var(--danger);
  background: var(--danger-light);
}

.chat-session-rename {
  width: 100%;
  gap: 3px;
  padding: 3px;
}

.chat-session-rename input {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 7px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-sm);
  outline: 0;
  background: var(--card-bg);
  font-size: 12px;
}

.chat-sessions__note {
  flex: 0 0 auto;
  padding: var(--spacing-sm) var(--spacing-md);
  margin: 0;
  border-top: 1px solid var(--border-light);
  line-height: 16px;
}

@media (max-width: 760px) {
  .chat-sessions {
    width: 100%;
    flex-basis: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border-light);
  }

  .chat-sessions__heading {
    padding: var(--spacing-sm) var(--spacing-md) 6px;
  }

  .chat-sessions__search {
    margin-inline: var(--spacing-md);
  }

  .chat-session-list {
    display: flex;
    gap: 5px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0 var(--spacing-md) var(--spacing-sm);
  }

  .chat-session-item {
    min-width: 210px;
    flex: 0 0 210px;
  }

  .chat-session-item + .chat-session-item {
    margin-top: 0;
  }

  .chat-sessions__note {
    display: none;
  }
}
</style>
