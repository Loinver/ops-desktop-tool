<template>
  <div ref="root" class="ops-notification-center">
    <button
      class="notification-trigger"
      :class="{ 'is-open': open, 'has-critical': unreadCritical > 0 }"
      type="button"
      :aria-expanded="open"
      aria-label="打开全局通知中心"
      title="全局通知"
      @click="toggle"
    >
      <t-icon name="notification" />
      <span v-if="unreadCount" class="notification-badge">{{ unreadLabel }}</span>
    </button>

    <transition name="notification-popover">
      <section v-if="open" class="notification-popover" aria-label="全局通知中心">
        <header class="notification-header">
          <div>
            <span class="notification-eyebrow">OPS NOTIFICATIONS</span>
            <h2>全局通知</h2>
          </div>
          <div class="notification-header-actions">
            <button type="button" :disabled="loading" title="刷新通知" @click="loadEvents">
              <t-icon name="refresh" :class="{ spinning: loading }" />
            </button>
            <button type="button" :disabled="!unreadCount || markingRead" @click="markAllRead">全部已读</button>
          </div>
        </header>

        <div v-if="loading && !events.length" class="notification-empty">正在读取通知…</div>
        <div v-else-if="!events.length" class="notification-empty">
          <t-icon name="check-circle" />
          <strong>暂无运维通知</strong>
          <span>新的异常、恢复和巡检事件会显示在这里。</span>
        </div>
        <div v-else class="notification-list">
          <button
            v-for="item in events"
            :key="item.id"
            type="button"
            class="notification-item"
            :class="[{ unread: !item.readAt }, `severity-${item.severity || item.level || 'info'}`]"
            @click="openEvent(item)"
          >
            <span class="notification-dot"></span>
            <span class="notification-content">
              <span class="notification-title-row">
                <strong>{{ item.title }}</strong>
                <time>{{ timeText(item.updatedAt || item.lastOccurredAt) }}</time>
              </span>
              <span class="notification-description">{{ item.description || statusLabel(item.status) }}</span>
              <span class="notification-meta">
                <em>{{ sourceLabel(item.sourceType || item.category) }}</em>
                <em>{{ statusLabel(item.status) }}</em>
                <em v-if="item.occurrenceCount > 1">{{ item.occurrenceCount }} 次</em>
              </span>
            </span>
          </button>
        </div>

        <footer class="notification-footer">
          <span>{{ unreadCount ? `${unreadCount} 条未读` : '已全部阅读' }}</span>
          <button type="button" @click="viewAll">查看全部事件 <t-icon name="arrow-right" /></button>
        </footer>
      </section>
    </transition>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { routeForOpsEvent } from '../../utils/ops-event-route'

const route = useRoute()
const router = useRouter()
const root = ref(null)
const open = ref(false)
const loading = ref(false)
const markingRead = ref(false)
const events = ref([])
const summary = ref({})
let pollTimer = null

const unreadCount = computed(() => Number(summary.value?.unread) || events.value.filter(item => !item.readAt).length)
const unreadCritical = computed(() => Number(summary.value?.unreadCritical) || 0)
const unreadLabel = computed(() => unreadCount.value > 99 ? '99+' : String(unreadCount.value))

const SOURCE_LABELS = {
  release: '系统发布',
  'model-monitor': '模型巡检',
  model: '模型测试',
  automation: '自动化巡检',
  log: '日志分析',
  copilot: 'AI Copilot',
  'node-service': 'Node 服务',
  system: '系统',
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || '系统'
}

function statusLabel(status) {
  return ({ open: '待处理', acknowledged: '已确认', resolved: '已解决' })[status] || '事件更新'
}

function timeText(timestamp) {
  const value = Number(timestamp)
  if (!value) return '刚刚'
  const diff = Math.max(0, Date.now() - value)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
}

async function loadEvents() {
  if (loading.value) return
  loading.value = true
  try {
    const result = await window.opsApi?.getOpsEvents?.({ limit: 12 })
    if (result?.ok) {
      events.value = result.items || []
      summary.value = result.summary || {}
    }
  } catch (error) {
    console.warn('读取全局通知失败:', error)
  } finally {
    loading.value = false
  }
}

async function markRead(ids) {
  const result = await window.opsApi?.markOpsEventsRead?.({ ids })
  if (!result?.ok) return false
  const readAt = Number(result.readAt) || Date.now()
  const idSet = new Set(ids)
  events.value = events.value.map(item => idSet.has(item.id) ? { ...item, readAt } : item)
  summary.value = result.summary || summary.value
  return true
}

async function markAllRead() {
  if (markingRead.value || !unreadCount.value) return
  markingRead.value = true
  try {
    const result = await window.opsApi?.markOpsEventsRead?.({ all: true })
    if (result?.ok) {
      const readAt = Number(result.readAt) || Date.now()
      events.value = events.value.map(item => ({ ...item, readAt: item.readAt || readAt }))
      summary.value = result.summary || summary.value
    }
  } finally {
    markingRead.value = false
  }
}

async function openEvent(item) {
  if (!item.readAt) await markRead([item.id])
  open.value = false
  await router.push(routeForOpsEvent(item))
}

