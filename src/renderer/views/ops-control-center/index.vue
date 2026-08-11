<template>
  <div class="page ops-control-page">
    <header class="page-header">
      <div class="page-heading">
        <div class="page-eyebrow"><t-icon name="chat" /> OPS CENTER</div>
        <h2 class="page-title">运维中心</h2>
        <p class="page-desc">
          集中处理统一事件、执行自动化巡检，并使用 AI Copilot 基于本地证据辅助排障。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn-secondary" type="button" :disabled="loading" @click="load">
          <t-icon :name="loading ? 'loading' : 'refresh'" :class="{ spinning: loading }" />
          刷新
        </button>
      </div>
    </header>

    <main class="page-content">
      <section class="summary-grid" aria-label="运行摘要">
        <article class="surface-panel summary-card">
          <span>活跃事件</span>
          <strong>{{ summary.active ?? summary.open ?? 0 }}</strong>
          <small>{{ summary.open || 0 }} 个待处理，{{ summary.acknowledged || 0 }} 个已确认</small>
        </article>
        <article class="surface-panel summary-card">
          <span>严重风险</span>
          <strong class="danger-value">{{ summary.critical || 0 }}</strong>
          <small>另有 {{ summary.warning || 0 }} 个警告事件</small>
        </article>
        <article class="surface-panel summary-card">
          <span>自动恢复</span>
          <strong class="success-value">{{ summary.recovered || 0 }}</strong>
          <small>恢复后自动关闭并保留时间线</small>
        </article>
        <article class="surface-panel summary-card">
          <span>自动化任务</span>
          <strong>{{ tasks.length }}</strong>
          <small>{{ enabledTaskCount }} 个已启用</small>
        </article>
      </section>

      <section class="content-grid">
        <article class="surface-panel page-section copilot-panel">
          <div class="section-toolbar">
            <div class="section-heading">
              <h3 class="section-title">AI 运维 Copilot</h3>
              <p class="section-desc">
                先收集本地事件、日志分析和知识库证据；任何外部打开操作仍需二次确认。
              </p>
            </div>
            <label class="check checkbox-row"
              ><input v-model="copilotUseAi" type="checkbox" :disabled="!activeProvider" /> 使用默认
              Provider</label
            >
          </div>
          <textarea
            v-model="copilotPrompt"
            rows="5"
            maxlength="4000"
            placeholder="例如：分析最近发布异常，并给出下一步排查和安全操作计划。"
          ></textarea>
          <div class="actions">
            <button
              class="btn-primary"
              type="button"
              :disabled="busy || !copilotPrompt.trim()"
              @click="askCopilot"
            >
              <t-icon name="chat" /> {{ busy ? '分析中…' : '生成建议' }}
            </button>
            <span>不会生成或执行 Shell、删除、发布、回滚命令。</span>
          </div>
          <div v-if="copilotResult" class="copilot-result">
            <h4>建议与结论</h4>
            <pre>{{ copilotResult.answer }}</pre>
            <div v-if="copilotResult.timeline?.items?.length" class="copilot-timeline-card">
              <div class="copilot-timeline-heading">
                <div>
                  <strong>关联时间线</strong>
                  <p>
                    共 {{ copilotResult.timeline.summary?.total || 0 }} 条，严重
                    {{ copilotResult.timeline.summary?.critical || 0 }} 条，警告
                    {{ copilotResult.timeline.summary?.warning || 0 }} 条
                  </p>
                </div>
                <button type="button" class="btn-text" @click="attachCopilotTimelineToAiChat">
                  <t-icon name="attach" /> 附加时间线
                </button>
              </div>
              <ol class="copilot-timeline">
                <li
                  v-for="item in copilotResult.timeline.items.slice(0, 12)"
                  :key="item.id"
                  :class="item.severity"
                >
                  <span class="copilot-timeline-dot" aria-hidden="true"></span>
                  <div>
                    <strong>{{ item.title }}</strong>
                    <p v-if="item.detail">{{ item.detail }}</p>
                    <small
                      >{{ sourceName(item.sourceType) }} · {{ formatTime(item.timestamp) }}</small
                    >
                  </div>
                </li>
              </ol>
            </div>
            <div v-if="copilotResult.sources?.length" class="citation-list">
              <strong>本地证据</strong>
              <button
                v-for="(source, index) in copilotResult.sources"
                :key="`${source.documentId}-${source.startLine}`"
                type="button"
                class="citation"
                @click="openKnowledge(source)"
              >
                [{{ index + 1 }}] {{ source.title }} · {{ source.startLine }}–{{ source.endLine }}
                行
              </button>
            </div>
            <div v-if="copilotResult.plan" class="plan-card">
              <div>
                <strong>确认式工作流</strong>
                <p>{{ copilotResult.plan.summary }}</p>
              </div>
              <ol>
                <li
                  v-for="step in copilotResult.plan.steps"
                  :key="step.id || `${step.type}-${step.label}`"
                >
                  <div class="plan-step-content">
                    <strong>{{ step.description || step.label }}</strong>
                    <span><b>影响</b>{{ step.impact || '仅执行预览中的安全动作。' }}</span>
                    <span><b>回滚点</b>{{ step.rollbackPoint || '未产生系统变更。' }}</span>
                    <span><b>审批</b>{{ step.approval?.reason || '由用户主动触发。' }}</span>
                  </div>
                  <em :class="step.risk">{{ copilotRiskLabel(step.risk) }}</em>
                  <button
                    v-if="step.type === 'navigate'"
                    class="btn-text"
                    type="button"
                    :disabled="busy"
                    @click="openPlanStep(step)"
                  >
                    {{ step.approval?.required ? '确认并前往' : '前往' }}
                  </button>
                </li>
              </ol>
              <button
                v-if="copilotExternalSteps.length"
                class="btn-secondary"
                type="button"
                :disabled="busy"
                @click="executePlan"
              >
                确认打开 {{ copilotExternalSteps.length }} 个外部链接
              </button>
              <small v-else>此计划没有可执行的外部打开步骤；页面步骤请点击“前往”。</small>
            </div>
          </div>
        </article>

        <article class="surface-panel page-section event-panel">
          <div class="section-toolbar event-heading">
            <div class="section-heading">
              <h3 class="section-title">统一事件与通知</h3>
              <p class="section-desc">
                按稳定指纹聚合发布、模型、日志和巡检异常，恢复后自动关闭事件。
              </p>
            </div>
            <div class="event-filters" aria-label="事件筛选">
              <TSelect
                v-model="eventFilter"
                class="event-filter-select"
                size="medium"
                :options="eventFilterOptions"
                :input-props="{ 'aria-label': '事件状态' }"
              />
              <TSelect
                v-model="sourceFilter"
                class="event-filter-select"
                size="medium"
                :options="eventSourceOptions"
                :input-props="{ 'aria-label': '事件来源' }"
              />
            </div>
          </div>

          <div ref="eventListRef" class="event-list">
            <article
              v-for="item in filteredEvents"
              :key="item.id"
              :data-event-id="item.id"
              :class="[
                'event-item',
                item.severity || item.level,
                {
                  resolved: item.status === 'resolved',
                  targeted: expandedEventId === item.id && route.query.event === item.id
                }
              ]"
            >
              <span class="event-dot" aria-hidden="true"></span>
              <div class="event-content">
                <div class="event-title-row">
                  <strong>{{ item.title }}</strong>
                  <div class="event-badges">
                    <span :class="['status-badge', item.status]">{{
                      statusName(item.status)
                    }}</span>
                    <span v-if="item.recoveredAt" class="status-badge recovered">自动恢复</span>
                    <span v-if="item.occurrenceCount > 1" class="count-badge"
                      >重复 {{ item.occurrenceCount }} 次</span
                    >
                  </div>
                </div>
                <p>{{ item.description || '无补充说明' }}</p>
                <div class="event-meta">
                  <span>{{ sourceName(item.sourceType || item.category) }}</span>
                  <span>{{ levelName(item.severity || item.level) }}</span>
                  <span
                    >最近
                    {{ formatTime(item.lastOccurredAt || item.updatedAt || item.createdAt) }}</span
                  >
                </div>
                <div v-if="expandedEventId === item.id" class="event-detail">
                  <dl>
                    <div>
                      <dt>首次发生</dt>
                      <dd>{{ formatTime(item.firstOccurredAt || item.createdAt) }}</dd>
                    </div>
                    <div>
                      <dt>最近发生</dt>
                      <dd>{{ formatTime(item.lastOccurredAt || item.updatedAt) }}</dd>
                    </div>
                    <div>
                      <dt>来源标识</dt>
                      <dd>{{ item.sourceId || item.relatedId || '—' }}</dd>
                    </div>
                    <div>
                      <dt>事件指纹</dt>
                      <dd>{{ item.fingerprint || item.sourceKey || '—' }}</dd>
                    </div>
                  </dl>
                  <p v-if="item.resolutionNote" class="resolution-note">
                    <strong>处理结果：</strong>{{ item.resolutionNote }}
                  </p>
                  <ol v-if="item.timeline?.length" class="event-timeline">
                    <li v-for="entry in [...item.timeline].reverse()" :key="entry.id">
                      <span>{{ timelineName(entry.type) }}</span>
                      <p>{{ entry.message || '状态已更新' }}</p>
                      <time>{{ formatTime(entry.createdAt) }}</time>
                    </li>
                  </ol>
                </div>
              </div>
              <div class="event-actions">
                <button type="button" class="btn-text" @click="toggleEvent(item)">
                  {{ expandedEventId === item.id ? '收起' : '详情' }}
                </button>
                <button type="button" class="btn-text" @click="attachEventToAiChat(item)">
                  <t-icon name="attach" /> 附加证据
                </button>
                <button
                  type="button"
                  class="btn-text"
                  :disabled="postmortemBusy && postmortemEventId === item.id"
                  @click="generatePostmortem(item)"
                >
                  <t-icon name="file-text" />
                  {{ postmortemBusy && postmortemEventId === item.id ? '生成中…' : '复盘草稿' }}
                </button>
                <button
                  v-if="item.status === 'open'"
                  type="button"
                  class="btn-text"
                  @click="updateEvent(item, 'acknowledged')"
                >
                  确认
                </button>
                <button
                  v-if="item.status !== 'resolved'"
                  type="button"
                  class="btn-text"
                  @click="updateEvent(item, 'resolved')"
                >
                  解决
                </button>
                <button v-else type="button" class="btn-text" @click="updateEvent(item, 'open')">
                  重新打开
                </button>
              </div>
            </article>
            <div v-if="!filteredEvents.length" class="empty-mini">
              暂无匹配事件。发布、模型、日志和巡检异常会自动汇集到这里。
            </div>
          </div>
        </article>
      </section>

      <section v-if="postmortem" class="surface-panel page-section ai-document-panel">
        <div class="section-toolbar">
          <div class="section-heading">
            <h3 class="section-title">{{ postmortem.title }}</h3>
            <p class="section-desc">
              基于主进程中的事件与关联时间线生成；根因、影响与负责人仍需人工复核。
            </p>
          </div>
          <div class="document-actions">
            <button class="btn-text" type="button" @click="attachPostmortemToAiChat">
              <t-icon name="attach" /> 附加到 AI 对话
            </button>
            <button
              class="btn-primary"
              type="button"
              :disabled="postmortemBusy"
              @click="savePostmortem"
            >
              <t-icon name="save" /> 确认并保存知识库
            </button>
            <button class="btn-text" type="button" @click="postmortem = null">关闭</button>
          </div>
        </div>
        <div class="document-summary-grid">
          <div>
            <span>严重级别</span>
            <strong>{{ levelName(postmortem.severity) }}</strong>
          </div>
          <div>
            <span>持续时间</span>
            <strong>{{ postmortem.period?.duration || '待补充' }}</strong>
          </div>
          <div>
            <span>证据条目</span>
            <strong>{{ postmortem.evidence?.length || 0 }}</strong>
          </div>
          <div>
            <span>后续行动</span>
            <strong>{{ postmortem.actions?.length || 0 }}</strong>
          </div>
        </div>
        <pre class="ai-document-preview">{{ postmortem.markdown }}</pre>
      </section>

      <section class="surface-panel page-section ai-document-panel report-panel">
        <div class="section-toolbar">
          <div class="section-heading">
            <h3 class="section-title">运维报告与交接</h3>
            <p class="section-desc">
              汇总本地事件、发布、Node 监控、Runbook 与日志分析，生成可导出、可附加的报告。
            </p>
          </div>
          <div class="report-controls">
            <TSelect
              v-model="reportKind"
              class="report-kind-select"
              size="medium"
              :options="reportKindOptions"
              :input-props="{ 'aria-label': '报告类型' }"
            />
            <button
              class="btn-primary"
              type="button"
              :disabled="reportBusy"
              @click="generateReport"
            >
              <t-icon
                :name="reportBusy ? 'loading' : 'file-text'"
                :class="{ spinning: reportBusy }"
              />
              {{ reportBusy ? '生成中…' : '生成报告' }}
            </button>
          </div>
        </div>
        <template v-if="opsReport">
          <div class="document-summary-grid report-summary-grid">
            <div>
              <span>事件</span>
              <strong>{{ opsReport.metrics?.events?.total || 0 }}</strong>
              <small>当前活跃 {{ opsReport.metrics?.events?.active || 0 }}</small>
            </div>
            <div>
              <span>发布</span>
              <strong>{{ opsReport.metrics?.releases?.total || 0 }}</strong>
              <small>失败 {{ opsReport.metrics?.releases?.failed || 0 }}</small>
            </div>
            <div>
              <span>离线服务</span>
              <strong>{{ opsReport.metrics?.nodes?.offlineServices || 0 }}</strong>
              <small>采样 {{ opsReport.metrics?.nodes?.checks || 0 }} 次</small>
            </div>
            <div>
              <span>异常线索</span>
              <strong>{{ opsReport.metrics?.logs?.findings || 0 }}</strong>
              <small>日志 {{ opsReport.metrics?.logs?.analyses || 0 }} 份</small>
            </div>
          </div>
          <div class="report-risk-list">
            <strong>风险与关注项</strong>
            <ul>
              <li v-for="item in opsReport.risks" :key="item">{{ item }}</li>
            </ul>
          </div>
          <pre class="ai-document-preview">{{ opsReport.markdown }}</pre>
          <div class="document-footer-actions">
            <button
              class="btn-secondary"
              type="button"
              :disabled="reportBusy"
              @click="exportReport"
            >
              <t-icon name="download" /> 导出 Markdown
            </button>
            <button class="btn-secondary" type="button" @click="attachReportToAiChat">
              <t-icon name="attach" /> 附加到 AI 对话
            </button>
          </div>
        </template>
        <div v-else class="empty-mini">
          选择报告类型后生成，本地数据不会自动发送给 AI Provider。
        </div>
      </section>

      <section class="surface-panel page-section automation-panel">
        <div class="section-heading">
          <h3 class="section-title">自动化巡检任务</h3>
          <p class="section-desc">
            支持 HTTP 健康检查与 TCP 端口连通性检测；重复失败会聚合为同一事件，恢复后自动关闭。
          </p>
        </div>
        <div class="task-form">
          <label
            ><span>任务名称</span
            ><input v-model="taskForm.title" maxlength="120" placeholder="例如：生产站点健康检查"
          /></label>
          <label
            ><span>检查类型</span
            ><select v-model="taskForm.type">
              <option value="http-health">HTTP 健康检查</option>
              <option value="tcp-port">TCP 端口</option>
            </select></label
          >
          <label
            ><span>{{ taskForm.type === 'tcp-port' ? '主机地址' : '检查地址' }}</span
            ><input
              v-model="taskForm.target"
              :placeholder="
                taskForm.type === 'tcp-port' ? '127.0.0.1' : 'https://example.com/health'
              "
          /></label>
          <label v-if="taskForm.type === 'tcp-port'"
            ><span>端口</span
            ><input v-model.number="taskForm.port" type="number" min="1" max="65535"
          /></label>
          <label v-else
            ><span>期望状态码</span
            ><input v-model.number="taskForm.expectedStatus" type="number" min="100" max="599"
          /></label>
          <label
            ><span>间隔（分钟）</span
            ><input v-model.number="taskForm.intervalMinutes" type="number" min="5" max="10080"
          /></label>
          <label
            ><span>超时（毫秒）</span
            ><input v-model.number="taskForm.timeoutMs" type="number" min="1000" max="60000"
          /></label>
          <label class="check checkbox-row task-enabled"
            ><input v-model="taskForm.enabled" type="checkbox" /> 启用任务</label
          >
          <div class="task-form-actions">
            <button class="btn-primary" type="button" :disabled="savingTask" @click="saveTask">
              {{ taskForm.id ? '更新任务' : '添加任务' }}
            </button>
            <button v-if="taskForm.id" class="btn-text" type="button" @click="resetTaskForm">
              取消编辑
            </button>
          </div>
        </div>
        <div class="task-list">
          <article v-for="task in tasks" :key="task.id" class="task-item">
            <div>
              <strong>{{ task.title }}</strong>
              <p>
                {{
                  task.type === 'tcp-port'
                    ? `TCP ${task.target}:${task.port}`
                    : `${task.target} · HTTP ${task.expectedStatus}`
                }}
              </p>
              <small
                >{{ task.enabled ? `每 ${task.intervalMinutes} 分钟` : '已停用' }} ·
                {{
                  task.lastResult
                    ? `${task.lastResult.ok ? '最近正常' : '最近失败'}：${task.lastResult.message}`
                    : '尚未运行'
                }}</small
              >
            </div>
            <div class="task-actions">
              <button
                class="btn-text"
                type="button"
                :disabled="runningTaskId === task.id"
                @click="runTask(task)"
              >
                {{ runningTaskId === task.id ? '运行中…' : '立即运行' }}
              </button>
              <button class="btn-text" type="button" @click="editTask(task)">编辑</button>
              <button class="btn-text danger-text" type="button" @click="removeTask(task)">
                删除
              </button>
            </div>
          </article>
          <div v-if="!tasks.length" class="empty-mini">
            暂无自动化任务。可先添加部署后的 HTTP 健康检查。
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { opsApi } from '../../api/opsApi.js'
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { Select as TSelect } from 'tdesign-vue-next/es/select/index.mjs'
import { useRoute, useRouter } from 'vue-router'
import { useConfirm } from '../../composables/useConfirm'
import { addAiContextAttachment } from '../../utils/ai-context.js'

