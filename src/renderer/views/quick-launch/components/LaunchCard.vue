<template>
  <div
    class="launch-card interactive-surface"
    role="button"
    tabindex="0"
    :aria-label="`启动 ${item.name}`"
    @click="$emit('launch', item)"
    @keydown.enter.self="$emit('launch', item)"
    @keydown.space.self.prevent="$emit('launch', item)"
  >
    <div class="card-left">
      <div class="card-icon" :style="{ background: item.color || '#6366f1' }">
        <span v-if="isEmoji(item.icon)">{{ item.icon }}</span>
        <t-icon v-else :name="item.icon || getDefaultIcon(item.type)" />
      </div>
    </div>

    <div class="card-center">
      <div class="card-name">{{ item.name }}</div>
      <div class="card-target" :title="item.target">{{ item.target }}</div>
      <div class="card-meta">
        <div class="card-type">
          <t-icon :name="typeIcon" />
          <span>{{ typeName }}</span>
        </div>
        <span v-if="item.type === 'url' && item.quickOpen" class="quick-open-badge">
          一键打开
        </span>
      </div>
    </div>

    <div class="card-right">
      <button
        type="button"
        class="action-btn"
        aria-label="编辑快捷方式"
        title="编辑"
        @click.stop="$emit('edit', item)"
      >
        <t-icon name="edit" />
      </button>
      <button
        type="button"
        class="action-btn danger"
        aria-label="删除快捷方式"
        title="删除"
        @click.stop="$emit('delete', item)"
      >
        <t-icon name="delete" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  item: {
    type: Object,
    required: true
  }
})

defineEmits(['launch', 'edit', 'delete'])

const typeIcon = computed(() => {
  const map = { app: 'app', url: 'earth', folder: 'folder' }
  return map[props.item.type] || 'app'
})

const typeName = computed(() => {
  const map = { app: '应用', url: '网址', folder: '文件夹' }
  return map[props.item.type] || '未知'
})

function getDefaultIcon(type) {
  const map = { app: 'app', url: 'earth', folder: 'folder' }
  return map[type] || 'app'
}

function isEmoji(str) {
  if (!str) return false
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
  return emojiRegex.test(str)
}
</script>

<style scoped>
.launch-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-xs);
  cursor: pointer;
  transition: all var(--transition-slow);
}

.launch-card:hover,
.launch-card:focus-visible {
  transform: translateY(-3px);
  border-color: var(--primary);
  box-shadow: var(--shadow-lg);
  outline: none;
}

.launch-card:hover .card-right,
.launch-card:focus-within .card-right {
  opacity: 1;
}

.launch-card:hover .card-icon {
  transform: scale(1.05);
}

.card-left {
  flex-shrink: 0;
}

.card-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: #fff;
  transition: transform var(--transition);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.card-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-target {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.quick-open-badge {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 10px;
  font-weight: 600;
}

.card-type {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.card-right {
  display: flex;
  flex-direction: column;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--transition);
  flex-shrink: 0;
}

.action-btn {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  cursor: pointer;
  transition: all var(--transition);
}

.action-btn:hover {
  background: #f1f5f9;
  color: var(--text);
  border-color: var(--text-muted);
}

.action-btn.danger:hover {
  background: var(--danger-light);
  color: var(--danger);
  border-color: var(--danger);
}
</style>
