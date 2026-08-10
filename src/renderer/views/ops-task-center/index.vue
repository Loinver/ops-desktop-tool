<template>
  <div class="page task-center-page">
    <header class="page-header">
      <div class="page-heading">
        <div class="page-eyebrow"><t-icon name="root-list" /> OPS TASK CENTER</div>
        <h2 class="page-title">统一任务中心</h2>
        <p class="page-desc">
          复用现有调度器，集中管理巡检、复检、审计、诊断与本机趋势，不创建第二套任务状态。
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="button secondary" @click="router.push('/ops-dashboard')">
          返回仪表盘
        </button>
        <button type="button" class="button primary" :disabled="loading" @click="loadAll">
          <t-icon name="refresh" :class="{ spinning: loading }" /> 刷新全部
        </button>
      </div>
    </header>

    <main class="page-content">
      <section v-if="loadErrors.length" class="notice notice--error" role="alert">
        <div>
          <strong>部分数据读取失败</strong>
          <p>{{ loadErrors.join('；') }}</p>
        </div>
        <button type="button" class="button secondary" @click="loadAll">重新加载</button>
      </section>

      <section class="summary-grid" aria-label="任务中心摘要">
        <article class="summary-card">
          <span>任务与监控</span>
          <strong>{{ taskRows.length }}</strong>
          <small>{{ enabledTaskCount }} 个已启用</small>
        </article>
        <article class="summary-card" :class="activeEvents.length ? 'summary-card--warning' : ''">
          <span>活跃事件</span>
          <strong>{{ activeEvents.length }}</strong>
          <small>{{ criticalEventCount }} 个严重事件</small>
        </article>
        <article class="summary-card">
          <span>Runbook 历史</span>
          <strong>{{ runbookHistory.length }}</strong>
          <small>{{ successfulRunbookCount }} 次已通过复检</small>
        </article>
        <article class="summary-card">
          <span>高风险审计</span>
          <strong>{{ auditRecords.length }}</strong>
          <small>{{ failedAuditCount }} 次失败</small>
        </article>
      </section>

      <section class="surface-panel page-section">
        <div class="section-heading">
          <div>
            <h3 class="section-title">统一任务列表</h3>
            <p class="section-desc">
              模型巡检、自动化检查、Node 服务关注和自动备份继续由各自主进程调度器执行。
            </p>
          </div>
          <span class="section-badge">单一数据源</span>
        </div>

        <div v-if="!hasLoaded && loading" class="empty-state" aria-busy="true">
          正在读取任务状态…
        </div>
        <div v-else class="table-scroll">
          <table class="data-table task-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>类型 / 周期</th>
                <th>最近状态</th>
                <th>下次运行</th>
                <th>启用</th>
                <th class="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in taskRows" :key="task.id">
                <td>
                  <strong>{{ task.name }}</strong>
                  <small>{{ task.description }}</small>
                </td>
                <td>
                  <span>{{ task.typeLabel }}</span>
                  <small>{{ task.schedule }}</small>
                </td>
                <td>
                  <span :class="['status-pill', `status-pill--${task.tone}`]">{{
                    task.status
                  }}</span>
                  <small>{{ task.lastRunAt ? formatDateTime(task.lastRunAt) : '尚未运行' }}</small>
                </td>
                <td>{{ task.nextRunAt ? formatDateTime(task.nextRunAt) : '—' }}</td>
                <td>
                  <label v-if="task.toggleable" class="task-switch">
                    <input
                      type="checkbox"
                      :checked="task.enabled"
                      :disabled="actionKey === `toggle:${task.id}`"
                      :aria-label="`${task.enabled ? '停用' : '启用'}${task.name}`"
                      @change="toggleTask(task)"
                    />
                    <span>{{ task.enabled ? '已启用' : '已停用' }}</span>
                  </label>
                  <span v-else class="muted-text">持续关注</span>
                </td>
                <td>
                  <div class="row-actions">
                    <button
                      type="button"
                      class="button compact secondary"
                      :disabled="Boolean(actionKey)"
                      @click="runTask(task)"
                    >
                      {{ actionKey === `run:${task.id}` ? '执行中…' : task.runLabel }}
                    </button>
                    <button
                      type="button"
                      class="button compact ghost"
                      @click="router.push(task.configRoute)"
                    >
                      管理
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="!taskRows.length">
                <td colspan="6"><div class="empty-state">暂无可显示任务</div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="two-column-grid runbook-grid">
        <article class="surface-panel page-section">
          <div class="section-heading">
            <div>
              <h3 class="section-title">事件 Runbook</h3>
              <p class="section-desc">
                服务端生成固定步骤；高风险执行必须二次确认，成功复检后自动关闭事件。
              </p>
            </div>
            <span class="section-badge section-badge--safe">需确认</span>
          </div>

          <label class="field-block">
            <span>待处理事件</span>
            <select v-model="selectedEventId" :disabled="runbookBusy">
              <option value="">请选择事件</option>
              <option v-for="item in activeEvents" :key="item.id" :value="item.id">
                [{{ severityLabel(item.severity) }}] {{ item.title }}
              </option>
            </select>
          </label>

          <div class="inline-actions">
            <button
              type="button"
              class="button primary"
              :disabled="!selectedEventId || runbookBusy"
              @click="planRunbook"
            >
              {{ runbookBusy ? '处理中…' : '生成安全计划' }}
            </button>
            <button
              type="button"
              class="button secondary"
              :disabled="!selectedEventId"
              @click="openSelectedEvent"
            >
              查看事件
            </button>
          </div>

          <div v-if="runbookPlan" class="runbook-plan">
            <div class="runbook-plan__meta">
              <div>
                <strong>{{ runbookPlan.executable ? '可执行复检计划' : '人工引导计划' }}</strong>
                <small>计划 {{ runbookPlan.planId }}</small>
              </div>
              <span :class="['status-pill', runbookPlan.executable ? 'status-pill--warning' : '']">
                {{ runbookPlan.steps?.length || 0 }} 步
              </span>
            </div>
            <ol class="step-list">
              <li v-for="step in runbookPlan.steps || []" :key="step.id">
                <span>{{ step.phase === 'verification' ? '复检' : '诊断' }}</span>
                <div>
                  <strong>{{ stepTypeLabel(step.type) }}</strong>
                  <small>由主进程白名单处理器执行，页面不可修改参数</small>
                </div>
              </li>
            </ol>
            <button
              type="button"
              class="button danger"
              :disabled="runbookBusy"
              @click="executeRunbook"
            >
              {{ runbookBusy ? '执行中…' : runbookPlan.executable ? '确认并执行' : '记录人工引导' }}
            </button>
          </div>

          <div v-if="runbookResult" class="result-card">
            <strong>最近执行：{{ runbookStatusLabel(runbookResult.status) }}</strong>
            <p>
              {{ runbookResult.reason || runbookResult.summary?.message || runbookResultMessage }}
            </p>
            <div class="result-steps">
              <span
                v-for="step in runbookResultSteps"
                :key="`${step.phase}:${step.stepId}`"
                :class="['status-pill', `status-pill--${statusTone(step.status)}`]"
              >
                {{ step.phase === 'verification' ? '复检' : '诊断' }}：{{
                  statusLabel(step.status)
                }}
              </span>
            </div>
          </div>

          <div v-if="!activeEvents.length" class="empty-state">当前没有需要处理的事件。</div>
        </article>

        <article class="surface-panel page-section">
          <div class="section-heading">
            <div>
              <h3 class="section-title">Runbook 运行记录</h3>
              <p class="section-desc">保留最近的诊断、确认和复检结果，便于检查闭环是否真实完成。</p>
            </div>
          </div>
          <div v-if="runbookHistory.length" class="activity-list">
            <article v-for="item in runbookHistory.slice(0, 8)" :key="item.id" class="activity-row">
              <span :class="['status-dot', `status-dot--${statusTone(item.status)}`]"></span>
              <div>
                <strong
                  >{{ sourceLabel(item.sourceType) }} ·
                  {{ runbookStatusLabel(item.status) }}</strong
                >
                <small>
                  {{ item.summary?.succeeded || 0 }} 成功 · {{ item.summary?.failed || 0 }} 失败 ·
                  {{ item.summary?.guided || 0 }} 人工
                </small>
              </div>
              <time>{{ formatDateTime(item.finishedAt || item.startedAt) }}</time>
            </article>
          </div>
          <div v-else class="empty-state">暂无 Runbook 运行记录。</div>
        </article>
      </section>

      <section class="surface-panel page-section">
        <div class="section-heading audit-heading">
          <div>
            <h3 class="section-title">高风险操作审计</h3>
            <p class="section-desc">
              仅记录动作、白名单元数据、耗时与受控错误摘要；不记录凭证、路径、请求正文或底层原始错误。
            </p>
          </div>
          <div class="filter-row">
            <select v-model="auditStatusFilter" aria-label="审计状态筛选">
              <option value="">全部状态</option>
              <option value="succeeded">成功</option>
              <option value="failed">失败</option>
              <option value="started">执行中</option>
            </select>
            <select v-model="auditCategoryFilter" aria-label="审计分类筛选">
              <option value="">全部分类</option>
              <option v-for="category in auditCategories" :key="category" :value="category">
                {{ category }}
              </option>
            </select>
          </div>
        </div>

        <div class="table-scroll">
          <table class="data-table audit-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>分类</th>
                <th>目标</th>
                <th>状态 / 耗时</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in visibleAuditRecords" :key="item.auditId">
                <td>{{ formatDateTime(item.finishedAt || item.startedAt) }}</td>
                <td>
                  <strong>{{ auditActionLabel(item.action) }}</strong>
                  <small>{{ item.channel }}</small>
                </td>
                <td>{{ item.category }}</td>
                <td>
                  <code>{{ auditTarget(item.target) }}</code>
                </td>
                <td>
                  <span :class="['status-pill', `status-pill--${statusTone(item.status)}`]">
                    {{ statusLabel(item.status) }}
                  </span>
                  <small>{{ formatDuration(item.durationMs) }}</small>
                  <small v-if="item.error?.message" class="error-text">{{
                    item.error.message
                  }}</small>
                </td>
              </tr>
              <tr v-if="!filteredAuditRecords.length">
                <td colspan="5"><div class="empty-state">当前筛选条件下没有审计记录。</div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-if="filteredAuditRecords.length > AUDIT_PAGE_SIZE"
          class="audit-pagination"
          aria-live="polite"
        >
          <span class="muted-text">
            已显示 {{ visibleAuditRecords.length }} / {{ filteredAuditRecords.length }} 条
          </span>
          <div class="inline-actions audit-pagination__actions">
            <button
              v-if="remainingAuditCount"
              type="button"
              class="button compact secondary"
              @click="showMoreAuditRecords"
            >
              加载更多（{{ Math.min(AUDIT_PAGE_SIZE, remainingAuditCount) }}）
            </button>
            <button
              v-if="auditVisibleCount > AUDIT_PAGE_SIZE"
              type="button"
              class="button compact secondary"
              @click="collapseAuditRecords"
            >
              收起
            </button>
          </div>
        </div>
      </section>

      <section class="surface-panel page-section">
        <div class="section-heading">
          <div>
            <h3 class="section-title">本机运维洞察</h3>
            <p class="section-desc">
              全部基于本机历史样本；成本和风险均为估算，不替代账单、预检和人工审批。
            </p>
          </div>
          <time class="muted-text">更新于 {{ formatDateTime(insights.generatedAt) }}</time>
        </div>

        <div class="insight-grid">
          <article class="insight-card">
            <span>发布历史风险</span>
            <strong>{{ insights.releaseRisk?.score ?? 0 }} / 100</strong>
            <small
              >{{ riskLabel(insights.releaseRisk?.level) }} · 样本
              {{ insights.releaseRisk?.sampleSize || 0 }}</small
            >
            <ul>
              <li v-for="factor in insights.releaseRisk?.factors || []" :key="factor">
                {{ factor }}
              </li>
            </ul>
          </article>
          <article class="insight-card">
            <span>模型可靠性样本</span>
            <strong>{{ insights.modelReliability?.length || 0 }}</strong>
            <small>{{ bestModelReliability }}</small>
          </article>
          <article class="insight-card">
            <span>AI 评测估算成本</span>
            <strong>{{ formatUsd(totalEstimatedCost) }}</strong>
            <small>{{ pricedEvaluationCount }} 个模型已配置价格</small>
          </article>
          <article class="insight-card">
            <span>Node 历史样本</span>
            <strong>{{ insights.nodeServices?.length || 0 }}</strong>
            <small>{{ bestNodeAvailability }}</small>
          </article>
        </div>

        <div class="insight-tables">
          <div>
            <h4>模型可靠性</h4>
            <div class="table-scroll compact-table-scroll">
              <table class="data-table compact-table">
                <thead>
                  <tr>
                    <th>模型</th>
                    <th>成功率</th>
                    <th>平均耗时</th>
                    <th>样本</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in (insights.modelReliability || []).slice(0, 8)" :key="item.id">
                    <td>
                      <strong>{{ item.model }}</strong
                      ><small>{{ item.providerName }}</small>
                    </td>
                    <td>{{ item.successRate }}%</td>
                    <td>{{ formatDuration(item.averageDurationMs) }}</td>
                    <td>{{ item.total }}</td>
                  </tr>
                  <tr v-if="!insights.modelReliability?.length">
                    <td colspan="4"><div class="empty-state">暂无模型测试样本</div></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4>Node 可用率与资源</h4>
            <div class="table-scroll compact-table-scroll">
              <table class="data-table compact-table">
                <thead>
                  <tr>
                    <th>服务</th>
                    <th>可用率</th>
                    <th>平均 CPU</th>
                    <th>平均内存</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in (insights.nodeServices || []).slice(0, 8)"
                    :key="item.serviceId"
                  >
                    <td>
                      <strong>{{ item.protocol }} {{ item.port }}</strong
                      ><small>{{ item.samples }} 个样本</small>
                    </td>
                    <td>{{ item.availability }}%</td>
                    <td>{{ item.averageCpuPercent }}%</td>
                    <td>{{ formatBytes(item.averageMemoryBytes) }}</td>
                  </tr>
                  <tr v-if="!insights.nodeServices?.length">
                    <td colspan="4"><div class="empty-state">暂无 Node 历史样本</div></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="pricing-panel">
          <div>
            <h4>评测价格配置</h4>
            <p>按 Provider + 模型配置每百万 Token 美元价格，Token 数按字符数 / 4 粗略估算。</p>
          </div>
          <div class="pricing-form">
            <label>
              <span>评测模型</span>
              <select v-model="pricingSelection" @change="applyPricingSelection">
                <option value="">请选择模型</option>
                <option v-for="item in insights.evaluations || []" :key="item.id" :value="item.id">
                  {{ item.providerName }} / {{ item.model }}
                </option>
              </select>
            </label>
            <label
              ><span>输入价 / 百万 Token</span
              ><input
                v-model.number="pricingDraft.inputUsdPerMillion"
                type="number"
                min="0"
                step="0.01"
            /></label>
            <label
              ><span>输出价 / 百万 Token</span
              ><input
                v-model.number="pricingDraft.outputUsdPerMillion"
                type="number"
                min="0"
                step="0.01"
            /></label>
            <button
              type="button"
              class="button primary"
              :disabled="!pricingSelection || actionKey === 'pricing'"
              @click="savePricing"
            >
              {{ actionKey === 'pricing' ? '保存中…' : '保存价格' }}
            </button>
          </div>
        </div>

        <p class="caveat-text">
          {{ insights.releaseRisk?.disclaimer || insights.notes?.releaseRisk }}
        </p>
        <p class="caveat-text">{{ insights.notes?.nodeAvailability }}</p>
      </section>

      <section class="two-column-grid diagnostics-grid">
        <article class="surface-panel page-section">
          <div class="section-heading">
            <div>
              <h3 class="section-title">脱敏诊断包</h3>
              <p class="section-desc">仅导出白名单字段，便于离线排障和提交给开发人员检查。</p>
            </div>
          </div>
          <div v-if="diagnosticsPreview.generatedAt" class="diagnostics-summary">
            <div v-for="(count, key) in diagnosticsPreview.counts" :key="key">
              <span>{{ diagnosticsCountLabel(key) }}</span
              ><strong>{{ count }}</strong>
            </div>
          </div>
          <p class="caveat-text">{{ diagnosticsPreview.redaction || '诊断包尚未生成预览。' }}</p>
          <div class="inline-actions">
            <button
              type="button"
              class="button secondary"
              :disabled="actionKey === 'diagnostics-preview'"
              @click="loadDiagnosticsPreview"
            >
              重新预览
            </button>
            <button
              type="button"
              class="button primary"
              :disabled="actionKey === 'diagnostics-export'"
              @click="exportDiagnostics"
            >
              {{ actionKey === 'diagnostics-export' ? '导出中…' : '导出 JSON' }}
            </button>
          </div>
          <p v-if="lastExport" class="success-text">
            已导出 {{ lastExport.fileName }}（{{ formatBytes(lastExport.sizeBytes) }}）
          </p>
        </article>

        <article class="surface-panel page-section">
          <div class="section-heading">
            <div>
              <h3 class="section-title">闭环说明</h3>
              <p class="section-desc">任务中心只编排已有能力，并保留跳转到原功能页的入口。</p>
            </div>
          </div>
          <ol class="closure-list">
            <li>
              <span>1</span>
              <div><strong>发现</strong><small>调度器或人工操作产生统一事件。</small></div>
            </li>
            <li>
              <span>2</span>
              <div><strong>诊断</strong><small>Runbook 按事件类型读取白名单上下文。</small></div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>执行与复检</strong><small>确认后调用现有任务执行器，不运行任意命令。</small>
              </div>
            </li>
            <li>
              <span>4</span>
              <div>
                <strong>关闭与留痕</strong
                ><small>复检成功自动关闭事件，并写入 Runbook 与安全审计。</small>
              </div>
            </li>
          </ol>
        </article>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useRouter } from 'vue-router'
