<template>
  <header class="topbar">
    <div class="topbar-title">
      <span class="topbar-eyebrow">OPS WORKSPACE</span>
      <div class="topbar-heading">
        <h1>{{ currentTitle }}</h1>
        <span class="topbar-separator">/</span>
        <span class="topbar-subtitle">{{ currentGroup }}</span>
      </div>
    </div>

    <div class="topbar-actions">
      <button class="command-trigger" type="button" title="打开命令面板（⌘K）" @click="$emit('open-command')">
        <t-icon name="search" />
        <span>搜索或跳转</span>
        <kbd>{{ shortcutLabel }}</kbd>
      </button>

      <div class="status-wrap">
        <button
          class="status-trigger"
          :class="{ 'is-open': statusOpen }"
          type="button"
          :aria-expanded="statusOpen"
          title="查看全局状态"
          @click="toggleStatus"
        >
          <span class="status-indicator" :class="statusTone"></span>
          <span class="status-label">运行状态</span>
          <t-icon name="chevron-down" class="status-chevron" />
        </button>

        <transition name="status-popover">
          <section v-if="statusOpen" class="status-popover" aria-label="全局状态中心">
            <div class="status-popover-header">
              <div>
                <span class="status-eyebrow">GLOBAL STATUS</span>
                <h2>运行状态中心</h2>
              </div>
              <button class="icon-button" type="button" title="刷新状态" :disabled="loading" @click="loadStatus">
                <t-icon name="refresh" :class="{ spinning: loading }" />
              </button>
            </div>

            <div class="status-summary">
              <span class="status-indicator" :class="statusTone"></span>
              <div>
                <strong>{{ statusMessage }}</strong>
                <p>{{ generatedAtText }}</p>
              </div>
            </div>

            <div class="status-metrics">
              <button type="button" class="status-metric" @click="go('/system-release')">
                <span>发布失败</span>
                <strong :class="{ danger: releaseFailed > 0 }">{{ releaseFailed }}</strong>
              </button>
              <button type="button" class="status-metric" @click="go('/model-test')">
                <span>模型巡检</span>
                <strong>{{ monitorEnabled ? '运行中' : '未启用' }}</strong>
              </button>
              <button type="button" class="status-metric" @click="go('/node-services')">
                <span>监听服务</span>
                <strong>{{ serviceCount }}</strong>
              </button>
            </div>

            <div class="status-popover-footer">
              <button type="button" @click="go('/ops-dashboard')">打开运维仪表盘 <t-icon name="arrow-right" /></button>
            </div>
          </section>
        </transition>
      </div>
    </div>
  </header>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const emit = defineEmits(['open-command'])
const route = useRoute()
const router = useRouter()

const statusOpen = ref(false)
const loading = ref(false)
const dashboard = ref(null)
const serviceCount = ref(0)

const routeGroups = {
  '/ops-dashboard': '概览',
  '/system-release': '运维',
  '/node-services': '运维',
  '/system-info': '运维',
  '/ai-ops': 'AI 工作台',
  '/model-test': 'AI 工作台',
  '/gpt-image': 'AI 工作台',
  '/quick-launch': '效率工具',
  '/clipboard-history': '效率工具',
}

const currentTitle = computed(() => route.meta?.title || 'Ops Desktop')
const currentGroup = computed(() => routeGroups[route.path] || '工作台')
const shortcutLabel = computed(() => navigator.platform?.toLowerCase().includes('mac') ? '⌘ K' : 'Ctrl K')
const releaseFailed = computed(() => Number(dashboard.value?.release?.failed) || 0)
const monitorEnabled = computed(() => Boolean(dashboard.value?.monitor?.enabled))
const statusTone = computed(() => releaseFailed.value > 0 ? 'warning' : 'healthy')
const statusMessage = computed(() => {
  if (releaseFailed.value > 0) return `有 ${releaseFailed.value} 条失败发布需要关注`
  if (monitorEnabled.value) return '所有核心服务正在受控运行'
  return '系统运行正常，模型巡检尚未启用'
})
const generatedAtText = computed(() => {
  const timestamp = Number(dashboard.value?.generatedAt)
  if (!timestamp) return loading.value ? '正在读取最新状态…' : '点击刷新获取最新状态'
  return `更新于 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(timestamp)}`
})

async function loadStatus() {
  loading.value = true
  try {
    const [dashboardResult, portsResult] = await Promise.all([
      window.opsApi?.getOpsDashboard?.(),
      window.opsApi?.listPorts?.(),
    ])
    if (dashboardResult?.ok) dashboard.value = dashboardResult.data
    if (portsResult?.ok) serviceCount.value = Array.isArray(portsResult.entries) ? portsResult.entries.length : 0
  } catch (error) {
    console.warn('读取全局状态失败:', error)
  } finally {
    loading.value = false
  }
}

function toggleStatus() {
  statusOpen.value = !statusOpen.value
  if (statusOpen.value && !dashboard.value) void loadStatus()
}

