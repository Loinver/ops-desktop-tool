<template>
  <div class="page dashboard-page">
    <header class="page-header dashboard-header">
      <div class="page-heading">
        <div class="page-eyebrow"><t-icon name="dashboard" /> OPS DASHBOARD</div>
        <h2 class="page-title">运维仪表盘</h2>
        <p class="page-desc">统一查看发布、模型可靠性、自动化巡检、数据备份与待处理事件</p>
      </div>
      <div class="page-actions">
        <span class="realtime-state">
          <span class="realtime-dot" aria-hidden="true"></span>
          实时同步<span v-if="lastRefreshedAt"> · {{ formatTime(lastRefreshedAt) }}</span>
        </span>
        <button type="button" class="refresh-button" @click="$router.push('/ops-task-center')">
          统一任务中心
        </button>
        <button type="button" class="refresh-button" :disabled="loading" @click="loadDashboard">
          <t-icon name="refresh" :class="{ spinning: loading }" /> 刷新
        </button>
      </div>
    </header>

    <main class="page-content dashboard-content">
      <section v-if="loadError" class="dashboard-error" role="alert">
        <div>
          <strong>{{
            dataStale ? '仪表盘刷新失败，当前显示上次成功数据' : '仪表盘数据加载失败'
          }}</strong>
          <p>{{ loadError }}</p>
        </div>
        <button type="button" :disabled="loading" @click="loadDashboard">重新加载</button>
      </section>

      <section v-if="!hasLoaded" class="panel dashboard-placeholder" :aria-busy="loading">
        <t-icon :name="loading ? 'loading' : 'error-circle'" :class="{ spinning: loading }" />
        <div>
          <strong>{{ loading ? '正在汇总运维状态' : '暂时无法显示仪表盘数据' }}</strong>
          <p>
            {{
              loading
                ? '正在读取发布、模型、自动化、Node 服务、备份与事件数据。'
                : '请重新加载。成功读取前不会把未知状态显示为健康或零异常。'
            }}
          </p>
        </div>
      </section>

      <template v-else>
        <section class="metric-grid">
          <article class="metric-card primary interactive-surface">
            <span>模型可用率</span>
            <strong>{{ availabilityText }}</strong>
            <small>最近 20 次测试</small>
          </article>
          <article class="metric-card success interactive-surface">
            <span>发布成功</span>
            <strong>{{ dashboard.release?.success || 0 }}</strong>
            <small
              >共 {{ dashboard.release?.total || 0 }} 条记录，失败
              {{ dashboard.release?.failed || 0 }} 次</small
            >
          </article>
          <article
            :class="[
              'metric-card',
              'interactive-surface',
              eventSummary.active ? 'danger' : 'success'
            ]"
          >
            <span>待处理事件</span>
            <strong>{{ eventSummary.active || 0 }}</strong>
            <small
              >严重 {{ eventSummary.critical || 0 }} · 未读 {{ eventSummary.unread || 0 }}</small
            >
          </article>
          <article class="metric-card neutral interactive-surface">
            <span>巡检覆盖</span>
            <strong>{{ inspectionCoverage }} 项</strong>
            <small>{{ coverageDescription }}</small>
          </article>
        </section>

        <section class="dashboard-grid health-grid">
          <article class="panel attention-panel">
            <div class="panel-title attention-panel-title">
              <div>
                <h3>待处理事件</h3>
                <p>统一汇总发布、模型、自动化、Node 服务与数据备份异常</p>
              </div>
              <div class="attention-actions">
                <span class="attention-count" :class="{ 'has-risk': eventSummary.active }">
                  {{ eventSummary.active || 0 }} 个活跃
                </span>
                <button type="button" @click="$router.push('/ops-control-center')">全部事件</button>
              </div>
            </div>
            <div class="event-filter-row" aria-label="仪表盘事件筛选">
              <label>
                <span>来源</span>
                <select v-model="eventSourceFilter">
                  <option value="">全部来源</option>
                  <option v-for="source in eventSources" :key="source" :value="source">
                    {{ sourceName(source) }}
                  </option>
                </select>
              </label>
              <label>
                <span>级别</span>
                <select v-model="eventSeverityFilter">
                  <option value="">全部级别</option>
                  <option value="critical">严重</option>
                  <option value="warning">警告</option>
                  <option value="info">提示</option>
                </select>
              </label>
              <label>
                <span>时间</span>
                <select v-model="eventTimeFilter">
                  <option value="">全部时间</option>
                  <option value="24h">最近 24 小时</option>
                  <option value="7d">最近 7 天</option>
                </select>
              </label>
            </div>
            <div v-if="filteredLatestEvents.length" class="event-overview-list">
              <button
                v-for="item in filteredLatestEvents"
                :key="item.id"
                type="button"
                class="event-overview-item"
                @click="openEvent(item)"
              >
                <span
                  :class="['event-severity', item.severity || 'info']"
                  aria-hidden="true"
                ></span>
                <span class="event-overview-content">
                  <strong>{{ item.title }}</strong>
                  <small>
                    {{ sourceName(item.sourceType) }} · {{ formatDate(item.updatedAt) }}
                    <template v-if="item.occurrenceCount > 1">
                      · 重复 {{ item.occurrenceCount }} 次
                    </template>
                  </small>
                </span>
                <span :class="['event-status', item.status]">{{
                  eventStatusName(item.status)
                }}</span>
              </button>
            </div>
            <div v-else class="empty-panel healthy-empty">
              <t-icon :name="latestEvents.length ? 'filter-clear' : 'check-circle'" />
              <div>
                <strong>{{
                  latestEvents.length ? '当前筛选条件没有匹配事件' : '当前没有待处理事件'
                }}</strong>
                <p>
                  {{
                    latestEvents.length
                      ? '可调整来源、级别或时间范围，完整事件仍可在运维中心查看。'
                      : '后台巡检仍会持续发现异常，并在恢复后保留完整时间线。'
                  }}
                </p>
              </div>
            </div>
          </article>

          <article class="panel coverage-panel">
            <div class="panel-title">
              <div>
                <h3>巡检覆盖</h3>
                <p>检查关键能力是否已配置、正在运行并能产生事件</p>
              </div>
            </div>
            <div class="coverage-list">
              <button type="button" class="coverage-item" @click="$router.push('/model-test')">
                <span :class="['coverage-state', modelCoverage.state]"></span>
                <span>
                  <strong>模型定时巡检</strong>
                  <small>{{ modelCoverage.description }}</small>
                </span>
                <t-icon name="arrow-right" />
              </button>
              <button
                type="button"
                class="coverage-item"
                @click="$router.push('/ops-control-center')"
              >
                <span :class="['coverage-state', automationCoverage.state]"></span>
                <span>
                  <strong>HTTP / TCP 自动化</strong>
                  <small>{{ automationCoverage.description }}</small>
                </span>
                <t-icon name="arrow-right" />
              </button>
              <button type="button" class="coverage-item" @click="$router.push('/node-services')">
                <span :class="['coverage-state', nodeCoverage.state]"></span>
                <span>
                  <strong>Node 服务关注</strong>
                  <small>{{ nodeCoverage.description }}</small>
                </span>
                <t-icon name="arrow-right" />
              </button>
              <button type="button" class="coverage-item" @click="$router.push('/data-management')">
                <span :class="['coverage-state', backupCoverage.state]"></span>
                <span>
                  <strong>本地数据备份</strong>
                  <small>{{ backupCoverage.description }}</small>
                </span>
                <t-icon name="arrow-right" />
              </button>
            </div>
          </article>
        </section>

        <section class="dashboard-grid backup-grid">
          <article class="panel backup-panel" :class="`backup-panel--${backupStatus}`">
            <div class="panel-title backup-panel-title">
              <div>
                <h3>数据备份</h3>
                <p>{{ backup.summary || '正在读取自动备份状态' }}</p>
              </div>
              <div class="backup-title-actions">
                <span class="backup-status" :class="`is-${backupStatus}`">
                  <t-icon :name="backupStatusIcon" /> {{ backupStatusLabel }}
                </span>
                <button type="button" @click="$router.push('/data-management')">管理备份</button>
              </div>
            </div>
            <div class="backup-stats">
              <div class="backup-stat">
                <span>上次成功</span>
                <strong>{{ formatDate(backup.lastSuccessfulAt) }}</strong>
              </div>
              <div class="backup-stat">
                <span>下次计划</span>
                <strong>{{ backup.enabled ? formatDate(backup.nextRunAt) : '未启用' }}</strong>
              </div>
              <div class="backup-stat">
                <span>缺失文件</span>
                <strong :class="{ 'has-warning': backup.missingCount }">{{
                  backup.missingCount ? `${backup.missingCount} 个` : '无'
                }}</strong>
              </div>
            </div>
          </article>
        </section>

        <section class="dashboard-grid">
          <article class="panel trend-panel">
            <div class="panel-title">
              <div>
                <h3>模型可用趋势</h3>
                <p>绿色正常、红色失败、橙色无法验证</p>
              </div>
            </div>
            <div v-if="trend.length" class="trend-chart">
              <div
                v-for="item in trend"
                :key="item.timestamp"
                class="trend-column"
                :title="trendTitle(item)"
              >
                <div class="trend-bars">
                  <span
                    class="bar failed"
                    :style="{ height: `${barHeight(item.failed, item.total)}%` }"
                  ></span>
                  <span
                    class="bar gateway"
                    :style="{ height: `${barHeight(item.gateway, item.total)}%` }"
                  ></span>
                  <span
                    class="bar ok"
                    :style="{ height: `${barHeight(item.ok, item.total)}%` }"
                  ></span>
                </div>
                <time>{{ shortDate(item.timestamp) }}</time>
              </div>
            </div>
            <div v-else class="empty-panel">完成一次模型测试后，这里会显示趋势。</div>
          </article>

          <article class="panel monitor-panel">
            <div class="panel-title">
              <div>
                <h3>定时巡检</h3>
                <p>应用运行期间由主进程后台执行</p>
              </div>
            </div>
            <label
              class="switch-row"
              :title="monitorTargetCount ? '' : '请先在模型可靠性页配置巡检目标'"
              ><span>启用巡检</span
              ><input
                v-model="monitorDraft.enabled"
                type="checkbox"
                :disabled="saving || !monitorTargetCount"
            /></label>
            <label class="field-row"
              ><span>间隔（分钟）</span
              ><input
                v-model.number="monitorDraft.intervalMinutes"
                type="number"
                min="5"
                max="1440"
                :disabled="saving"
            /></label>
            <label class="switch-row"
              ><span>异常桌面通知</span
              ><input v-model="monitorDraft.notifyOnFailure" type="checkbox" :disabled="saving"
            /></label>
            <div class="monitor-meta">
              巡检目标：{{ monitorTargetCount }} 个模型<button
                v-if="!monitorTargetCount"
                type="button"
                @click="$router.push('/model-test')"
              >
                前往配置
              </button>
            </div>
            <div class="panel-actions">
              <button
                type="button"
                class="secondary"
                :disabled="saving || !monitorTargetCount"
                :title="monitorTargetCount ? '' : '请先配置巡检目标'"
                @click="runInspection"
              >
                立即巡检
              </button>
              <button type="button" class="primary-button" :disabled="saving" @click="saveMonitor">
                保存设置
              </button>
            </div>
          </article>
        </section>

        <section class="dashboard-grid history-grid">
          <article class="panel">
            <div class="panel-title">
              <div>
                <h3>最近发布</h3>
                <p>成功、失败与回滚记录</p>
              </div>
              <button type="button" @click="$router.push('/system-release')">进入发布</button>
            </div>
            <div v-if="dashboard.release?.latest?.length" class="activity-list">
              <div v-for="item in dashboard.release.latest" :key="item.id" class="activity-item">
                <span class="status-dot" :class="item.status"></span>
                <div>
                  <strong>{{ item.label }}</strong
                  ><small>{{ item.message || item.remoteDir }}</small>
                </div>
                <time>{{ formatDate(item.finishedAt) }}</time>
              </div>
            </div>
            <div v-else class="empty-panel">暂无发布记录</div>
          </article>

          <article class="panel">
            <div class="panel-title">
              <div>
                <h3>最近模型巡检</h3>
                <p>手动测试与定时巡检均会保存</p>
              </div>
              <button type="button" @click="$router.push('/model-test')">进入测试</button>
            </div>
            <div v-if="dashboard.model?.latest" class="latest-inspection">
              <div class="inspection-score">
                {{ dashboard.model.latest.summary?.ok || 0 }}/{{
                  dashboard.model.latest.summary?.total || 0
                }}
              </div>
              <div>
                <strong>{{ dashboard.model.latest.label }}</strong>
                <p>
                  失败 {{ dashboard.model.latest.summary?.failed || 0 }} · 无法验证
                  {{ dashboard.model.latest.summary?.gateway || 0 }}
                </p>
                <time>{{ formatDate(dashboard.model.latest.finishedAt) }}</time>
              </div>
            </div>
            <div v-else class="empty-panel">暂无模型测试历史</div>
          </article>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup>