import { opsApi } from '../../api/opsApi.js'

const router = useRouter()
const AUDIT_PAGE_SIZE = 20
const loading = ref(false)
const hasLoaded = ref(false)
const actionKey = ref('')
const loadErrors = ref([])
const modelSettings = ref({
  enabled: false,
  intervalMinutes: 60,
  targets: [],
  lastRunAt: 0,
  nextRunAt: 0
})
const automationTasks = ref([])
const nodeWatches = ref([])
const backupSettings = ref({ enabled: false, interval: '', lastRunAt: 0, nextRunAt: 0 })
const backupHealth = ref({ status: 'disabled', summary: '自动备份计划未启用' })
const events = ref([])
const auditRecords = ref([])
const runbookHistory = ref([])
const insights = ref({
  modelReliability: [],
  evaluations: [],
  nodeServices: [],
  releaseRisk: {},
  notes: {},
  settings: { pricing: [] }
})
const diagnosticsPreview = ref({ counts: {} })
const selectedEventId = ref('')
const runbookPlan = ref(null)
const runbookResult = ref(null)
const runbookBusy = ref(false)
const auditStatusFilter = ref('')
const auditCategoryFilter = ref('')
const auditVisibleCount = ref(AUDIT_PAGE_SIZE)
const pricingSelection = ref('')
const pricingDraft = reactive({ inputUsdPerMillion: 0, outputUsdPerMillion: 0 })
const lastExport = ref(null)
let unsubscribeOpsData = null
let refreshTimer = null
let refreshQueued = null

