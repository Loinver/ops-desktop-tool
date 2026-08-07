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
            <span class="notification-eyebrow">{{
              settingsOpen ? 'NOTIFICATION SETTINGS' : 'OPS NOTIFICATIONS'
            }}</span>
            <h2>{{ settingsOpen ? '通知设置' : '全局通知' }}</h2>
          </div>
          <div class="notification-header-actions">
            <template v-if="settingsOpen">
              <button type="button" title="返回通知列表" @click="settingsOpen = false">
                <t-icon name="chevron-left" />
              </button>
            </template>
            <template v-else>
              <button type="button" :disabled="loading" title="刷新通知" @click="loadEvents">
                <t-icon name="refresh" :class="{ spinning: loading }" />
              </button>
              <button type="button" title="通知设置" @click="openSettings">
                <t-icon name="setting" />
              </button>
              <button type="button" :disabled="!unreadCount || markingRead" @click="markAllRead">
                全部已读
              </button>
            </template>
          </div>
        </header>

        <div v-if="settingsOpen" class="notification-settings">
          <div class="notification-support" :class="{ warning: !notificationSupported }">
            <t-icon :name="notificationSupported ? 'check-circle' : 'info-circle'" />
            <span>
              <strong>{{
                notificationSupported ? '系统通知可用' : '当前系统不支持桌面通知'
              }}</strong>
              <small v-if="quietNow">当前处于免打扰时段，事件仍会保留在通知中心。</small>
              <small v-else>事件通知会遵循下方严重度、来源和免打扰设置。</small>
            </span>
          </div>

          <div class="notification-setting-list">
            <label class="notification-setting-row">
              <span><strong>桌面通知</strong><small>应用在后台时推送系统通知</small></span>
              <input v-model="preferences.desktopEnabled" type="checkbox" />
            </label>
            <label class="notification-setting-row">
              <span><strong>通知声音</strong><small>使用系统默认通知提示音</small></span>
              <input
                v-model="preferences.soundEnabled"
                type="checkbox"
                :disabled="!preferences.desktopEnabled"
              />
            </label>
            <label class="notification-setting-row">
              <span><strong>前台也通知</strong><small>应用正在使用时仍显示系统通知</small></span>
              <input
                v-model="preferences.showWhenFocused"
                type="checkbox"
                :disabled="!preferences.desktopEnabled"
              />
            </label>
            <label class="notification-setting-row">
              <span><strong>恢复通知</strong><small>异常恢复正常后发送一条通知</small></span>
              <input
                v-model="preferences.notifyRecoveries"
                type="checkbox"
                :disabled="!preferences.desktopEnabled"
              />
            </label>
          </div>

          <fieldset class="notification-setting-group" :disabled="!preferences.desktopEnabled">
            <legend>通知严重度</legend>
            <div class="notification-option-grid severity-options">
              <label v-for="item in severityOptions" :key="item.value">
                <input v-model="preferences.severities[item.value]" type="checkbox" />
                <span :class="`severity-text-${item.value}`">{{ item.label }}</span>
              </label>
            </div>
          </fieldset>

          <fieldset class="notification-setting-group" :disabled="!preferences.desktopEnabled">
            <legend>事件来源</legend>
            <div class="notification-option-grid source-options">
              <label v-for="item in sourceOptions" :key="item.value">
                <input v-model="preferences.sources[item.value]" type="checkbox" />
                <span>{{ item.label }}</span>
              </label>
            </div>
          </fieldset>

          <fieldset
            class="notification-setting-group quiet-settings"
            :disabled="!preferences.desktopEnabled"
          >
            <legend>免打扰</legend>
            <label class="notification-setting-row compact">
              <span><strong>启用免打扰时段</strong><small>跨午夜时段会自动识别</small></span>
              <input v-model="preferences.quietHours.enabled" type="checkbox" />
            </label>
            <div class="quiet-time-row">
              <label
                >开始<input
                  v-model="preferences.quietHours.start"
                  type="time"
                  :disabled="!preferences.quietHours.enabled"
              /></label>
              <span>至</span>
              <label
                >结束<input
                  v-model="preferences.quietHours.end"
                  type="time"
                  :disabled="!preferences.quietHours.enabled"
              /></label>
            </div>
          </fieldset>

          <label class="notification-repeat-field">
            <span><strong>重复通知间隔</strong><small>相同事件在间隔内只显示一次</small></span>
            <select
              v-model.number="preferences.repeatIntervalMinutes"
              :disabled="!preferences.desktopEnabled"
            >
              <option :value="5">5 分钟</option>
              <option :value="15">15 分钟</option>
              <option :value="30">30 分钟</option>
              <option :value="60">1 小时</option>
              <option :value="180">3 小时</option>
            </select>
          </label>

          <fieldset
            v-if="desktopIntegration.supported"
            class="notification-setting-group desktop-integration-settings"
          >
            <legend>{{ desktopIntegration.platformLabel }} 集成</legend>
            <label class="notification-setting-row compact">
              <span>
                <strong>登录时启动</strong>
                <small>{{
                  desktopIntegration.loginItemAvailable
                    ? desktopIntegration.platform === 'win32'
                      ? '登录 Windows 后自动在系统托盘后台启动 Ops Desktop'
                      : '登录 macOS 后自动启动 Ops Desktop'
                    : '安装版应用中可启用此选项'
                }}</small>
              </span>
              <input
                :checked="desktopIntegration.openAtLogin"
                type="checkbox"
                :disabled="!desktopIntegration.loginItemAvailable || savingDesktopIntegration"
                @change="saveLoginItem($event.target.checked)"
              />
            </label>
            <div v-if="desktopIntegration.dockBadgeSupported" class="desktop-integration-summary">
              <span>
                <strong>Dock 未读角标</strong>
                <small>
                  {{
                    desktopIntegration.unreadCount
                      ? `当前显示 ${desktopIntegration.unreadCount} 条未读`
                      : '有未读运维事件时自动显示'
                  }}
                </small>
              </span>
            </div>
            <div v-else-if="desktopIntegration.traySupported" class="desktop-integration-summary">
              <span>
                <strong>系统托盘后台运行</strong>
                <small>关闭窗口后继续运行，可从托盘菜单恢复窗口或退出应用。</small>
              </span>
            </div>
            <div class="desktop-integration-summary">
              <span>
                <strong>系统通知权限</strong>
                <small>
                  若未看到通知，请在 {{ desktopIntegration.platformLabel }} 系统设置中确认允许。
                </small>
              </span>
              <button
                type="button"
                :disabled="
                  openingNotificationSettings || !desktopIntegration.notificationSettingsAvailable
                "
                @click="openSystemNotificationSettings"
              >
                {{ openingNotificationSettings ? '打开中…' : '系统设置' }}
              </button>
            </div>
          </fieldset>

          <div class="notification-settings-actions">
            <span :class="{ error: preferenceError }">{{ preferenceMessage }}</span>
            <div>
              <button
                type="button"
                :disabled="testingNotification || !notificationSupported"
                @click="testNotification"
              >
                {{ testingNotification ? '发送中…' : '测试通知' }}
              </button>
              <button
                class="primary"
                type="button"
                :disabled="savingPreferences"
                @click="savePreferences"
              >
                {{ savingPreferences ? '保存中…' : '保存设置' }}
              </button>
            </div>
          </div>
        </div>

        <template v-else>
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
              :class="[
                { unread: !item.readAt },
                `severity-${item.severity || item.level || 'info'}`
              ]"
              @click="openEvent(item)"
            >
              <span class="notification-dot"></span>
              <span class="notification-content">
                <span class="notification-title-row">
                  <strong>{{ item.title }}</strong>
                  <time>{{ timeText(item.updatedAt || item.lastOccurredAt) }}</time>
                </span>
                <span class="notification-description">{{
                  item.description || statusLabel(item.status)
                }}</span>
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
            <button type="button" @click="viewAll">
              查看全部事件 <t-icon name="arrow-right" />
            </button>
          </footer>
        </template>
      </section>
    </transition>
  </div>