import { opsApi } from '../../api/opsApi.js'
import { routeForOpsEvent } from '../../utils/ops-event-route.js'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useRouter } from 'vue-router'

const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const loadError = ref('')
const hasLoaded = ref(false)
const dataStale = ref(false)
const lastRefreshedAt = ref(0)
const eventSourceFilter = ref('')
const eventSeverityFilter = ref('')
const eventTimeFilter = ref('')
let unsubscribeOpsData = null
let fallbackRefreshTimer = null
let realtimeRefreshTimer = null
const dashboard = reactive({
  release: {},
  model: {},
  monitor: {},
  backup: {},
  events: { latest: [] },
  automation: {},
  nodeServices: {}
})
const monitorDraft = reactive({ enabled: false, intervalMinutes: 60, notifyOnFailure: true })
const trend = computed(() => dashboard.model?.trend || [])
const eventSummary = computed(() => dashboard.events?.summary || {})
const latestEvents = computed(() => dashboard.events?.latest || [])
const eventSources = computed(() => [
  ...new Set(latestEvents.value.map((item) => item.sourceType).filter(Boolean))
])
const filteredLatestEvents = computed(() => {
  const now = Date.now()
  const minimumTime =
    eventTimeFilter.value === '24h'
      ? now - 24 * 60 * 60 * 1000
      : eventTimeFilter.value === '7d'
        ? now - 7 * 24 * 60 * 60 * 1000
        : 0
  return latestEvents.value.filter(
    (item) =>
      (!eventSourceFilter.value || item.sourceType === eventSourceFilter.value) &&
      (!eventSeverityFilter.value || item.severity === eventSeverityFilter.value) &&
      (!minimumTime || Number(item.updatedAt) >= minimumTime)
  )
})
const monitorTargetCount = computed(() =>
  Number(dashboard.monitor?.targetCount ?? dashboard.monitor?.targets?.length ?? 0)
)
const availabilityText = computed(() =>
  dashboard.model?.availability == null ? '—' : `${dashboard.model.availability}%`
)
const backup = computed(() => dashboard.backup || {})
const automation = computed(() => dashboard.automation || {})
const nodeServices = computed(() => dashboard.nodeServices || {})
const inspectionCoverage = computed(
  () =>
    monitorTargetCount.value +
    (Number(automation.value.enabled) || 0) +
    (Number(nodeServices.value.enabled) || 0) +
    (backup.value.enabled ? 1 : 0)
)
const backupStatus = computed(() =>
  ['healthy', 'warning', 'error', 'disabled'].includes(backup.value.status)
    ? backup.value.status
    : 'disabled'
)
const backupStatusLabel = computed(
  () =>
    ({ healthy: '备份健康', warning: '需要关注', error: '备份异常', disabled: '计划未启用' })[
      backupStatus.value
    ]
)
const backupStatusIcon = computed(
  () =>
    ({
      healthy: 'check-circle',
      warning: 'error-circle',
      error: 'error-circle',
      disabled: 'info-circle'
    })[backupStatus.value]
)
const coverageDescription = computed(() => {
  if (!inspectionCoverage.value) return '尚未配置后台巡检'
  const abnormal =
    (monitorTargetCount.value && !dashboard.monitor?.enabled ? 1 : 0) +
    (Number(automation.value.failing) || 0) +
    (Number(automation.value.pending) || 0) +
    (Number(nodeServices.value.offline) || 0) +
    (Number(nodeServices.value.unknown) || 0) +
    (backupStatus.value === 'error' || backupStatus.value === 'warning' ? 1 : 0)
  return abnormal ? `${abnormal} 项需要关注` : '已覆盖模型、服务与数据安全'
})
const modelCoverage = computed(() => {
  if (!monitorTargetCount.value) return { state: 'neutral', description: '尚未配置巡检目标' }
  if (!dashboard.monitor?.enabled)
    return { state: 'warning', description: `${monitorTargetCount.value} 个目标，当前已暂停` }
  return {
    state: 'healthy',
    description: `${monitorTargetCount.value} 个目标，每 ${dashboard.monitor.intervalMinutes} 分钟`
  }
})
const automationCoverage = computed(() => {
  if (!automation.value.enabled) return { state: 'neutral', description: '尚未启用自动化任务' }
  if (automation.value.failing)
    return {
      state: 'danger',
      description: `${automation.value.enabled} 个启用，${automation.value.failing} 个最近失败`
    }
  if (automation.value.pending)
    return {
      state: 'warning',
      description: `${automation.value.enabled} 个启用，${automation.value.pending} 个等待首次运行`
    }
  return { state: 'healthy', description: `${automation.value.enabled} 个任务运行正常` }
})
const nodeCoverage = computed(() => {
  if (!nodeServices.value.enabled) return { state: 'neutral', description: '尚未关注 Node 服务' }
  if (nodeServices.value.offline)
    return {
      state: 'danger',
      description: `${nodeServices.value.offline} 个离线，${nodeServices.value.online || 0} 个在线`
    }
  if (nodeServices.value.unknown)
    return {
      state: 'warning',
      description: `${nodeServices.value.unknown} 个等待首次检查`
    }
  return { state: 'healthy', description: `${nodeServices.value.online || 0} 个服务在线` }
})
const backupCoverage = computed(() => ({
  state:
    backupStatus.value === 'healthy'
      ? 'healthy'
      : backupStatus.value === 'disabled'
        ? 'neutral'
        : backupStatus.value === 'error'
          ? 'danger'
          : 'warning',
  description: backup.value.summary || '自动备份计划未启用'
}))