const activeEvents = computed(() => events.value.filter((item) => item.status !== 'resolved'))
const criticalEventCount = computed(
  () => activeEvents.value.filter((item) => item.severity === 'critical').length
)
const enabledTaskCount = computed(() => taskRows.value.filter((item) => item.enabled).length)
const successfulRunbookCount = computed(
  () => runbookHistory.value.filter((item) => item.status === 'succeeded').length
)
const failedAuditCount = computed(
  () => auditRecords.value.filter((item) => item.status === 'failed').length
)
const auditCategories = computed(() =>
  [...new Set(auditRecords.value.map((item) => item.category).filter(Boolean))].sort()
)
const filteredAuditRecords = computed(() =>
  auditRecords.value.filter(
    (item) =>
      (!auditStatusFilter.value || item.status === auditStatusFilter.value) &&
      (!auditCategoryFilter.value || item.category === auditCategoryFilter.value)
  )
)
const visibleAuditRecords = computed(() =>
  filteredAuditRecords.value.slice(0, auditVisibleCount.value)
)
const remainingAuditCount = computed(() =>
  Math.max(0, filteredAuditRecords.value.length - visibleAuditRecords.value.length)
)

watch([auditStatusFilter, auditCategoryFilter], () => {
  auditVisibleCount.value = AUDIT_PAGE_SIZE
})
const runbookResultSteps = computed(() => [
  ...(runbookResult.value?.actionResults || []),
  ...(runbookResult.value?.verificationResults || [])
])
const runbookResultMessage = computed(() => {
  const messages = runbookResultSteps.value.map((item) => item.message).filter(Boolean)
  return messages.join('；') || '执行结果已记录。'
})
const totalEstimatedCost = computed(() =>
  (insights.value.evaluations || []).reduce(
    (total, item) => total + (Number(item.estimatedCostUsd) || 0),
    0
  )
)
const pricedEvaluationCount = computed(
  () => (insights.value.evaluations || []).filter((item) => item.pricing).length
)
const bestModelReliability = computed(() => {
  const rows = insights.value.modelReliability || []
  if (!rows.length) return '暂无历史样本'
  const best = [...rows].sort((a, b) => b.successRate - a.successRate)[0]
  return `最高 ${best.model} · ${best.successRate}%`
})
const bestNodeAvailability = computed(() => {
  const rows = insights.value.nodeServices || []
  if (!rows.length) return '暂无采集样本'
  const best = [...rows].sort((a, b) => b.availability - a.availability)[0]
  return `最高 ${best.protocol} ${best.port} · ${best.availability}%`
})