function go(path) {
  statusOpen.value = false
  router.push(path)
}

function handleDocumentClick(event) {
  if (!event.target.closest('.status-wrap')) statusOpen.value = false
}

watch(() => route.path, () => { statusOpen.value = false })
onMounted(() => document.addEventListener('click', handleDocumentClick))
onUnmounted(() => document.removeEventListener('click', handleDocumentClick))
</script>

<style scoped>
.topbar {
  position: relative;
  z-index: 40;
  height: var(--topbar-height);
  min-height: var(--topbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 0 28px 0 30px;
  border-bottom: 1px solid var(--shell-border);
  background: color-mix(in srgb, var(--shell-surface) 86%, transparent);
  backdrop-filter: blur(18px);
  -webkit-app-region: drag;
}

.topbar-title,
.topbar-actions,
.status-wrap,
.status-trigger,
.command-trigger,
.icon-button,
.status-metric,
.status-popover-footer button {
  -webkit-app-region: no-drag;
}

.topbar-title { min-width: 0; }
.topbar-eyebrow,
.status-eyebrow {
  display: block;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .12em;
  line-height: 14px;
}

.topbar-heading { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.topbar-heading h1 { color: var(--text); font-size: 17px; line-height: 24px; font-weight: 680; letter-spacing: -.2px; }
.topbar-separator { color: var(--border-strong); }
.topbar-subtitle { color: var(--text-muted); font-size: 13px; white-space: nowrap; }
.topbar-actions { display: flex; align-items: center; gap: 10px; }

.command-trigger,
.status-trigger {
  height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--shell-border);
  border-radius: 10px;
  background: var(--shell-surface-raised);
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast);
}
.command-trigger { min-width: 202px; padding: 0 8px 0 11px; }
.command-trigger:hover,
.status-trigger:hover,
.status-trigger.is-open { border-color: color-mix(in srgb, var(--primary) 30%, var(--shell-border)); color: var(--primary); box-shadow: var(--shadow-xs); }
.command-trigger > .t-icon { font-size: 15px; }
kbd { margin-left: auto; padding: 2px 5px; border-radius: 5px; background: var(--bg-subtle); color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; }

.status-wrap { position: relative; }
.status-trigger { padding: 0 10px; }
.status-label { font-size: 12px; color: inherit; }
.status-chevron { color: var(--text-muted); font-size: 14px; transition: transform var(--transition-fast); }
.status-trigger.is-open .status-chevron { transform: rotate(180deg); }
.status-indicator { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 13%, transparent); }
.status-indicator.warning { background: var(--warning); box-shadow: 0 0 0 4px color-mix(in srgb, var(--warning) 15%, transparent); }

.status-popover { position: absolute; z-index: 60; top: calc(100% + 10px); right: 0; width: 336px; padding: 16px; border: 1px solid var(--shell-border); border-radius: 14px; background: var(--shell-surface-raised); box-shadow: var(--shadow-xl); }
.status-popover-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.status-popover-header h2 { margin-top: 1px; color: var(--text); font-size: 15px; line-height: 22px; }
.icon-button { width: 30px; height: 30px; display: inline-grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.icon-button:hover:not(:disabled) { background: var(--bg-subtle); color: var(--primary); }
.icon-button:disabled { cursor: wait; }
.status-summary { display: flex; align-items: center; gap: 10px; margin: 16px 0; padding: 12px; border-radius: 10px; background: var(--bg-subtle); }
.status-summary strong { display: block; color: var(--text); font-size: 13px; line-height: 19px; }
.status-summary p { margin-top: 2px; color: var(--text-muted); font-size: 11px; }
.status-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.status-metric { min-width: 0; padding: 10px 8px; border: 1px solid var(--border-light); border-radius: 10px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.status-metric:hover { border-color: color-mix(in srgb, var(--primary) 30%, var(--border-light)); background: var(--primary-soft); }
.status-metric span { display: block; color: var(--text-muted); font-size: 10px; white-space: nowrap; }
.status-metric strong { display: block; margin-top: 4px; overflow: hidden; color: var(--text); font-size: 13px; line-height: 18px; white-space: nowrap; text-overflow: ellipsis; }
.status-metric strong.danger { color: var(--danger); }
.status-popover-footer { display: flex; justify-content: flex-end; margin-top: 14px; }
.status-popover-footer button { display: inline-flex; align-items: center; gap: 4px; padding: 4px 0; border: 0; background: transparent; color: var(--primary); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.status-popover-footer button:hover { color: var(--primary-hover); }
.status-popover-enter-active,.status-popover-leave-active { transition: opacity .16s ease, transform .16s ease; }
.status-popover-enter-from,.status-popover-leave-to { opacity: 0; transform: translateY(-5px); }
.spinning { animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 900px) { .command-trigger { min-width: 38px; padding: 0 10px; } .command-trigger span,.command-trigger kbd,.status-label { display: none; } .topbar { padding-right: 16px; } }
</style>