function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(value)
    : '—'
}
function formatTime(value) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(value)
    : ''
}
function shortDate(value) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value)
    : ''
}
function barHeight(value, total) {
  return total ? Math.max(value ? 8 : 0, Math.round((value / total) * 100)) : 0
}
function trendTitle(item) {
  return `${formatDate(item.timestamp)}：正常 ${item.ok}，失败 ${item.failed}，无法验证 ${item.gateway || 0}`
}
function sourceName(source) {
  return (
    {
      release: '系统发布',
      model: '模型测试',
      'model-monitor': '模型巡检',
      automation: '自动化巡检',
      'node-service': 'Node 服务',
      'data-backup': '数据备份',
      log: '日志分析',
      copilot: 'AI Copilot',
      system: '系统'
    }[source] ||
    source ||
    '系统'
  )
}
function eventStatusName(status) {
  return { open: '待处理', acknowledged: '已确认', resolved: '已解决' }[status] || '待处理'
}
function openEvent(item) {
  if (!item?.id) return
  router.push(routeForOpsEvent(item))
}

async function loadDashboard() {
  if (loading.value) return
  loading.value = true
  loadError.value = ''
  dataStale.value = false
  try {
    const result = await opsApi.getOpsDashboard()
    if (!result.ok) throw new Error(result.error || '读取仪表盘失败')
    Object.assign(dashboard, result.data)
    Object.assign(monitorDraft, {
      enabled: Boolean(result.data.monitor?.enabled),
      intervalMinutes: result.data.monitor?.intervalMinutes || 60,
      notifyOnFailure: result.data.monitor?.notifyOnFailure !== false
    })
    hasLoaded.value = true
    lastRefreshedAt.value = Date.now()
  } catch (error) {
    loadError.value = error.message || '读取仪表盘失败'
    dataStale.value = hasLoaded.value
    MessagePlugin.error({ content: loadError.value, placement: 'bottom-right' })
  } finally {
    loading.value = false
  }
}