const taskRows = computed(() => {
  const modelTargets = modelSettings.value.targets?.length || 0
  const modelTone = !modelTargets ? 'neutral' : modelSettings.value.enabled ? 'success' : 'warning'
  const rows = [
    {
      id: 'model-monitor',
      kind: 'model',
      name: '模型可靠性巡检',
      description: `${modelTargets} 个目标`,
      typeLabel: '模型巡检',
      schedule: `每 ${modelSettings.value.intervalMinutes || 60} 分钟`,
      status: !modelTargets ? '未配置' : modelSettings.value.enabled ? '运行中' : '已暂停',
      tone: modelTone,
      enabled: Boolean(modelSettings.value.enabled),
      toggleable: true,
      lastRunAt: modelSettings.value.lastRunAt,
      nextRunAt: modelSettings.value.nextRunAt,
      runLabel: '立即巡检',
      configRoute: '/model-test'
    },
    ...automationTasks.value.map((item) => ({
      id: `automation:${item.id}`,
      sourceId: item.id,
      raw: item,
      kind: 'automation',
      name: item.title || '未命名巡检',
      description: item.type === 'tcp-port' ? `${item.target}:${item.port}` : item.target,
      typeLabel: item.type === 'tcp-port' ? 'TCP 端口' : 'HTTP 健康检查',
      schedule: `每 ${item.intervalMinutes || 5} 分钟`,
      status: !item.lastResult ? '等待首次运行' : item.lastResult.ok ? '正常' : '最近失败',
      tone: !item.lastResult ? 'warning' : item.lastResult.ok ? 'success' : 'danger',
      enabled: Boolean(item.enabled),
      toggleable: true,
      lastRunAt: item.lastRunAt,
      nextRunAt: item.nextRunAt,
      runLabel: '立即检查',
      configRoute: '/ops-control-center'
    })),
    {
      id: 'node-monitor',
      kind: 'node',
      name: 'Node 服务关注',
      description: `${nodeWatches.value.length} 个服务`,
      typeLabel: '本机端口复检',
      schedule: '主进程每 60 秒',
      status: nodeStatusText(),
      tone: nodeStatusTone(),
      enabled: nodeWatches.value.length > 0,
      toggleable: false,
      lastRunAt: Math.max(
        0,
        ...nodeWatches.value.map((item) =>
          Math.max(Number(item.lastSeenAt) || 0, Number(item.updatedAt) || 0)
        )
      ),
      nextRunAt: 0,
      runLabel: '立即检查',
      configRoute: '/node-services'
    },
    {
      id: 'auto-backup',
      kind: 'backup',
      name: '加密自动备份',
      description: backupHealth.value.summary || '自动备份计划',
      typeLabel: '本地数据备份',
      schedule: backupIntervalLabel(backupSettings.value.interval),
      status: backupStatusLabel(backupHealth.value.status),
      tone: backupStatusTone(backupHealth.value.status),
      enabled: Boolean(backupSettings.value.enabled),
      toggleable: true,
      lastRunAt: backupSettings.value.lastRunAt,
      nextRunAt: backupSettings.value.nextRunAt,
      runLabel: '立即备份',
      configRoute: '/data-management'
    }
  ]
  return rows
})