defineOptions({ name: 'OpsControlCenter' })

const { confirm } = useConfirm()
const route = useRoute()
const router = useRouter()
const loading = ref(false)
const hasLoaded = ref(false)
const busy = ref(false)
const savingTask = ref(false)
const runningTaskId = ref('')
const expandedEventId = ref('')
const eventListRef = ref(null)
const lastFocusedEventId = ref('')
const events = ref([])
const summary = ref({})
const tasks = ref([])
const aiState = ref({ providers: { activeProviderId: '', providers: [] } })
const eventFilter = ref('active')
const sourceFilter = ref('')
const copilotPrompt = ref('')
const copilotUseAi = ref(true)
const copilotResult = ref(null)
const postmortem = ref(null)
const postmortemBusy = ref(false)
const postmortemEventId = ref('')
const reportKind = ref('daily')
const reportBusy = ref(false)
const opsReport = ref(null)
const taskForm = ref(newTask())
const eventFilterOptions = Object.freeze([
  { label: '活跃事件', value: 'active' },
  { label: '待处理', value: 'open' },
  { label: '已确认', value: 'acknowledged' },
  { label: '已解决', value: 'resolved' },
  { label: '全部状态', value: '' }
])
const reportKindOptions = Object.freeze([
  { label: '每日运维报告', value: 'daily' },
  { label: '每周运维报告', value: 'weekly' },
  { label: '交接班报告', value: 'handoff' }
])