function queueRealtimeRefresh() {
  clearTimeout(realtimeRefreshTimer)
  realtimeRefreshTimer = setTimeout(() => {
    void loadDashboard()
  }, 200)
}

function refreshWhenVisible() {
  if (document.visibilityState === 'visible') void loadDashboard()
}

async function saveMonitor() {
  if (monitorDraft.enabled && !monitorTargetCount.value) {
    MessagePlugin.warning({ content: '请先在模型可靠性页配置巡检目标', placement: 'bottom-right' })
    return
  }
  saving.value = true
  try {
    // dashboard.monitor 中的 targets 会被 Vue 转成响应式 Proxy，不能直接通过 Electron IPC 克隆。
    // 首页只提交可编辑字段，目标列表等数据由主进程沿用当前设置。
    const result = await opsApi.saveModelMonitorSettings({
      enabled: Boolean(monitorDraft.enabled),
      intervalMinutes: Number(monitorDraft.intervalMinutes),
      notifyOnFailure: Boolean(monitorDraft.notifyOnFailure)
    })
    if (!result.ok) throw new Error(result.error || '保存巡检设置失败')
    dashboard.monitor = result.settings
    Object.assign(monitorDraft, {
      enabled: Boolean(result.settings.enabled),
      intervalMinutes: result.settings.intervalMinutes,
      notifyOnFailure: result.settings.notifyOnFailure !== false
    })
    MessagePlugin.success({ content: '巡检设置已保存', placement: 'bottom-right' })
  } catch (error) {
    MessagePlugin.error({ content: error.message, placement: 'bottom-right' })
  } finally {
    saving.value = false
  }
}