function viewAll() {
  open.value = false
  router.push('/ops-control-center')
}

function toggle() {
  open.value = !open.value
  if (open.value) void loadEvents()
}

function handleDocumentClick(event) {
  if (root.value && event.target instanceof Node && !root.value.contains(event.target)) open.value = false
}

function handleKeydown(event) {
  if (event.key === 'Escape') open.value = false
}

function handleFocus() {
  void loadEvents()
}

watch(() => route.fullPath, () => {
  open.value = false
  void loadEvents()
})

onMounted(() => {
  void loadEvents()
  pollTimer = window.setInterval(loadEvents, 45_000)
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('focus', handleFocus)
})

onUnmounted(() => {
  window.clearInterval(pollTimer)
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('focus', handleFocus)
})
</script>

<style scoped>
.ops-notification-center,
.notification-trigger,
.notification-header-actions button,
.notification-item,
.notification-footer button { -webkit-app-region: no-drag; }
.ops-notification-center { position: relative; }
.notification-trigger { position: relative; width: 36px; height: 36px; display: inline-grid; place-items: center; border: 1px solid var(--shell-border); border-radius: 10px; background: var(--shell-surface-raised); color: var(--text-secondary); font: inherit; font-size: 17px; cursor: pointer; transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast); }
.notification-trigger:hover,
.notification-trigger.is-open { border-color: color-mix(in srgb, var(--primary) 30%, var(--shell-border)); color: var(--primary); box-shadow: var(--shadow-xs); }
.notification-trigger.has-critical { color: var(--danger); }
.notification-badge { position: absolute; top: -6px; right: -7px; min-width: 18px; height: 18px; padding: 0 5px; border: 2px solid var(--shell-surface); border-radius: 999px; background: var(--danger); color: #fff; font-size: 9px; font-weight: 700; line-height: 14px; text-align: center; }
.notification-popover { position: absolute; z-index: 65; top: calc(100% + 10px); right: 0; width: min(380px, calc(100vw - 24px)); overflow: hidden; border: 1px solid var(--shell-border); border-radius: 14px; background: var(--shell-surface-raised); box-shadow: var(--shadow-xl); }
.notification-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border-light); }
.notification-eyebrow { display: block; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: .12em; line-height: 14px; }
.notification-header h2 { margin-top: 1px; color: var(--text); font-size: 15px; line-height: 22px; }
.notification-header-actions { display: flex; align-items: center; gap: 4px; }
.notification-header-actions button { min-height: 30px; padding: 0 7px; border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.notification-header-actions button:first-child { width: 30px; padding: 0; font-size: 14px; }
.notification-header-actions button:hover:not(:disabled) { background: var(--bg-subtle); color: var(--primary); }
.notification-header-actions button:disabled { opacity: .5; cursor: default; }
.notification-list { max-height: min(480px, calc(100vh - 190px)); overflow-y: auto; overscroll-behavior: contain; }
.notification-item { width: 100%; display: grid; grid-template-columns: 8px minmax(0, 1fr); gap: 10px; padding: 12px 16px; border: 0; border-bottom: 1px solid var(--border-light); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.notification-item:hover { background: var(--bg-subtle); }
.notification-item.unread { background: color-mix(in srgb, var(--primary-soft) 52%, transparent); }
.notification-item.unread:hover { background: var(--primary-soft); }
.notification-dot { width: 7px; height: 7px; margin-top: 6px; border-radius: 50%; background: var(--text-muted); }
.severity-warning .notification-dot { background: var(--warning); }
.severity-critical .notification-dot { background: var(--danger); }
.severity-info .notification-dot { background: var(--info); }
.notification-content { min-width: 0; display: grid; gap: 4px; }
.notification-title-row { min-width: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.notification-title-row strong { min-width: 0; overflow: hidden; color: var(--text); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.notification-title-row time { flex: none; color: var(--text-muted); font-size: 10px; line-height: 18px; white-space: nowrap; }
.notification-description { display: -webkit-box; overflow: hidden; color: var(--text-secondary); font-size: 11px; line-height: 17px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
.notification-meta { display: flex; flex-wrap: wrap; gap: 5px; }
.notification-meta em { padding: 1px 6px; border-radius: 999px; background: var(--bg-subtle); color: var(--text-muted); font-size: 9px; font-style: normal; line-height: 15px; }
.notification-empty { min-height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 24px; color: var(--text-muted); font-size: 11px; text-align: center; }
.notification-empty > .t-icon { color: var(--success); font-size: 26px; }
.notification-empty strong { color: var(--text-secondary); font-size: 13px; }
.notification-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; background: var(--bg-subtle); color: var(--text-muted); font-size: 10px; }
.notification-footer button { display: inline-flex; align-items: center; gap: 4px; padding: 3px 0; border: 0; background: transparent; color: var(--primary); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
.notification-popover-enter-active,
.notification-popover-leave-active { transition: opacity .16s ease, transform .16s ease; }
.notification-popover-enter-from,
.notification-popover-leave-to { opacity: 0; transform: translateY(-5px); }
.spinning { animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