const activeProvider = computed(() =>
  aiState.value.providers?.providers?.find(
    (item) =>
      item.id === aiState.value.providers?.activeProviderId &&
      item.enabled &&
      item.available &&
      item.hasApiKey
  )
)
const copilotExternalSteps = computed(() =>
  (copilotResult.value?.plan?.steps || []).filter((step) => step.type === 'open-url')
)
const enabledTaskCount = computed(() => tasks.value.filter((item) => item.enabled).length)
const eventSources = computed(() =>
  [...new Set(events.value.map((item) => item.sourceType || item.category).filter(Boolean))].sort()
)
const eventSourceOptions = computed(() => [
  { label: '全部来源', value: '' },
  ...eventSources.value.map((source) => ({ label: sourceName(source), value: source }))
])
const filteredEvents = computed(() =>
  events.value.filter((item) => {
    const matchesStatus =
      eventFilter.value === 'active'
        ? item.status !== 'resolved'
        : !eventFilter.value || item.status === eventFilter.value
    const matchesSource =
      !sourceFilter.value || (item.sourceType || item.category) === sourceFilter.value
    return matchesStatus && matchesSource
  })
)

function newTask() {
  return {
    id: '',
    title: '',
    type: 'http-health',
    target: '',
    port: 3000,
    expectedStatus: 200,
    intervalMinutes: 15,
    timeoutMs: 8000,
    enabled: true
  }
}
function notify(result, fallback) {
  if (!result?.ok) {
    MessagePlugin.error({ content: result?.error || fallback, placement: 'bottom-right' })
    return false
  }
  return true
}
function formatTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}
function levelName(level) {
  return { info: '信息', warning: '警告', critical: '严重' }[level] || '信息'
}
function statusName(status) {
  return { open: '待处理', acknowledged: '已确认', resolved: '已解决' }[status] || '待处理'
}
function sourceName(source) {
  return (
    {
      automation: '自动化巡检',
      'node-service': 'Node 服务',
      'data-backup': '本地数据备份',
      'model-monitor': '模型巡检',
      model: '模型评测',
      release: '系统发布',
      log: '日志分析',
      copilot: 'AI Copilot',
      system: '系统'
    }[source] ||
    source ||
    '系统'
  )
}
function timelineName(type) {
  return (
    {
      opened: '事件创建',
      occurred: '再次发生',
      reopened: '重新触发',
      acknowledged: '已确认',
      resolved: '已解决',
      recovered: '自动恢复'
    }[type] || '状态更新'
  )
}
function toggleEvent(item) {
  expandedEventId.value = expandedEventId.value === item.id ? '' : item.id
}