async function runInspection() {
  saving.value = true
  try {
    const result = await opsApi.runModelInspection()
    if (!result.ok) throw new Error(result.error || '巡检失败')
    MessagePlugin.success({
      content: `巡检完成：${result.entry.summary.ok}/${result.entry.summary.total} 正常`,
      placement: 'bottom-right'
    })
    await loadDashboard()
  } catch (error) {
    MessagePlugin.error({ content: error.message, placement: 'bottom-right' })
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadDashboard()
  unsubscribeOpsData = opsApi.onOpsDataChanged?.(queueRealtimeRefresh)
  fallbackRefreshTimer = setInterval(refreshWhenVisible, 30_000)
  document.addEventListener('visibilitychange', refreshWhenVisible)
  window.addEventListener('focus', refreshWhenVisible)
})

onBeforeUnmount(() => {
  unsubscribeOpsData?.()
  clearInterval(fallbackRefreshTimer)
  clearTimeout(realtimeRefreshTimer)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  window.removeEventListener('focus', refreshWhenVisible)
})
</script>

<style scoped>
.refresh-button,
.panel-title button,
.secondary,
.primary-button {
  border: 0;
  border-radius: var(--radius-sm);
  padding: 0 14px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
}

.refresh-button {
  flex-shrink: 0;
  height: var(--header-control-height);
  padding: 0 var(--button-padding-x);
  font-size: var(--header-control-font-size);
}