</template>

<script setup>
import { opsApi } from '../../api/opsApi.js'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { routeForOpsEvent } from '../../utils/ops-event-route'

const route = useRoute()
const router = useRouter()
const root = ref(null)
const open = ref(false)
const settingsOpen = ref(false)
const loading = ref(false)
const markingRead = ref(false)
const savingPreferences = ref(false)
const testingNotification = ref(false)
const savingDesktopIntegration = ref(false)
const openingNotificationSettings = ref(false)
const notificationSupported = ref(true)
const quietNow = ref(false)
const preferenceMessage = ref('')
const preferenceError = ref(false)
const events = ref([])
const summary = ref({})
let pollTimer = null
let unsubscribeNotificationOpen = null
let unsubscribeNotificationSettingsOpen = null

const desktopIntegration = reactive({
  supported: false,
  platform: '',
  platformLabel: '',
  packaged: false,
  dockBadgeSupported: false,
  traySupported: false,
  unreadCount: 0,
  loginItemAvailable: false,
  openAtLogin: false,
  notificationSettingsAvailable: false
})

const preferences = reactive({
  desktopEnabled: true,
  soundEnabled: true,
  showWhenFocused: false,
  notifyRecoveries: true,
  repeatIntervalMinutes: 15,
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  severities: { critical: true, warning: true, info: false },
  sources: {
    release: true,
    'model-monitor': true,
    model: true,
    automation: true,
    log: true,
    copilot: true,
    'node-service': true,
    'data-backup': true,
    system: true
  }
})