function assertOk(result, fallback) {
  if (result?.ok === false || result?.success === false) throw new Error(result.error || fallback)
  return result
}

function cloneForIpc(value) {
  return JSON.parse(JSON.stringify(value))
}

async function loadAll() {
  if (loading.value) return
  loading.value = true
  const loaders = [
    ['模型巡检', loadModelSettings],
    ['自动化任务', loadAutomationTasks],
    ['Node 服务', loadNodeWatches],
    ['自动备份', loadBackup],
    ['运维事件', loadEvents],
    ['安全审计', loadAudit],
    ['Runbook 历史', loadRunbookHistory],
    ['运维洞察', loadInsights],
    ['诊断预览', loadDiagnosticsPreview]
  ]
  const settled = await Promise.allSettled(loaders.map(([, loader]) => loader({ silent: true })))
  loadErrors.value = settled
    .map((result, index) =>
      result.status === 'rejected'
        ? `${loaders[index][0]}：${result.reason?.message || '读取失败'}`
        : ''
    )
    .filter(Boolean)
  hasLoaded.value = true
  loading.value = false
  if (loadErrors.value.length) {
    MessagePlugin.warning({
      content: `有 ${loadErrors.value.length} 项数据读取失败`,
      placement: 'bottom-right'
    })
  }
}

async function loadModelSettings() {
  const result = assertOk(await opsApi.getModelMonitorSettings(), '读取模型巡检失败')
  modelSettings.value = result.settings || modelSettings.value
}

async function loadAutomationTasks() {
  const result = assertOk(await opsApi.getAutomationTasks(), '读取自动化任务失败')
  automationTasks.value = result.tasks || []
}

async function loadNodeWatches() {
  const result = assertOk(await opsApi.getNodeServiceWatches(), '读取 Node 服务失败')
  nodeWatches.value = result.items || []
}

async function loadBackup() {
  const [settings, health] = await Promise.all([
    opsApi.getAutoBackupSettings(),
    opsApi.getAutoBackupHealth()
  ])
  assertOk(settings, '读取自动备份设置失败')
  assertOk(health, '读取自动备份健康状态失败')
  backupSettings.value = settings?.settings || settings || backupSettings.value
  backupHealth.value = health?.health || health || backupHealth.value
}

async function loadEvents() {
  const result = assertOk(await opsApi.getOpsEvents({ limit: 200 }), '读取运维事件失败')
  events.value = result.items || result.events || []
  if (!activeEvents.value.some((item) => item.id === selectedEventId.value)) {
    selectedEventId.value = activeEvents.value[0]?.id || ''
    runbookPlan.value = null
  }
}

function showMoreAuditRecords() {
  auditVisibleCount.value = Math.min(
    filteredAuditRecords.value.length,
    auditVisibleCount.value + AUDIT_PAGE_SIZE
  )
}

function collapseAuditRecords() {
  auditVisibleCount.value = AUDIT_PAGE_SIZE
}

async function loadAudit() {
  const result = assertOk(await opsApi.getOpsAuditRecords({ limit: 200 }), '读取安全审计失败')
  auditRecords.value = result.records || []
}

async function loadRunbookHistory() {
  const result = assertOk(await opsApi.getOpsRunbookHistory(), '读取 Runbook 历史失败')
  runbookHistory.value = result.runs || []
}

async function loadInsights() {
  const result = assertOk(await opsApi.getOpsInsights(), '读取运维洞察失败')
  insights.value = result.data || insights.value
  if (pricingSelection.value) applyPricingSelection()
}

async function loadDiagnosticsPreview({ silent = false } = {}) {
  if (!silent) actionKey.value = 'diagnostics-preview'
  try {
    const result = assertOk(await opsApi.previewOpsDiagnostics(), '生成诊断预览失败')
    diagnosticsPreview.value = result.preview || { counts: {} }
  } finally {
    if (!silent) actionKey.value = ''
  }
}

async function toggleTask(task) {
  const key = `toggle:${task.id}`
  if (actionKey.value) return
  actionKey.value = key
  try {
    if (task.kind === 'model') {
      const result = assertOk(
        await opsApi.saveModelMonitorSettings({ enabled: !task.enabled }),
        '保存模型巡检设置失败'
      )
      modelSettings.value = result.settings
    } else if (task.kind === 'automation') {
      const payload = { ...cloneForIpc(task.raw), enabled: !task.enabled }
      const result = assertOk(await opsApi.saveAutomationTask(payload), '保存自动化任务失败')
      const index = automationTasks.value.findIndex((item) => item.id === result.task?.id)
      if (index >= 0) automationTasks.value.splice(index, 1, result.task)
    } else if (task.kind === 'backup') {
      const result = assertOk(
        await opsApi.saveAutoBackupSettings({ enabled: !task.enabled }),
        '保存自动备份设置失败'
      )
      backupSettings.value = result.settings || result
      await loadBackup()
    }
    MessagePlugin.success({ content: `${task.name}设置已更新`, placement: 'bottom-right' })
    await refreshAfterAction()
  } catch (error) {
    MessagePlugin.error({ content: error.message || '更新任务失败', placement: 'bottom-right' })
  } finally {
    actionKey.value = ''
  }
}