.refresh-button,
.secondary,
.panel-title button {
  background: var(--primary-light);
  color: #4338ca;
}

.primary-button {
  background: #4f46e5;
  color: #fff;
}

.refresh-button:disabled,
.secondary:disabled,
.primary-button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.realtime-state {
  display: inline-flex;
  align-items: center;
  min-height: var(--header-control-height);
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.realtime-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px rgb(16 185 129 / 12%);
}

.dashboard-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: 12px var(--panel-padding);
  border: 1px solid #fecaca;
  border-radius: var(--radius-md);
  background: #fef2f2;
  color: #991b1b;
}

.dashboard-error p {
  margin-top: 3px;
  font-size: 12px;
  line-height: 18px;
}

.dashboard-error button {
  flex: 0 0 auto;
  min-height: 34px;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 0 var(--button-padding-x);
  background: #fee2e2;
  color: #b91c1c;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.dashboard-placeholder {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  min-height: 150px;
  color: var(--text-secondary);
}

.dashboard-placeholder > :first-child {
  flex: 0 0 auto;
  color: var(--primary);
  font-size: 28px;
}

.dashboard-placeholder strong {
  display: block;
  color: var(--text);
  font-size: 15px;
  line-height: 22px;
}

.dashboard-placeholder p {
  margin-top: 4px;
  font-size: 13px;
  line-height: 20px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--content-gap);
}