const severityOptions = [
  { value: 'critical', label: '严重' },
  { value: 'warning', label: '警告' },
  { value: 'info', label: '信息' }
]
const sourceOptions = [
  { value: 'release', label: '系统发布' },
  { value: 'model-monitor', label: '模型巡检' },
  { value: 'model', label: '模型测试' },
  { value: 'automation', label: '自动化巡检' },
  { value: 'node-service', label: 'Node 服务' },
  { value: 'data-backup', label: '本地数据备份' },
  { value: 'log', label: '日志分析' },
  { value: 'copilot', label: 'AI Copilot' },
  { value: 'system', label: '系统' }
]

const unreadCount = computed(
  () => Number(summary.value?.unread) || events.value.filter((item) => !item.readAt).length
)
const unreadCritical = computed(() => Number(summary.value?.unreadCritical) || 0)
const unreadLabel = computed(() => (unreadCount.value > 99 ? '99+' : String(unreadCount.value)))

const SOURCE_LABELS = Object.fromEntries(sourceOptions.map((item) => [item.value, item.label]))

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || '系统'
}

function statusLabel(status) {
  return { open: '待处理', acknowledged: '已确认', resolved: '已解决' }[status] || '事件更新'
}

function timeText(timestamp) {
  const value = Number(timestamp)
  if (!value) return '刚刚'
  const diff = Math.max(0, Date.now() - value)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value)
}

function applyPreferences(next = {}) {
  Object.assign(preferences, {
    desktopEnabled: next.desktopEnabled !== false,
    soundEnabled: next.soundEnabled !== false,
    showWhenFocused: next.showWhenFocused === true,
    notifyRecoveries: next.notifyRecoveries !== false,
    repeatIntervalMinutes: Number(next.repeatIntervalMinutes) || 15
  })
  Object.assign(preferences.quietHours, next.quietHours || {})
  Object.assign(preferences.severities, next.severities || {})
  Object.assign(preferences.sources, next.sources || {})
}

function plainPreferences() {
  return {
    desktopEnabled: Boolean(preferences.desktopEnabled),
    soundEnabled: Boolean(preferences.soundEnabled),
    showWhenFocused: Boolean(preferences.showWhenFocused),
    notifyRecoveries: Boolean(preferences.notifyRecoveries),
    repeatIntervalMinutes: Number(preferences.repeatIntervalMinutes),
    quietHours: { ...preferences.quietHours },
    severities: { ...preferences.severities },
    sources: { ...preferences.sources }
  }
}

