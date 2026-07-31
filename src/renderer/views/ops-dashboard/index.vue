<template>
  <div class="page dashboard-page">
    <header class="page-header dashboard-header">
      <div class="page-heading">
        <div class="page-eyebrow"><t-icon name="dashboard" /> OPS DASHBOARD</div>
        <h2 class="page-title">运维仪表盘</h2>
        <p class="page-desc">统一查看发布、模型可靠性、自动化巡检与待处理事件</p>
      </div>
      <div class="page-actions">
        <button type="button" class="refresh-button" :disabled="loading" @click="loadDashboard">
          <t-icon name="refresh" :class="{ spinning: loading }" /> 刷新
        </button>
      </div>
    </header>

    <main class="page-content dashboard-content">
      <section class="metric-grid">
      <article class="metric-card primary interactive-surface">
        <span>模型可用率</span>
        <strong>{{ availabilityText }}</strong>
        <small>最近 20 次测试</small>
      </article>
      <article class="metric-card success interactive-surface">
        <span>发布成功</span>
        <strong>{{ dashboard.release?.success || 0 }}</strong>
        <small>发布历史共 {{ dashboard.release?.total || 0 }} 条记录</small>
      </article>
      <article class="metric-card danger interactive-surface">
        <span>发布失败</span>
        <strong>{{ dashboard.release?.failed || 0 }}</strong>
        <small>可在发布历史中重试或回滚</small>
      </article>
      <article class="metric-card neutral interactive-surface">
        <span>巡检状态</span>
        <strong>{{ dashboard.monitor?.enabled ? '运行中' : '未启用' }}</strong>
        <small>{{ monitorDescription }}</small>
      </article>
      </section>

      <section class="dashboard-grid">
      <article class="panel trend-panel">
        <div class="panel-title"><div><h3>模型可用趋势</h3><p>绿色正常、红色失败、橙色无法验证</p></div></div>
        <div v-if="trend.length" class="trend-chart">
          <div v-for="item in trend" :key="item.timestamp" class="trend-column" :title="trendTitle(item)">
            <div class="trend-bars">
              <span class="bar failed" :style="{ height: `${barHeight(item.failed, item.total)}%` }"></span>
              <span class="bar gateway" :style="{ height: `${barHeight(item.gateway, item.total)}%` }"></span>
              <span class="bar ok" :style="{ height: `${barHeight(item.ok, item.total)}%` }"></span>
            </div>
            <time>{{ shortDate(item.timestamp) }}</time>
          </div>
        </div>
        <div v-else class="empty-panel">完成一次模型测试后，这里会显示趋势。</div>
      </article>

      <article class="panel monitor-panel">
        <div class="panel-title"><div><h3>定时巡检</h3><p>应用运行期间由主进程后台执行</p></div></div>
        <label class="switch-row" :title="monitorTargetCount ? '' : '请先在模型可靠性页配置巡检目标'"><span>启用巡检</span><input v-model="monitorDraft.enabled" type="checkbox" :disabled="saving || !monitorTargetCount" /></label>
        <label class="field-row"><span>间隔（分钟）</span><input v-model.number="monitorDraft.intervalMinutes" type="number" min="5" max="1440" :disabled="saving" /></label>
        <label class="switch-row"><span>异常桌面通知</span><input v-model="monitorDraft.notifyOnFailure" type="checkbox" :disabled="saving" /></label>
        <div class="monitor-meta">巡检目标：{{ monitorTargetCount }} 个模型<button v-if="!monitorTargetCount" type="button" @click="$router.push('/model-test')">前往配置</button></div>
        <div class="panel-actions">
          <button type="button" class="secondary" :disabled="saving || !monitorTargetCount" :title="monitorTargetCount ? '' : '请先配置巡检目标'" @click="runInspection">立即巡检</button>
          <button type="button" class="primary-button" :disabled="saving" @click="saveMonitor">保存设置</button>
        </div>
      </article>
      </section>

      <section class="dashboard-grid history-grid">
      <article class="panel">
        <div class="panel-title"><div><h3>最近发布</h3><p>成功、失败与回滚记录</p></div><button type="button" @click="$router.push('/system-release')">进入发布</button></div>
        <div v-if="dashboard.release?.latest?.length" class="activity-list">
          <div v-for="item in dashboard.release.latest" :key="item.id" class="activity-item">
            <span class="status-dot" :class="item.status"></span>
            <div><strong>{{ item.label }}</strong><small>{{ item.message || item.remoteDir }}</small></div>
            <time>{{ formatDate(item.finishedAt) }}</time>
          </div>
        </div>
        <div v-else class="empty-panel">暂无发布记录</div>
      </article>

      <article class="panel">
        <div class="panel-title"><div><h3>最近模型巡检</h3><p>手动测试与定时巡检均会保存</p></div><button type="button" @click="$router.push('/model-test')">进入测试</button></div>
        <div v-if="dashboard.model?.latest" class="latest-inspection">
          <div class="inspection-score">{{ dashboard.model.latest.summary?.ok || 0 }}/{{ dashboard.model.latest.summary?.total || 0 }}</div>
          <div><strong>{{ dashboard.model.latest.label }}</strong><p>失败 {{ dashboard.model.latest.summary?.failed || 0 }} · 无法验证 {{ dashboard.model.latest.summary?.gateway || 0 }}</p><time>{{ formatDate(dashboard.model.latest.finishedAt) }}</time></div>
        </div>
        <div v-else class="empty-panel">暂无模型测试历史</div>
      </article>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'