.metric-card,
.panel {
  background: var(--card-bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.metric-card {
  padding: var(--panel-padding);
  border-top: 3px solid #6366f1;
}

.metric-card.success {
  border-top-color: var(--success);
}

.metric-card.danger {
  border-top-color: var(--danger);
}

.metric-card.neutral {
  border-top-color: var(--text-secondary);
}

.metric-card span,
.metric-card small {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 18px;
}

.metric-card strong {
  display: block;
  margin: 5px 0;
  font-size: 22px;
  line-height: 28px;
  font-weight: 650;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr);
  gap: var(--content-gap);
}

.health-grid {
  align-items: start;
}

.attention-panel-title {
  align-items: flex-start;
}

.attention-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--spacing-sm);
}

.attention-count {
  border-radius: 999px;
  padding: 4px 9px;
  background: var(--success-light);
  color: #047857;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.attention-count.has-risk {
  background: #fef2f2;
  color: #b91c1c;
}

.event-overview-list,
.coverage-list {
  display: grid;
  gap: 8px;
}

.event-filter-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.event-filter-row label {
  display: grid;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
}

.event-filter-row select {
  min-width: 0;
  min-height: var(--control-height-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 8px;
  background: var(--card-bg);
  color: var(--text);
}

.event-overview-item,
.coverage-item {
  width: 100%;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    transform 0.16s ease;
}

.event-overview-item:hover,
.coverage-item:hover {
  border-color: #c7d2fe;
  background: var(--primary-light);
  transform: translateY(-1px);
}

.event-overview-item:focus-visible,
.coverage-item:focus-visible {
  outline: 2px solid #818cf8;
  outline-offset: 2px;
}

.event-overview-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.event-severity,
.coverage-state {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--text-muted);
  box-shadow: 0 0 0 3px rgb(148 163 184 / 14%);
}

.event-severity.warning,
.coverage-state.warning {
  background: var(--warning);
  box-shadow: 0 0 0 3px rgb(245 158 11 / 14%);
}

.event-severity.critical,
.coverage-state.danger {
  background: var(--danger);
  box-shadow: 0 0 0 3px rgb(239 68 68 / 14%);
}

.event-severity.info,
.coverage-state.healthy {
  background: var(--success);
  box-shadow: 0 0 0 3px rgb(16 185 129 / 14%);
}

.event-overview-content,
.coverage-item > span:nth-child(2) {
  min-width: 0;
}

.event-overview-content strong,
.event-overview-content small,
.coverage-item strong,
.coverage-item small {
  display: block;
}

.event-overview-content strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  line-height: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-overview-content small,
.coverage-item small {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 17px;
  overflow-wrap: anywhere;
}

.event-status {
  border-radius: 999px;
  padding: 3px 7px;
  background: #fff7ed;
  color: #c2410c;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.event-status.acknowledged {
  background: #eef2ff;
  color: #4f46e5;
}

.healthy-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--success);
  text-align: left;
}

.healthy-empty :deep(svg) {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
}

.healthy-empty strong,
.healthy-empty p {
  display: block;
}