async function runTask(task) {
  if (actionKey.value) return
  actionKey.value = `run:${task.id}`
  try {
    if (task.kind === 'model') assertOk(await opsApi.runModelInspection(), '模型巡检失败')
    else if (task.kind === 'automation')
      assertOk(await opsApi.runAutomationTask(task.sourceId), '自动化检查失败')
    else if (task.kind === 'node')
      assertOk(await opsApi.checkNodeServiceWatches(), 'Node 服务检查失败')
    else if (task.kind === 'backup') assertOk(await opsApi.runAutoBackupNow(), '自动备份失败')
    MessagePlugin.success({ content: `${task.name}执行完成`, placement: 'bottom-right' })
    await refreshAfterAction()
  } catch (error) {
    MessagePlugin.error({ content: error.message || '执行任务失败', placement: 'bottom-right' })
  } finally {
    actionKey.value = ''
  }
}

async function refreshAfterAction() {
  await Promise.allSettled([
    loadModelSettings(),
    loadAutomationTasks(),
    loadNodeWatches(),
    loadBackup(),
    loadEvents(),
    loadAudit(),
    loadRunbookHistory(),
    loadInsights(),
    loadDiagnosticsPreview({ silent: true })
  ])
}

async function planRunbook() {
  if (!selectedEventId.value || runbookBusy.value) return
  runbookBusy.value = true
  runbookResult.value = null
  try {
    const result = assertOk(await opsApi.planOpsRunbook(selectedEventId.value), '生成 Runbook 失败')
    runbookPlan.value = result.plan
  } catch (error) {
    MessagePlugin.error({
      content: error.message || '生成 Runbook 失败',
      placement: 'bottom-right'
    })
  } finally {
    runbookBusy.value = false
  }
}

async function executeRunbook() {
  if (!runbookPlan.value || runbookBusy.value) return
  let confirmed = false
  if (runbookPlan.value.requiresConfirmation) {
    confirmed = await opsApi.confirm({
      title: '确认执行安全 Runbook',
      message: `将执行 ${runbookPlan.value.steps?.length || 0} 个服务端白名单步骤，并在操作后主动复检。`,
      detail: '仅会调用应用已有的巡检、诊断和健康检查处理器，不会执行任意 Shell 命令。'
    })
    if (!confirmed) return
  }
  runbookBusy.value = true
  try {
    const result = assertOk(
      await opsApi.executeOpsRunbook({
        eventId: selectedEventId.value,
        plan: cloneForIpc(runbookPlan.value),
        confirmed
      }),
      '执行 Runbook 失败'
    )
    runbookResult.value = result.result
    MessagePlugin[result.result?.status === 'succeeded' ? 'success' : 'warning']({
      content:
        result.result?.status === 'succeeded'
          ? 'Runbook 复检通过，事件已自动关闭'
          : 'Runbook 已执行，请检查结果',
      placement: 'bottom-right'
    })
    await refreshAfterAction()
  } catch (error) {
    MessagePlugin.error({
      content: error.message || '执行 Runbook 失败',
      placement: 'bottom-right'
    })
  } finally {
    runbookBusy.value = false
  }
}

function openSelectedEvent() {
  if (!selectedEventId.value) return
  router.push({ path: '/ops-control-center', query: { event: selectedEventId.value } })
}

function applyPricingSelection() {
  const item = (insights.value.evaluations || []).find(
    (entry) => entry.id === pricingSelection.value
  )
  if (!item) {
    pricingDraft.inputUsdPerMillion = 0
    pricingDraft.outputUsdPerMillion = 0
    return
  }
  pricingDraft.inputUsdPerMillion = Number(item.pricing?.inputUsdPerMillion) || 0
  pricingDraft.outputUsdPerMillion = Number(item.pricing?.outputUsdPerMillion) || 0
}

async function savePricing() {
  const item = (insights.value.evaluations || []).find(
    (entry) => entry.id === pricingSelection.value
  )
  if (!item || actionKey.value) return
  actionKey.value = 'pricing'
  try {
    const result = assertOk(
      await opsApi.saveOpsInsightsSettings({
        providerId: item.providerId,
        providerName: item.providerName,
        model: item.model,
        inputUsdPerMillion: Math.max(0, Number(pricingDraft.inputUsdPerMillion) || 0),
        outputUsdPerMillion: Math.max(0, Number(pricingDraft.outputUsdPerMillion) || 0)
      }),
      '保存模型价格失败'
    )
    insights.value = result.data || insights.value
    applyPricingSelection()
    MessagePlugin.success({ content: '模型价格已保存，成本估算已刷新', placement: 'bottom-right' })
    await loadAudit()
  } catch (error) {
    MessagePlugin.error({ content: error.message || '保存模型价格失败', placement: 'bottom-right' })
  } finally {
    actionKey.value = ''
  }
}

async function exportDiagnostics() {
  if (actionKey.value) return
  actionKey.value = 'diagnostics-export'
  try {
    const result = assertOk(await opsApi.exportOpsDiagnostics(), '导出诊断包失败')
    if (result.canceled) return
    lastExport.value = result
    MessagePlugin.success({
      content: `诊断包已导出：${result.fileName}`,
      placement: 'bottom-right'
    })
    await loadAudit()
  } catch (error) {
    MessagePlugin.error({ content: error.message || '导出诊断包失败', placement: 'bottom-right' })
  } finally {
    actionKey.value = ''
  }
}

function queueRealtimeRefresh() {
  clearTimeout(refreshQueued)
  refreshQueued = setTimeout(() => {
    void refreshAfterAction()
  }, 250)
}