const loading = ref(false)
const saving = ref(false)
const dashboard = reactive({ release: {}, model: {}, monitor: {} })
const monitorDraft = reactive({ enabled: false, intervalMinutes: 60, notifyOnFailure: true })
const trend = computed(() => dashboard.model?.trend || [])
const monitorTargetCount = computed(() => Number(
  dashboard.monitor?.targetCount ?? dashboard.monitor?.targets?.length ?? 0,
))
const availabilityText = computed(() => dashboard.model?.availability == null ? '—' : `${dashboard.model.availability}%`)
const monitorDescription = computed(() => dashboard.monitor?.enabled
  ? `每 ${dashboard.monitor.intervalMinutes} 分钟`
  : monitorTargetCount.value ? '已暂停' : '尚未配置巡检目标')

function formatDate(value) { return value ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value) : '—' }
function shortDate(value) { return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value) : '' }
function barHeight(value, total) { return total ? Math.max(value ? 8 : 0, Math.round((value / total) * 100)) : 0 }
function trendTitle(item) { return `${formatDate(item.timestamp)}：正常 ${item.ok}，失败 ${item.failed}，无法验证 ${item.gateway || 0}` }

async function loadDashboard() {
  loading.value = true
  try {
    const result = await window.opsApi.getOpsDashboard()
    if (!result.ok) throw new Error(result.error || '读取仪表盘失败')
    Object.assign(dashboard, result.data)
    Object.assign(monitorDraft, {
      enabled: Boolean(result.data.monitor?.enabled),
      intervalMinutes: result.data.monitor?.intervalMinutes || 60,
      notifyOnFailure: result.data.monitor?.notifyOnFailure !== false,
    })
  } catch (error) { MessagePlugin.error({ content: error.message, placement: 'bottom-right' }) }
  finally { loading.value = false }
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
    const result = await window.opsApi.saveModelMonitorSettings({
      enabled: Boolean(monitorDraft.enabled),
      intervalMinutes: Number(monitorDraft.intervalMinutes),
      notifyOnFailure: Boolean(monitorDraft.notifyOnFailure),
    })
    if (!result.ok) throw new Error(result.error || '保存巡检设置失败')
    dashboard.monitor = result.settings
    Object.assign(monitorDraft, {
      enabled: Boolean(result.settings.enabled),
      intervalMinutes: result.settings.intervalMinutes,
      notifyOnFailure: result.settings.notifyOnFailure !== false,
    })
    MessagePlugin.success({ content: '巡检设置已保存', placement: 'bottom-right' })
  } catch (error) { MessagePlugin.error({ content: error.message, placement: 'bottom-right' }) }
  finally { saving.value = false }
}

async function runInspection() {
  saving.value = true
  try {
    const result = await window.opsApi.runModelInspection()
    if (!result.ok) throw new Error(result.error || '巡检失败')
    MessagePlugin.success({ content: `巡检完成：${result.entry.summary.ok}/${result.entry.summary.total} 正常`, placement: 'bottom-right' })
    await loadDashboard()
  } catch (error) { MessagePlugin.error({ content: error.message, placement: 'bottom-right' }) }
  finally { saving.value = false }
}

onMounted(loadDashboard)
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
  padding: 0 18px;
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
</style>