async function focusRouteEvent() {
  const eventId = String(route.query.event || '')
  if (!eventId || lastFocusedEventId.value === eventId) return
  const item = events.value.find((entry) => entry.id === eventId)
  if (!item) return
  eventFilter.value = item.status === 'resolved' ? '' : 'active'
  sourceFilter.value = ''
  expandedEventId.value = eventId
  lastFocusedEventId.value = eventId
  if (!item.readAt) {
    const result = await opsApi.markOpsEventsRead?.({ ids: [eventId] })
    if (result?.ok) {
      item.readAt = Number(result.readAt) || Date.now()
      summary.value = result.summary || summary.value
    }
  }
  await nextTick()
  const target = [...(eventListRef.value?.querySelectorAll('[data-event-id]') || [])].find(
    (element) => element.dataset.eventId === eventId
  )
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function load() {
  loading.value = true
  try {
    const [eventResult, taskResult, aiResult] = await Promise.all([
      opsApi.getOpsEvents({ limit: 500 }),
      opsApi.getAutomationTasks(),
      opsApi.getAiOpsState()
    ])
    if (notify(eventResult, '读取事件失败')) {
      events.value = eventResult.items || []
      summary.value = eventResult.summary || {}
    }
    if (notify(taskResult, '读取自动化任务失败')) tasks.value = taskResult.tasks || []
    if (aiResult?.ok) aiState.value = aiResult
    hasLoaded.value = true
    await focusRouteEvent()
  } finally {
    loading.value = false
  }
}
async function askCopilot() {
  busy.value = true
  try {
    const result = await opsApi.askAiCopilot({
      prompt: copilotPrompt.value,
      useAi: copilotUseAi.value && Boolean(activeProvider.value),
      providerId: activeProvider.value?.id
    })
    if (notify(result, 'Copilot 分析失败')) {
      copilotResult.value = result
      await load()
    }
  } finally {
    busy.value = false
  }
}
async function executePlan() {
  const plan = copilotResult.value?.plan
  if (!plan?.id || !copilotExternalSteps.value.length) return
  if (
    !(await confirm({
      title: '确认打开外部链接',
      content: '仅打开计划中的外部链接；不会提交数据，也不会发布、删除、回滚或结束进程。',
      theme: 'warning'
    }))
  )
    return
  busy.value = true
  try {
    const result = await opsApi.executeAiWorkflow({
      planId: plan.id,
      stepIds: copilotExternalSteps.value.map((step) => step.id),
      confirmed: true
    })
    if (notify(result, '执行工作流失败')) {
      const opened = (result.completed || []).filter((step) => step.status === 'done').length
      MessagePlugin.success({
        content: `已打开 ${opened} 个外部链接，审批已写入安全审计`,
        placement: 'bottom-right'
      })
    }
  } finally {
    busy.value = false
  }
}
function validCopilotRoute(target) {
  return [
    '/system-release',
    '/ai-models',
    '/ai-operations',
    '/knowledge-base',
    '/ai-integrations',
    '/node-services'
  ].includes(String(target || '').split('?')[0])
}
function copilotRiskLabel(level) {
  return { high: '高风险', medium: '需注意', low: '低风险' }[level] || '未知'
}
async function openPlanStep(step) {
  const plan = copilotResult.value?.plan
  if (step?.type !== 'navigate' || !step.target || !plan?.id) return
  if (!validCopilotRoute(step.target)) {
    MessagePlugin.error({ content: '该页面步骤无效，请重新生成计划', placement: 'bottom-right' })
    return
  }
  let confirmed = false
  if (step.approval?.required) {
    confirmed = await confirm({
      title: '确认进入高影响操作页面',
      content: `${step.impact || '此步骤只会切换页面。'} ${step.rollbackPoint || ''} 进入后，任何真实操作仍需单独确认。`,
      theme: 'warning'
    })
    if (!confirmed) return
  }
  busy.value = true
  try {
    const result = await opsApi.executeAiWorkflow({
      planId: plan.id,
      stepIds: [step.id],
      confirmed
    })
    if (!notify(result, '审批页面步骤失败')) return
    const navigation = (result.completed || []).find(
      (item) => item.status === 'requires-user-navigation'
    )
    if (!navigation || !validCopilotRoute(navigation.target)) {
      MessagePlugin.error({ content: '页面步骤未通过主进程校验', placement: 'bottom-right' })
      return
    }
    await router.push(String(navigation.target))
  } finally {
    busy.value = false
  }
}
function openKnowledge(source) {
  router.push({ path: '/knowledge-base', query: { document: source.title } })
  MessagePlugin.info({
    content: `请在知识库查看「${source.title}」第 ${source.startLine}-${source.endLine} 行。`,
    placement: 'bottom-right'
  })
}

function attachEventToAiChat(item) {
  const timeline = (item.timeline || [])
    .slice(-8)
    .map((entry) => `${timelineName(entry.type)}：${entry.message || '状态已更新'}`)
  addAiContextAttachment({
    source: '事件详情',
    title: item.title || '运维事件',
    content: [item.description, item.resolutionNote, ...timeline].filter(Boolean).join('\n'),
    metadata: {
      level: levelName(item.severity || item.level),
      status: statusName(item.status),
      source: sourceName(item.sourceType || item.category),
      eventId: item.id
    }
  })
  MessagePlugin.success({ content: '事件证据已附加到 AI 对话', placement: 'bottom-right' })
}

function attachCopilotTimelineToAiChat() {
  const timeline = copilotResult.value?.timeline
  const items = Array.isArray(timeline?.items) ? timeline.items.slice(0, 30) : []
  if (!items.length) return
  addAiContextAttachment({
    source: 'Copilot 时间线',
    title: '运维关联时间线',
    content: items
      .map(
        (item) =>
          `[${formatTime(item.timestamp)}][${sourceName(item.sourceType)}][${levelName(item.severity)}] ${item.title}${item.detail ? `：${item.detail}` : ''}`
      )
      .join('\n'),
    metadata: {
      total: timeline.summary?.total || items.length,
      critical: timeline.summary?.critical || 0,
      warning: timeline.summary?.warning || 0,
      generatedAt: formatTime(timeline.generatedAt)
    }
  })
  MessagePlugin.success({ content: '关联时间线已附加到 AI 对话', placement: 'bottom-right' })
}

async function generatePostmortem(item) {
  postmortemBusy.value = true
  postmortemEventId.value = item.id
  try {
    const result = await opsApi.generateAiPostmortem(item.id)
    if (!notify(result, '生成事件复盘失败')) return
    postmortem.value = result.postmortem
    await nextTick()
    document
      .querySelector('.ai-document-panel')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } finally {
    postmortemBusy.value = false
    postmortemEventId.value = ''
  }
}

function attachPostmortemToAiChat() {
  if (!postmortem.value?.markdown) return
  addAiContextAttachment({
    source: '事件复盘',
    title: postmortem.value.title,
    content: postmortem.value.markdown,
    metadata: {
      eventId: postmortem.value.eventId,
      severity: levelName(postmortem.value.severity),
      generatedAt: formatTime(postmortem.value.generatedAt)
    }
  })
  MessagePlugin.success({ content: '事件复盘已附加到 AI 对话', placement: 'bottom-right' })
}

async function savePostmortem() {
  if (!postmortem.value?.markdown) return
  const approved = await confirm({
    title: '确认保存事件复盘',
    content: '请确认已复核根因、影响范围和后续负责人。保存后会作为本地知识文档供检索使用。',
    theme: 'warning'
  })
  if (!approved) return
  postmortemBusy.value = true
  try {
    const result = await opsApi.saveAiKnowledge({
      title: postmortem.value.title,
      tags: [
        '事件复盘',
        sourceName(postmortem.value.sourceType),
        levelName(postmortem.value.severity)
      ],
      content: postmortem.value.markdown
    })
    if (notify(result, '保存事件复盘失败'))
      MessagePlugin.success({ content: '事件复盘已保存到本地知识库', placement: 'bottom-right' })
  } finally {
    postmortemBusy.value = false
  }
}

async function generateReport() {
  reportBusy.value = true
  try {
    const result = await opsApi.generateAiOpsReport({ kind: reportKind.value })
    if (notify(result, '生成运维报告失败')) opsReport.value = result.report
  } finally {
    reportBusy.value = false
  }
}

async function exportReport() {
  if (!opsReport.value?.markdown) return
  reportBusy.value = true
  try {
    const result = await opsApi.exportAiKnowledge({
      title: `${opsReport.value.title}-${new Date(opsReport.value.generatedAt).toISOString().slice(0, 10)}`,
      tags: [
        '运维报告',
        reportKindOptions.find((item) => item.value === opsReport.value.kind)?.label
      ],
      content: opsReport.value.markdown
    })
    if (result?.ok) MessagePlugin.success({ content: '运维报告已导出', placement: 'bottom-right' })
    else if (!result?.canceled) notify(result, '导出运维报告失败')
  } finally {
    reportBusy.value = false
  }
}

function attachReportToAiChat() {
  if (!opsReport.value?.markdown) return
  addAiContextAttachment({
    source: '运维报告',
    title: opsReport.value.title,
    content: opsReport.value.markdown,
    metadata: {
      kind: opsReport.value.kind,
      from: formatTime(opsReport.value.period?.from),
      to: formatTime(opsReport.value.period?.to)
    }
  })
  MessagePlugin.success({ content: '运维报告已附加到 AI 对话', placement: 'bottom-right' })
}

async function updateEvent(item, status) {
  const result = await opsApi.updateOpsEvent(item.id, status)
  if (notify(result, '更新事件失败')) await load()
}
function editTask(task) {
  taskForm.value = { ...newTask(), ...task }
}
function resetTaskForm() {
  taskForm.value = newTask()
}
async function saveTask() {
  savingTask.value = true
  try {
    const result = await opsApi.saveAutomationTask({ ...taskForm.value })
    if (notify(result, '保存任务失败')) {
      resetTaskForm()
      await load()
      MessagePlugin.success({ content: '自动化任务已保存', placement: 'bottom-right' })
    }
  } finally {
    savingTask.value = false
  }
}
async function runTask(task) {
  runningTaskId.value = task.id
  try {
    const result = await opsApi.runAutomationTask(task.id)
    if (notify(result, '运行任务失败')) {
      await load()
      MessagePlugin[result.result?.ok ? 'success' : 'warning']({
        content: result.result?.message || '任务已完成',
        placement: 'bottom-right'
      })
    }
  } finally {
    runningTaskId.value = ''
  }
}
async function removeTask(task) {
  if (
    !(await confirm({
      title: '删除自动化任务',
      content: `确定删除“${task.title}”吗？`,
      theme: 'warning'
    }))
  )
    return
  const result = await opsApi.deleteAutomationTask(task.id)
  if (notify(result, '删除任务失败')) {
    await load()
    resetTaskForm()
  }
}

watch(
  () => route.query.event,
  (eventId) => {
    if (!eventId) lastFocusedEventId.value = ''
    void focusRouteEvent()
  }
)

onMounted(load)
onActivated(() => {
  if (hasLoaded.value) load()
})
</script>

<style scoped>
.danger-text,
.danger-value {
  color: var(--danger);
}
.success-value {
  color: var(--success);
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--content-gap);
}
.summary-card {
  padding: var(--panel-padding);
}
.summary-card span,
.summary-card small {
  display: block;
  color: var(--text-muted);
  font-size: 12px;
}
.summary-card strong {
  display: block;
  margin: 7px 0 4px;
  font-size: 25px;
}
.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(420px, 0.95fr);
  gap: var(--content-gap);
  align-items: start;
}
.section-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}
.check {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 13px;
  white-space: nowrap;
}
.copilot-panel textarea {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  color: var(--text);
  font: inherit;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.actions span {
  color: var(--text-muted);
  font-size: 12px;
}
.copilot-result {
  margin-top: 18px;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.copilot-result h4 {
  font-size: 14px;
}
.copilot-result pre {
  max-height: 300px;
  overflow: auto;
  margin-top: 8px;
  padding: 12px;
  border-radius: 9px;
  background: #0f172a;
  color: #e2e8f0;
  font: 12px/1.6 var(--font-mono);
  white-space: pre-wrap;
}
.citation-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
  font-size: 12px;
}
.copilot-timeline-card {
  display: grid;
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card-bg);
}
.copilot-timeline-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.copilot-timeline-heading p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}
.copilot-timeline {
  display: grid;
  gap: 8px;
  max-height: 330px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;
}
.copilot-timeline li {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  padding: 8px 0;
  border-top: 1px solid var(--border);
}
.copilot-timeline li:first-child {
  border-top: 0;
}
.copilot-timeline-dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--primary);
}
.copilot-timeline li.warning .copilot-timeline-dot {
  background: var(--warning);
}
.copilot-timeline li.critical .copilot-timeline-dot {
  background: var(--danger);
}
.copilot-timeline strong,
.copilot-timeline p,
.copilot-timeline small {
  overflow-wrap: anywhere;
}
.copilot-timeline p {
  margin: 3px 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.copilot-timeline small {
  color: var(--text-muted);
  font-size: 11px;
}
.citation {
  border: 1px solid #c7d2fe;
  border-radius: 999px;
  background: #eef2ff;
  color: #4f46e5;
  padding: 5px 8px;
  cursor: pointer;
}
.plan-card {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-subtle);
}
.plan-card p {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 13px;
}
.plan-card ol {
  display: grid;
  gap: 10px;
  margin: 10px 0 12px;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.plan-card li {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: 9px;
  background: var(--surface);
}
.plan-step-content {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 5px;
}
.plan-step-content span {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 7px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.plan-step-content b {
  color: var(--text-muted);
  font-size: 11px;
}
.plan-card em {
  flex: none;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--success-light);
  color: var(--success);
  font-size: 11px;
  font-style: normal;
  font-weight: 700;
}
.plan-card em.medium {
  background: var(--warning-light);
  color: #a16207;
}
.plan-card em.high {
  background: var(--danger-light);
  color: var(--danger);
}

.ai-document-panel {
  min-width: 0;
}
.document-actions,
.report-controls,
.document-footer-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.report-kind-select {
  width: 168px;
}
.document-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.document-summary-grid > div {
  min-width: 0;
  padding: 11px;
  border: 1px solid var(--border-light);
  border-radius: 9px;
  background: var(--bg-subtle);
}
.document-summary-grid span,
.document-summary-grid small {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
}
.document-summary-grid strong {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
  font-size: 15px;
}
.ai-document-preview {
  max-height: 520px;
  overflow: auto;
  margin: 0;
  padding: 14px;
  border-radius: 9px;
  background: #0f172a;
  color: #e2e8f0;
  font: 12px/1.65 var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.report-risk-list {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg-subtle);
}
.report-risk-list ul {
  display: grid;
  gap: 6px;
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.document-footer-actions {
  margin-top: 12px;
}

.event-panel {
  order: -1;
  min-width: 0;
}
.event-heading {
  align-items: flex-end;
}
.event-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.event-filters .event-filter-select {
  width: 132px;
  flex: 0 0 132px;
}
.task-form input:not([type='checkbox']),
.task-form select {
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 9px;
  background: #fff;
  color: var(--text);
  font: inherit;
}
.event-list {
  display: grid;
  gap: 9px;
  max-height: 620px;
  overflow: auto;
  padding-right: 2px;
}
.event-item {
  display: flex;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
}
.event-item.resolved {
  background: var(--bg-subtle);
}
.event-item.targeted {
  border-color: color-mix(in srgb, var(--primary) 48%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 10%, transparent);
}
.event-dot {
  width: 8px;
  height: 8px;
  flex: none;
  margin-top: 7px;
  border-radius: 50%;
  background: #64748b;
}
.event-item.warning .event-dot {
  background: #f59e0b;
}
.event-item.critical .event-dot {
  background: #ef4444;
}
.event-item.resolved .event-dot {
  background: #10b981;
}
.event-content {
  min-width: 0;
  flex: 1;
}
.event-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.event-title-row > strong {
  min-width: 0;
  overflow-wrap: anywhere;
}
.event-badges {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}
.status-badge,
.count-badge {
  border-radius: 999px;
  padding: 3px 7px;
  background: #f1f5f9;
  color: #475569;
  font-size: 11px;
  white-space: nowrap;
}
.status-badge.open {
  background: #fff7ed;
  color: #c2410c;
}
.status-badge.acknowledged {
  background: #eef2ff;
  color: #4f46e5;
}
.status-badge.resolved,
.status-badge.recovered {
  background: #ecfdf5;
  color: #047857;
}
.event-content > p {
  margin: 6px 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  color: var(--text-muted);
  font-size: 12px;
}
.event-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.event-detail {
  margin-top: 12px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.event-detail dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px 16px;
}
.event-detail dl div {
  min-width: 0;
}
.event-detail dt {
  color: var(--text-muted);
  font-size: 11px;
}
.event-detail dd {
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.resolution-note {
  padding: 9px 10px;
  border-radius: 8px;
  background: #ecfdf5;
  color: #047857 !important;
}
.event-timeline {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}
.event-timeline li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  color: var(--text-muted);
  font-size: 11px;
}
.event-timeline li > span {
  color: var(--text-secondary);
  font-weight: 600;
}
.event-timeline p {
  margin: 0;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.event-timeline time {
  white-space: nowrap;
}

.automation-panel {
  margin: 0;
}
.task-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: var(--spacing-md);
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}
.task-form label {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}
.task-form .task-enabled {
  display: flex;
  align-self: end;
  height: 36px;
}
.task-form-actions {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.task-list {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}
.task-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.task-item p,
.task-item small {
  display: block;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.task-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}
.empty-mini {
  padding: 22px;
  color: var(--text-muted);
  text-align: center;
  font-size: 13px;
}

@media (max-width: 1100px) {
  .summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .content-grid {
    grid-template-columns: 1fr;
  }
  .task-form {
    grid-template-columns: repeat(2, 1fr);
  }
  .document-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .summary-grid,
  .task-form,
  .event-detail dl,
  .document-summary-grid {
    grid-template-columns: 1fr;
  }
  .section-toolbar,
  .task-item,
  .event-title-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .event-filters {
    width: 100%;
    justify-content: stretch;
  }
  .event-filters .event-filter-select {
    min-width: 0;
    width: auto;
    flex: 1 1 0;
  }
  .document-actions,
  .report-controls,
  .document-footer-actions,
  .report-kind-select {
    width: 100%;
    justify-content: flex-start;
  }
  .event-actions,
  .task-actions {
    align-items: flex-start;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .actions {
    align-items: flex-start;
    flex-direction: column;
  }
  .event-timeline li {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