function nodeStatusText() {
  if (!nodeWatches.value.length) return '未关注'
  const offline = nodeWatches.value.filter((item) => item.lastState === 'offline').length
  const unknown = nodeWatches.value.filter(
    (item) => !['online', 'offline'].includes(item.lastState)
  ).length
  if (offline) return `${offline} 个离线`
  if (unknown) return `${unknown} 个待检查`
  return '全部在线'
}

function nodeStatusTone() {
  if (!nodeWatches.value.length) return 'neutral'
  if (nodeWatches.value.some((item) => item.lastState === 'offline')) return 'danger'
  if (nodeWatches.value.some((item) => !['online', 'offline'].includes(item.lastState)))
    return 'warning'
  return 'success'
}

function backupIntervalLabel(value) {
  return { hourly: '每小时', daily: '每天', weekly: '每周' }[value] || value || '未配置周期'
}

function backupStatusLabel(status) {
  return { healthy: '正常', warning: '需关注', error: '异常', disabled: '已停用' }[status] || '未知'
}

function backupStatusTone(status) {
  return (
    { healthy: 'success', warning: 'warning', error: 'danger', disabled: 'neutral' }[status] ||
    'neutral'
  )
}

function statusTone(status) {
  return (
    {
      succeeded: 'success',
      success: 'success',
      ok: 'success',
      guided: 'warning',
      started: 'warning',
      failed: 'danger'
    }[status] || 'neutral'
  )
}

function statusLabel(status) {
  return (
    {
      succeeded: '成功',
      success: '成功',
      ok: '成功',
      guided: '人工处理',
      started: '执行中',
      failed: '失败'
    }[status] ||
    status ||
    '未知'
  )
}

function runbookStatusLabel(status) {
  return { succeeded: '复检通过', failed: '执行失败', guided: '需人工处理' }[status] || '已记录'
}

function severityLabel(severity) {
  return { critical: '严重', warning: '警告', info: '提示' }[severity] || '提示'
}

function sourceLabel(source) {
  return (
    {
      automation: '自动化巡检',
      'model-monitor': '模型巡检',
      'node-service': 'Node 服务',
      backup: '数据备份',
      release: '系统发布',
      log: '日志分析',
      copilot: 'AI Copilot'
    }[source] ||
    source ||
    '系统'
  )
}

function stepTypeLabel(type) {
  return (
    {
      'automation-diagnostic': '读取自动化任务状态',
      'automation-recheck': '重新执行自动化检查',
      'model-monitor-diagnostic': '读取模型巡检结果',
      'model-monitor-recheck': '重新执行模型巡检',
      'node-service-diagnostic': '读取 Node 关注状态',
      'node-service-recheck': '重新扫描 Node 服务',
      'backup-diagnostic': '读取备份健康状态',
      'backup-recheck': '重新检查备份健康',
      'release-diagnostic': '发布历史诊断',
      'release-recheck': '发布人工复检',
      'log-diagnostic': '脱敏日志诊断',
      'log-recheck': '日志人工复检',
      'copilot-diagnostic': 'Copilot 建议复核',
      'copilot-recheck': 'Copilot 人工复检',
      'guided-review': '人工引导处理'
    }[type] || type
  )
}

function auditActionLabel(action) {
  return String(action || 'unknown').replaceAll('.', ' / ')
}

function auditTarget(target) {
  const entries = Object.entries(target || {})
  if (!entries.length) return '—'
  return entries
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`)
    .join(' · ')
}

function riskLabel(level) {
  return (
    { low: '低风险', medium: '中风险', high: '高风险', critical: '严重风险', unknown: '暂无样本' }[
      level
    ] || '暂无样本'
  )
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}

function formatDuration(value) {
  const milliseconds = Math.max(0, Number(value) || 0)
  if (milliseconds < 1000) return `${milliseconds}ms`
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`
}

function formatUsd(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 6
  }).format(Number(value) || 0)
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0)
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

function diagnosticsCountLabel(key) {
  return (
    {
      events: '事件',
      automationTasks: '自动化任务',
      modelHistory: '模型历史',
      nodeWatches: 'Node 关注',
      nodeHistory: 'Node 样本',
      releaseHistory: '发布历史',
      auditRecords: '审计记录',
      logEntries: '日志记录'
    }[key] || key
  )
}

onMounted(() => {
  void loadAll()
  unsubscribeOpsData = opsApi.onOpsDataChanged?.(queueRealtimeRefresh)
  refreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshAfterAction()
  }, 60_000)
})

onBeforeUnmount(() => {
  unsubscribeOpsData?.()
  clearInterval(refreshTimer)
  clearTimeout(refreshQueued)
})
</script>

<style scoped>
.task-center-page {
  min-width: 0;
}

.button {
  min-height: var(--header-control-height);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 0 var(--button-padding-x);
  cursor: pointer;
  font-size: var(--header-control-font-size);
  font-weight: 600;
  transition: all var(--transition-fast);
}

.button.primary {
  background: var(--primary);
  color: #fff;
}

.button.secondary {
  border-color: var(--border);
  background: var(--card-bg);
  color: var(--text);
}

.button.ghost {
  background: transparent;
  color: var(--text-secondary);
}

.button.danger {
  background: var(--danger);
  color: #fff;
}

.button.compact {
  min-height: var(--control-height-sm);
  padding-inline: 10px;
  font-size: var(--font-size-sm);
}

.button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.button:disabled,
input:disabled,
select:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px var(--panel-padding);
}

.notice--error {
  border-color: color-mix(in srgb, var(--danger) 32%, var(--border));
  background: var(--danger-light);
  color: var(--danger);
}

.notice p {
  margin-top: 3px;
  color: currentColor;
  font-size: var(--font-size-sm);
}

.summary-grid,
.insight-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--content-gap);
}

.summary-card,
.insight-card {
  min-width: 0;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--panel-padding);
  background: var(--card-bg);
  box-shadow: var(--shadow-xs);
}

.summary-card {
  border-top: 3px solid var(--primary);
}

.summary-card--warning {
  border-top-color: var(--danger);
}

.summary-card span,
.summary-card small,
.insight-card span,
.insight-card small {
  display: block;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  line-height: 18px;
}