.healthy-empty p {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 18px;
}

.coverage-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
}

.coverage-item strong {
  font-size: 13px;
  font-weight: 600;
  line-height: 19px;
}

.coverage-item :deep(svg) {
  color: var(--text-muted);
}

.backup-grid {
  grid-template-columns: minmax(0, 1fr);
}

.backup-panel {
  border-left: 3px solid var(--text-muted);
}

.backup-panel--healthy {
  border-left-color: var(--success);
}

.backup-panel--warning {
  border-left-color: var(--warning);
}

.backup-panel--error {
  border-left-color: var(--danger);
}

.backup-panel-title {
  align-items: flex-start;
}

.backup-title-actions {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--spacing-sm);
}

.backup-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
}

.backup-status.is-healthy {
  color: var(--success);
}

.backup-status.is-warning {
  color: #b45309;
}

.backup-status.is-error {
  color: var(--danger);
}

.backup-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--spacing-md);
}

.backup-stat {
  min-width: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.backup-stat span,
.backup-stat strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backup-stat span {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 18px;
}

.backup-stat strong {
  margin-top: 2px;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.backup-stat strong.has-warning {
  color: #b45309;
}

.history-grid {
  grid-template-columns: 1fr 1fr;
}

.panel {
  padding: var(--panel-padding);
}

.panel-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.panel-title h3 {
  margin: 0;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.panel-title p {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 18px;
}

.panel-title button,
.secondary,
.primary-button {
  min-height: 34px;
}

.trend-chart {
  height: clamp(150px, 20vh, 180px);
  display: flex;
  align-items: flex-end;
  gap: 10px;
  border-bottom: 1px solid var(--border);
  padding: 0 8px;
}

.trend-column {
  height: 100%;
  flex: 1;
  min-width: 18px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
}

.trend-bars {
  height: calc(100% - 28px);
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
}

.bar {
  width: 8px;
  min-height: 0;
  border-radius: 4px 4px 0 0;
}

.bar.ok {
  background: var(--success);
}

.bar.failed {
  background: var(--danger);
}

.bar.gateway {
  background: var(--warning);
}

.trend-column time {
  margin: 6px 0;
  color: var(--text-muted);
  font-size: 10px;
}

.switch-row,
.field-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 18px;
}

.field-row input {
  width: 90px;
  padding: 6px 7px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  font: inherit;
}

.monitor-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin: 10px 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 18px;
}

.monitor-meta button {
  border: 0;
  padding: 0;
  background: transparent;
  color: #4f46e5;
  cursor: pointer;
}

.panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--header-actions-gap);
}

.activity-list {
  display: flex;
  flex-direction: column;
}

.activity-item {
  display: grid;
  grid-template-columns: 12px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
}

.activity-item div {
  min-width: 0;
}

.activity-item strong,
.activity-item small {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.activity-item strong,
.latest-inspection strong {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
}

.activity-item small,
.activity-item time,
.latest-inspection p,
.latest-inspection time {
  color: var(--text-secondary);
  font-size: 12px;
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--text-muted);
}

.status-dot.success {
  background: var(--success);
}

.status-dot.failed {
  background: var(--danger);
}

.status-dot.rolled-back {
  background: var(--warning);
}

.latest-inspection {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 14px 0;
}

.inspection-score {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--success-light);
  color: #047857;
  font-size: 20px;
  line-height: 24px;
  font-weight: 650;
}

.empty-panel {
  padding: 28px 10px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 20px;
}

@media (max-width: 1000px) {
  .metric-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .dashboard-grid,
  .history-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .dashboard-error,
  .backup-panel-title,
  .backup-title-actions {
    align-items: flex-start;
  }

  .dashboard-error,
  .attention-panel-title {
    flex-direction: column;
  }

  .attention-actions {
    justify-content: flex-start;
  }

  .event-filter-row {
    grid-template-columns: 1fr;
  }

  .backup-title-actions {
    justify-content: flex-start;
  }

  .backup-stats {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .metric-grid {
    grid-template-columns: 1fr;
  }

  .event-overview-item {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .event-status {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