async function loadEvents() {
  if (loading.value) return
  loading.value = true
  try {
    const result = await opsApi?.getOpsEvents?.({ limit: 12 })
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

async function loadDesktopIntegration() {
  try {
    const result = await opsApi?.getDesktopIntegration?.()
    if (!result?.ok) throw new Error(result?.error || '读取桌面集成设置失败')
    Object.assign(desktopIntegration, result)
  } catch (error) {
    console.warn('读取桌面集成设置失败:', error)
  }
}

async function saveLoginItem(openAtLogin) {
  if (savingDesktopIntegration.value) return
  const previous = desktopIntegration.openAtLogin
  desktopIntegration.openAtLogin = Boolean(openAtLogin)
  savingDesktopIntegration.value = true
  preferenceMessage.value = ''
  preferenceError.value = false
  try {
    const result = await opsApi?.saveDesktopLoginItem?.(desktopIntegration.openAtLogin)
    if (!result?.ok) throw new Error(result?.error || '保存登录启动设置失败')
    desktopIntegration.openAtLogin = result.openAtLogin === true
    preferenceMessage.value = desktopIntegration.openAtLogin
      ? '已启用登录时启动'
      : '已关闭登录时启动'
  } catch (error) {
    desktopIntegration.openAtLogin = previous
    preferenceMessage.value = error.message || '保存登录启动设置失败'
    preferenceError.value = true
  } finally {
    savingDesktopIntegration.value = false
  }
}

async function openSystemNotificationSettings() {
  if (openingNotificationSettings.value) return
  openingNotificationSettings.value = true
  preferenceMessage.value = ''
  preferenceError.value = false
  try {
    const result = await opsApi?.openDesktopNotificationSettings?.()
    if (!result?.ok) throw new Error(result?.error || '打开系统通知设置失败')
    preferenceMessage.value = `已打开 ${desktopIntegration.platformLabel || '系统'} 通知设置`
  } catch (error) {
    preferenceMessage.value = error.message || '打开系统通知设置失败'
    preferenceError.value = true
  } finally {
    openingNotificationSettings.value = false
  }
}

async function loadPreferences() {
  preferenceMessage.value = ''
  preferenceError.value = false
  try {
    const result = await opsApi?.getOpsNotificationPreferences?.()
    if (!result?.ok) throw new Error(result?.error || '读取通知设置失败')
    applyPreferences(result.preferences)
    notificationSupported.value = result.supported !== false
    quietNow.value = Boolean(result.quietNow)
  } catch (error) {
    preferenceMessage.value = error.message || '读取通知设置失败'
    preferenceError.value = true
  }
}

async function savePreferences() {
  if (savingPreferences.value) return
  savingPreferences.value = true
  preferenceMessage.value = ''
  preferenceError.value = false
  try {
    const result = await opsApi?.saveOpsNotificationPreferences?.(plainPreferences())
    if (!result?.ok) throw new Error(result?.error || '保存通知设置失败')
    applyPreferences(result.preferences)
    notificationSupported.value = result.supported !== false
    quietNow.value = Boolean(result.quietNow)
    preferenceMessage.value = '通知设置已保存'
  } catch (error) {
    preferenceMessage.value = error.message || '保存通知设置失败'
    preferenceError.value = true
  } finally {
    savingPreferences.value = false
  }
}

async function testNotification() {
  if (testingNotification.value) return
  testingNotification.value = true
  preferenceMessage.value = ''
  preferenceError.value = false
  try {
    const result = await opsApi?.testOpsNotification?.()
    if (!result?.ok || !result.shown) throw new Error(result?.error || '当前系统无法发送桌面通知')
    preferenceMessage.value = '测试通知已发送'
  } catch (error) {
    preferenceMessage.value = error.message || '测试通知发送失败'
    preferenceError.value = true
  } finally {
    testingNotification.value = false
  }
}

async function markRead(ids) {
  const result = await opsApi?.markOpsEventsRead?.({ ids })
  if (!result?.ok) return false
  const readAt = Number(result.readAt) || Date.now()
  const idSet = new Set(ids)
  events.value = events.value.map((item) => (idSet.has(item.id) ? { ...item, readAt } : item))
  summary.value = result.summary || summary.value
  return true
}

async function markAllRead() {
  if (markingRead.value || !unreadCount.value) return
  markingRead.value = true
  try {
    const result = await opsApi?.markOpsEventsRead?.({ all: true })
    if (result?.ok) {
      const readAt = Number(result.readAt) || Date.now()
      events.value = events.value.map((item) => ({ ...item, readAt: item.readAt || readAt }))
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

async function handleNativeNotificationOpen(item) {
  if (!item?.id) return
  if (!item.readAt) await markRead([item.id])
  open.value = false
  await router.push(routeForOpsEvent(item))
  await loadEvents()
}

function viewAll() {
  open.value = false
  router.push('/ops-control-center')
}

function toggle() {
  open.value = !open.value
  if (open.value) {
    settingsOpen.value = false
    void loadEvents()
  }
}

function openSettings() {
  settingsOpen.value = true
  void Promise.all([loadPreferences(), loadDesktopIntegration()])
}

function handleNativeNotificationSettingsOpen() {
  open.value = true
  settingsOpen.value = true
  void Promise.all([loadPreferences(), loadDesktopIntegration()])
}

function handleDocumentClick(event) {
  const container = root.value
  if (!container) return

  // Clicking a control can synchronously replace it (for example, the settings
  // button swaps the notification-list actions). Use the event path captured
  // before that DOM change so this interaction is not mistaken for an outside click.
  const clickedInside =
    event.composedPath?.().includes(container) ||
    (event.target instanceof Node && container.contains(event.target))

  if (!clickedInside) open.value = false
}

function handleKeydown(event) {
  if (event.key !== 'Escape') return
  if (settingsOpen.value) settingsOpen.value = false
  else open.value = false
}

function handleFocus() {
  void loadEvents()
}

watch(
  () => route.fullPath,
  () => {
    open.value = false
    void loadEvents()
  }
)

onMounted(() => {
  void Promise.all([loadEvents(), loadPreferences(), loadDesktopIntegration()])
  pollTimer = window.setInterval(loadEvents, 45_000)
  unsubscribeNotificationOpen = opsApi?.onOpsNotificationOpen?.(handleNativeNotificationOpen)
  unsubscribeNotificationSettingsOpen = opsApi?.onOpsNotificationSettingsOpen?.(
    handleNativeNotificationSettingsOpen
  )
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('focus', handleFocus)
})

onUnmounted(() => {
  window.clearInterval(pollTimer)
  unsubscribeNotificationOpen?.()
  unsubscribeNotificationSettingsOpen?.()
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('focus', handleFocus)
})
</script>

<style scoped>
.ops-notification-center,
.notification-trigger,
.notification-popover,
.notification-popover button,
.notification-popover input,
.notification-popover select {
  -webkit-app-region: no-drag;
}
.ops-notification-center {
  position: relative;
}
.notification-trigger {
  position: relative;
  width: 36px;
  height: 36px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--shell-border);
  border-radius: 10px;
  background: var(--shell-surface-raised);
  color: var(--text-secondary);
  font: inherit;
  font-size: 16px;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast);
}
.notification-trigger:hover,
.notification-trigger.is-open {
  border-color: color-mix(in srgb, var(--primary) 30%, var(--shell-border));
  color: var(--primary);
  box-shadow: var(--shadow-xs);
}
.notification-trigger.has-critical {
  color: var(--danger);
}
.notification-badge {
  position: absolute;
  top: -6px;
  right: -7px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border: 2px solid var(--shell-surface);
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}
.notification-popover {
  position: absolute;
  z-index: 65;
  top: calc(100% + 10px);
  right: 0;
  width: min(400px, calc(100vw - 24px));
  overflow: hidden;
  border: 1px solid var(--shell-border);
  border-radius: 14px;
  background: var(--shell-surface-raised);
  box-shadow: var(--shadow-xl);
}
.notification-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--border-light);
}
.notification-eyebrow {
  display: block;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 14px;
}
.notification-header h2 {
  margin-top: 1px;
  color: var(--text);
  font-size: 15px;
  line-height: 22px;
}
.notification-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.notification-header-actions button {
  min-width: 30px;
  min-height: 30px;
  padding: 0 7px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.notification-header-actions button:has(.t-icon) {
  width: 30px;
  padding: 0;
  font-size: 14px;
}
.notification-header-actions button:hover:not(:disabled) {
  background: var(--bg-subtle);
  color: var(--primary);
}
.notification-header-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
.notification-list,
.notification-settings {
  max-height: min(520px, calc(100vh - 190px));
  overflow-y: auto;
  overscroll-behavior: contain;
}
.notification-item {
  width: 100%;
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 10px;
  padding: 12px 16px;
  border: 0;
  border-bottom: 1px solid var(--border-light);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.notification-item:hover {
  background: var(--bg-subtle);
}
.notification-item.unread {
  background: color-mix(in srgb, var(--primary-soft) 52%, transparent);
}
.notification-item.unread:hover {
  background: var(--primary-soft);
}
.notification-dot {
  width: 7px;
  height: 7px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}
.severity-warning .notification-dot {
  background: var(--warning);
}
.severity-critical .notification-dot {
  background: var(--danger);
}
.severity-info .notification-dot {
  background: var(--info);
}
.notification-content {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.notification-title-row {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.notification-title-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notification-title-row time {
  flex: none;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 18px;
  white-space: nowrap;
}
.notification-description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 17px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow-wrap: anywhere;
}
.notification-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.notification-meta em {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 9px;
  font-style: normal;
  line-height: 15px;
}
.notification-empty {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
}
.notification-empty > .t-icon {
  color: var(--success);
  font-size: 26px;
}
.notification-empty strong {
  color: var(--text-secondary);
  font-size: 13px;
}
.notification-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 10px;
}
.notification-footer button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--primary);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.notification-settings {
  padding: 14px 16px 16px;
}
.notification-support {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--success-light);
  color: var(--success);
}
.notification-support.warning {
  background: var(--warning-light);
  color: var(--warning);
}
.notification-support > .t-icon {
  flex: none;
  margin-top: 2px;
}
.notification-support span {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.notification-support strong {
  color: var(--text);
  font-size: 12px;
  line-height: 17px;
}
.notification-support small {
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 15px;
}
.notification-setting-list {
  margin-top: 10px;
}
.notification-setting-row,
.notification-repeat-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 48px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--border-light);
}
.notification-setting-row.compact {
  min-height: 44px;
  padding: 4px 0 8px;
}
.notification-setting-row > span,
.notification-repeat-field > span {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.notification-setting-row strong,
.notification-repeat-field strong {
  color: var(--text);
  font-size: 12px;
  line-height: 17px;
}
.notification-setting-row small,
.notification-repeat-field small {
  color: var(--text-muted);
  font-size: 10px;
  line-height: 15px;
}
.notification-setting-row > input[type='checkbox'] {
  width: var(--checkbox-size);
  height: var(--checkbox-size);
  flex: none;
  margin: 0;
  accent-color: var(--primary);
}
.notification-setting-group {
  min-width: 0;
  margin: 14px 0 0;
  padding: 0;
  border: 0;
}
.notification-setting-group legend {
  margin-bottom: 8px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.notification-option-grid {
  display: grid;
  gap: 6px;
}
.notification-option-grid.severity-options {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.notification-option-grid.source-options {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.notification-option-grid label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}
.notification-option-grid label:has(input:checked) {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--border-light));
  background: var(--primary-soft);
  color: var(--text);
}
.notification-option-grid input {
  width: 14px;
  height: 14px;
  flex: none;
  accent-color: var(--primary);
}
.notification-option-grid span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.severity-text-critical {
  color: var(--danger);
}
.severity-text-warning {
  color: var(--warning);
}
.severity-text-info {
  color: var(--info);
}
.quiet-settings {
  padding: 10px 12px 12px;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  background: var(--bg-subtle);
}
.quiet-settings legend {
  padding: 0 4px;
  margin: 0;
}
.quiet-time-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: 8px;
  color: var(--text-muted);
  font-size: 10px;
}
.quiet-time-row label {
  display: grid;
  gap: 4px;
}
.quiet-time-row input,
.notification-repeat-field select {
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  font: inherit;
  font-size: 11px;
}
.notification-repeat-field {
  margin-top: 8px;
}
.notification-repeat-field select {
  width: 92px;
  flex: none;
}
.desktop-integration-settings {
  padding: 10px 12px 6px;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  background: var(--bg-subtle);
}
.desktop-integration-settings legend {
  padding: 0 4px;
  margin: 0;
}
.desktop-integration-summary {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
}
.desktop-integration-summary:last-child {
  border-bottom: 0;
}
.desktop-integration-summary > span {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.desktop-integration-summary strong {
  color: var(--text);
  font-size: 12px;
  line-height: 17px;
}
.desktop-integration-summary small {
  color: var(--text-muted);
  font-size: 10px;
  line-height: 15px;
}
.desktop-integration-summary button {
  min-height: 30px;
  flex: none;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.desktop-integration-summary button:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}
.desktop-integration-summary button:disabled {
  opacity: 0.5;
  cursor: default;
}
.notification-settings-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
}
.notification-settings-actions > span {
  min-width: 0;
  color: var(--success);
  font-size: 10px;
  line-height: 15px;
}
.notification-settings-actions > span.error {
  color: var(--danger);
}
.notification-settings-actions > div {
  display: flex;
  gap: 7px;
  margin-left: auto;
}
.notification-settings-actions button {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.notification-settings-actions button.primary {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}
.notification-settings-actions button:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}
.notification-settings-actions button.primary:hover:not(:disabled) {
  color: #fff;
  background: var(--primary-hover);
}
.notification-settings-actions button:disabled,
.notification-setting-group:disabled {
  opacity: 0.5;
}
.notification-popover-enter-active,
.notification-popover-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.notification-popover-enter-from,
.notification-popover-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}
.spinning {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .notification-popover {
    right: -46px;
  }
  .notification-settings-actions {
    align-items: flex-start;
    flex-direction: column;
  }
  .notification-settings-actions > div {
    width: 100%;
    margin-left: 0;
  }
  .notification-settings-actions button {
    flex: 1;
  }
}
</style>