.summary-card strong,
.insight-card > strong {
  display: block;
  margin: 6px 0;
  color: var(--text);
  font-size: var(--font-size-stat-sm);
  line-height: 32px;
}

.section-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 5px 10px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.section-badge--safe {
  background: var(--warning-light);
  color: #b45309;
}

.table-scroll {
  max-width: 100%;
  overflow-x: auto;
}

.data-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  border-bottom: 1px solid var(--border-light);
  padding: 12px;
  color: var(--text);
  font-size: var(--font-size-body);
  line-height: 20px;
  text-align: left;
  vertical-align: middle;
}

.data-table th {
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 600;
  white-space: nowrap;
}

.data-table tbody tr:last-child td {
  border-bottom: 0;
}

.data-table strong,
.data-table small {
  display: block;
}

.data-table small {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.task-table td:first-child {
  min-width: 210px;
}

.actions-column {
  width: 160px;
}

.row-actions,
.inline-actions,
.filter-row,
.result-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
}

.task-switch {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 2px 8px;
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  white-space: nowrap;
}

.status-pill--success {
  background: var(--success-light);
  color: var(--success);
}

.status-pill--warning {
  background: var(--warning-light);
  color: #b45309;
}

.status-pill--danger {
  background: var(--danger-light);
  color: var(--danger);
}

.two-column-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--content-gap);
  align-items: start;
}

.field-block,
.pricing-form label {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.field-block select,
.filter-row select,
.pricing-form select,
.pricing-form input {
  min-height: var(--control-height-md);
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  background: var(--card-bg);
  color: var(--text);
}

.inline-actions {
  margin-top: var(--spacing-md);
}

.runbook-plan,
.result-card,
.pricing-panel {
  margin-top: var(--spacing-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  background: var(--bg-subtle);
}

.runbook-plan__meta,
.activity-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.runbook-plan__meta strong,
.runbook-plan__meta small {
  display: block;
}

.runbook-plan__meta small,
.result-card p {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.step-list,
.activity-list,
.closure-list {
  display: grid;
  gap: var(--spacing-sm);
  margin: var(--spacing-md) 0;
  list-style: none;
}

.step-list li,
.closure-list li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.step-list li > span,
.closure-list li > span {
  flex: 0 0 auto;
  min-width: 32px;
  border-radius: 999px;
  padding: 3px 7px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: var(--font-size-xs);
  font-weight: 700;
  text-align: center;
}

.step-list strong,
.step-list small,
.closure-list strong,
.closure-list small {
  display: block;
}

.step-list small,
.closure-list small {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  line-height: 18px;
}

.result-card {
  border-color: color-mix(in srgb, var(--primary) 24%, var(--border));
  background: var(--primary-light);
}

.result-steps {
  margin-top: 10px;
}

.activity-list {
  margin: 0;
}

.activity-row {
  justify-content: flex-start;
  border-bottom: 1px solid var(--border-light);
  padding: 10px 0;
}

.activity-row:last-child {
  border-bottom: 0;
}

.activity-row > div {
  min-width: 0;
  flex: 1;
}

.activity-row strong,
.activity-row small {
  display: block;
}

.activity-row small,
.activity-row time {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.status-dot {
  width: 9px;
  height: 9px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--text-muted);
}

.status-dot--success {
  background: var(--success);
}

.status-dot--warning {
  background: var(--warning);
}

.status-dot--danger {
  background: var(--danger);
}

.audit-heading {
  align-items: center;
}

.audit-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  border-top: 1px solid var(--border-light);
  padding-top: var(--spacing-md);
}

.audit-pagination__actions {
  margin-top: 0;
}

.audit-table code {
  display: block;
  max-width: 420px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error-text {
  color: var(--danger) !important;
}

.insight-card ul {
  display: grid;
  gap: 4px;
  margin: 10px 0 0 18px;
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  line-height: 18px;
}

.insight-tables {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--content-gap);
  margin-top: var(--spacing-lg);
}

.insight-tables h4,
.pricing-panel h4 {
  margin-bottom: var(--spacing-sm);
  color: var(--text);
  font-size: var(--font-size-md);
}

.compact-table-scroll {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.compact-table {
  min-width: 520px;
}

.pricing-panel {
  display: grid;
  grid-template-columns: minmax(180px, 0.7fr) minmax(0, 2fr);
  gap: var(--spacing-lg);
  align-items: end;
}

.pricing-panel p,
.caveat-text {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  line-height: 18px;
}

.pricing-form {
  display: grid;
  grid-template-columns: minmax(180px, 1.5fr) repeat(2, minmax(130px, 1fr)) auto;
  gap: var(--spacing-sm);
  align-items: end;
}

.caveat-text {
  margin-top: var(--spacing-sm);
}

.diagnostics-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--spacing-sm);
}

.diagnostics-summary > div {
  border-radius: var(--radius-sm);
  padding: 10px;
  background: var(--bg-subtle);
}

.diagnostics-summary span,
.diagnostics-summary strong {
  display: block;
}

.diagnostics-summary span {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.diagnostics-summary strong {
  margin-top: 3px;
  color: var(--text);
  font-size: var(--font-size-lg);
}

.empty-state {
  padding: var(--spacing-lg);
  color: var(--text-muted);
  font-size: var(--font-size-body);
  text-align: center;
}

.muted-text {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.success-text {
  margin-top: var(--spacing-sm);
  color: var(--success);
  font-size: var(--font-size-sm);
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1100px) {
  .summary-grid,
  .insight-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pricing-panel,
  .pricing-form {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .summary-grid,
  .insight-grid,
  .two-column-grid,
  .insight-tables,
  .pricing-panel,
  .pricing-form {
    grid-template-columns: minmax(0, 1fr);
  }

  .notice,
  .audit-heading,
  .audit-pagination {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-row,
  .filter-row select,
  .audit-pagination__actions,
  .page-actions .button,
  .pricing-form .button {
    width: 100%;
  }

  .diagnostics-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .activity-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .activity-row time {
    width: 100%;
    padding-left: 19px;
  }
}
</style>
