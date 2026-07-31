<template>
  <div class="page ops-control-page">
    <header class="page-header">
      <div>
        <div class="eyebrow"><t-icon name="chat" /> OPS COPILOT</div>
        <h2 class="page-title">AI 运维指挥中心</h2>
        <p class="page-desc">汇总事件、以本地证据辅助排障，并通过确认式计划执行安全的运维操作。</p>
      </div>
      <button class="btn-secondary" type="button" :disabled="loading" @click="load"><t-icon :name="loading ? 'loading' : 'refresh'" :class="{ spinning: loading }" /> 刷新</button>
    </header>

    <section class="summary-grid" aria-label="运行摘要">
      <article><span>待处理事件</span><strong>{{ summary.open || 0 }}</strong><small>其中 {{ summary.critical || 0 }} 个严重</small></article>
      <article><span>风险告警</span><strong class="warning-text">{{ summary.warning || 0 }}</strong><small>日志、模型与巡检异常</small></article>
      <article><span>自动化任务</span><strong>{{ tasks.length }}</strong><small>{{ enabledTaskCount }} 个已启用</small></article>
      <article><span>默认 AI</span><strong class="provider-name">{{ activeProvider?.name || '未配置' }}</strong><small>{{ activeProvider?.model || '可先使用本地证据' }}</small></article>
    </section>

    <section class="content-grid">
      <article class="panel copilot-panel">
        <div class="panel-title"><div><h3>AI 运维 Copilot</h3><p>先收集本地事件、日志分析和知识库证据；任何外部打开操作仍需二次确认。</p></div><label class="check"><input v-model="copilotUseAi" type="checkbox" :disabled="!activeProvider" /> 使用默认 Provider</label></div>
        <textarea v-model="copilotPrompt" rows="5" maxlength="4000" placeholder="例如：分析最近发布异常，并给出下一步排查和安全操作计划。"></textarea>
        <div class="actions"><button class="btn-primary" type="button" :disabled="busy || !copilotPrompt.trim()" @click="askCopilot"><t-icon name="chat" /> {{ busy ? '分析中…' : '生成建议' }}</button><span>不会生成或执行 Shell、删除、发布、回滚命令。</span></div>
        <div v-if="copilotResult" class="copilot-result">
          <h4>建议与结论</h4><pre>{{ copilotResult.answer }}</pre>
          <div v-if="copilotResult.sources?.length" class="citation-list"><strong>本地证据</strong><button v-for="(source, index) in copilotResult.sources" :key="`${source.documentId}-${source.startLine}`" type="button" class="citation" @click="openKnowledge(source)">[{{ index + 1 }}] {{ source.title }} · {{ source.startLine }}–{{ source.endLine }} 行</button></div>
          <div v-if="copilotResult.plan" class="plan-card"><div><strong>确认式工作流</strong><p>{{ copilotResult.plan.summary }}</p></div><ol><li v-for="step in copilotResult.plan.steps" :key="step.id">{{ step.description }}<em v-if="step.requiresConfirmation">需要确认</em></li></ol><button v-if="copilotResult.plan.steps?.length" class="btn-secondary" type="button" @click="executePlan">确认后执行安全步骤</button></div>
        </div>
      </article>

      <article class="panel event-panel">
        <div class="panel-title"><div><h3>统一事件中心</h3><p>汇集 AI 日志分析、模型评测与自动化巡检结果。</p></div><select v-model="eventFilter"><option value="">全部状态</option><option value="open">待处理</option><option value="acknowledged">已确认</option><option value="resolved">已解决</option></select></div>
        <div class="event-list">
          <div v-for="item in filteredEvents" :key="item.id" :class="['event-item', item.level]">
            <span class="event-dot"></span><div class="event-content"><div><strong>{{ item.title }}</strong><span>{{ levelName(item.level) }} · {{ statusName(item.status) }}</span></div><p>{{ item.description || '无补充说明' }}</p><small>{{ formatTime(item.createdAt) }} · {{ item.category }}</small></div>
            <div class="event-actions"><button v-if="item.status === 'open'" type="button" class="btn-text" @click="updateEvent(item, 'acknowledged')">确认</button><button v-if="item.status !== 'resolved'" type="button" class="btn-text" @click="updateEvent(item, 'resolved')">解决</button></div>
          </div>
          <div v-if="!filteredEvents.length" class="empty-mini">暂无匹配事件。模型评测、日志风险和巡检失败会自动出现在这里。</div>
        </div>
      </article>
    </section>

    <section class="panel automation-panel">
      <div class="panel-title"><div><h3>自动化巡检任务</h3><p>支持 HTTP 健康检查与 TCP 端口连通性检测；任务在主进程按间隔执行并记录结果。</p></div></div>
      <div class="task-form">
        <label><span>任务名称</span><input v-model="taskForm.title" maxlength="120" placeholder="例如：生产站点健康检查" /></label>
        <label><span>类型</span><select v-model="taskForm.type"><option value="http-health">HTTP 健康检查</option><option value="tcp-port">TCP 端口检查</option></select></label>
        <label><span>{{ taskForm.type === 'tcp-port' ? '主机地址' : '检查地址' }}</span><input v-model.trim="taskForm.target" :placeholder="taskForm.type === 'tcp-port' ? '127.0.0.1' : 'https://example.com/health'" /></label>
        <label v-if="taskForm.type === 'tcp-port'"><span>端口</span><input v-model.number="taskForm.port" type="number" min="1" max="65535" placeholder="3000" /></label>
        <label v-else><span>期望状态</span><input v-model.number="taskForm.expectedStatus" type="number" min="100" max="599" /></label>
        <label><span>间隔（分钟）</span><input v-model.number="taskForm.intervalMinutes" type="number" min="5" max="10080" /></label>
        <label><span>超时（毫秒）</span><input v-model.number="taskForm.timeoutMs" type="number" min="1000" max="60000" /></label>
        <label class="check"><input v-model="taskForm.enabled" type="checkbox" /> 启用任务</label>
        <div class="task-form-actions"><button class="btn-primary" type="button" :disabled="savingTask" @click="saveTask">{{ taskForm.id ? '更新任务' : '添加任务' }}</button><button v-if="taskForm.id" class="btn-text" type="button" @click="resetTaskForm">取消编辑</button></div>
      </div>
      <div class="task-list"><div v-for="task in tasks" :key="task.id" class="task-item"><div><strong>{{ task.title }}</strong><p>{{ task.type === 'tcp-port' ? `TCP ${task.target}:${task.port}` : `${task.target} · HTTP ${task.expectedStatus}` }}</p><small>{{ task.enabled ? `每 ${task.intervalMinutes} 分钟` : '已停用' }} · {{ task.lastResult ? `${task.lastResult.ok ? '最近正常' : '最近失败'}：${task.lastResult.message}` : '尚未运行' }}</small></div><div class="task-actions"><button class="btn-text" type="button" :disabled="runningTaskId === task.id" @click="runTask(task)">{{ runningTaskId === task.id ? '运行中…' : '立即运行' }}</button><button class="btn-text" type="button" @click="editTask(task)">编辑</button><button class="btn-text danger-text" type="button" @click="removeTask(task)">删除</button></div></div><div v-if="!tasks.length" class="empty-mini">暂无自动化任务。可先添加部署后的 HTTP 健康检查。</div></div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useConfirm } from '../../composables/useConfirm'

const { confirm } = useConfirm()
const loading = ref(false)
const busy = ref(false)
const savingTask = ref(false)
const runningTaskId = ref('')
const events = ref([])
const summary = ref({})
const tasks = ref([])
const aiState = ref({ providers: { activeProviderId: '', providers: [] } })
const eventFilter = ref('open')
const copilotPrompt = ref('')
const copilotUseAi = ref(true)
const copilotResult = ref(null)
const taskForm = ref(newTask())
const activeProvider = computed(() => aiState.value.providers?.providers?.find(item => item.id === aiState.value.providers?.activeProviderId && item.enabled))
const enabledTaskCount = computed(() => tasks.value.filter(item => item.enabled).length)
const filteredEvents = computed(() => events.value.filter(item => !eventFilter.value || item.status === eventFilter.value))

function newTask() { return { id: '', title: '', type: 'http-health', target: '', port: 3000, expectedStatus: 200, intervalMinutes: 15, timeoutMs: 8000, enabled: true } }
function notify(result, fallback) { if (!result?.ok) { MessagePlugin.error({ content: result?.error || fallback, placement: 'bottom-right' }); return false } return true }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' }
function levelName(level) { return ({ info: '信息', warning: '警告', critical: '严重' })[level] || '信息' }
function statusName(status) { return ({ open: '待处理', acknowledged: '已确认', resolved: '已解决' })[status] || '待处理' }

async function load() {
  loading.value = true
  try {
    const [eventResult, taskResult, aiResult] = await Promise.all([window.opsApi.getOpsEvents({ limit: 100 }), window.opsApi.getAutomationTasks(), window.opsApi.getAiOpsState()])
    if (notify(eventResult, '读取事件失败')) { events.value = eventResult.items || []; summary.value = eventResult.summary || {} }
    if (notify(taskResult, '读取自动化任务失败')) tasks.value = taskResult.tasks || []
    if (aiResult?.ok) aiState.value = aiResult
  } finally { loading.value = false }
}
async function askCopilot() {
  busy.value = true
  try {
    const result = await window.opsApi.askAiCopilot({ prompt: copilotPrompt.value, useAi: copilotUseAi.value && Boolean(activeProvider.value), providerId: activeProvider.value?.id })
    if (notify(result, 'Copilot 分析失败')) { copilotResult.value = result; await load() }
  } finally { busy.value = false }
}
async function executePlan() {
  const plan = copilotResult.value?.plan
  if (!plan) return
  if (plan.requiresConfirmation && !await confirm({ title: '确认执行工作流', content: '仅执行计划中的安全外部打开步骤；不会发布、删除或回滚。', theme: 'warning' })) return
  const result = await window.opsApi.executeAiWorkflow({ plan, confirmed: true })
  if (notify(result, '执行工作流失败')) MessagePlugin.success({ content: '工作流已执行', placement: 'bottom-right' })
}
function openKnowledge(source) { window.location.hash = `#/ai-ops`; MessagePlugin.info({ content: `请在 AI 运维中心知识库查看「${source.title}」第 ${source.startLine}-${source.endLine} 行。`, placement: 'bottom-right' }) }
async function updateEvent(item, status) { const result = await window.opsApi.updateOpsEvent(item.id, status); if (notify(result, '更新事件失败')) await load() }
function editTask(task) { taskForm.value = { ...newTask(), ...task } }
function resetTaskForm() { taskForm.value = newTask() }
async function saveTask() { savingTask.value = true; try { const result = await window.opsApi.saveAutomationTask({ ...taskForm.value }); if (notify(result, '保存任务失败')) { resetTaskForm(); await load(); MessagePlugin.success({ content: '自动化任务已保存', placement: 'bottom-right' }) } } finally { savingTask.value = false } }
async function runTask(task) { runningTaskId.value = task.id; try { const result = await window.opsApi.runAutomationTask(task.id); if (notify(result, '运行任务失败')) { await load(); MessagePlugin[result.result?.ok ? 'success' : 'warning']({ content: result.result?.message || '任务已完成', placement: 'bottom-right' }) } } finally { runningTaskId.value = '' } }
async function removeTask(task) { if (!await confirm({ title: '删除自动化任务', content: `确定删除“${task.title}”吗？`, theme: 'warning' })) return; const result = await window.opsApi.deleteAutomationTask(task.id); if (notify(result, '删除任务失败')) { await load(); resetTaskForm() } }

onMounted(load)
</script>

<style scoped>
.ops-control-page{max-width:1500px;margin:0 auto;padding-bottom:32px}.eyebrow{display:flex;align-items:center;gap:7px;color:var(--primary);font-size:12px;font-weight:700;letter-spacing:.12em}.page-header{margin-bottom:20px}.btn-primary,.btn-secondary,.btn-text{border:0;border-radius:9px;padding:9px 13px;font:inherit;font-weight:600;cursor:pointer}.btn-primary{background:var(--primary);color:#fff}.btn-secondary{border:1px solid var(--border);background:#fff;color:var(--text)}.btn-text{padding:6px 8px;background:transparent;color:var(--primary)}.danger-text{color:var(--danger)}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.summary-grid article,.panel{border:1px solid var(--border);border-radius:var(--radius-lg);background:rgba(255,255,255,.88);box-shadow:var(--shadow-xs)}.summary-grid article{padding:16px}.summary-grid span,.summary-grid small{display:block;color:var(--text-muted);font-size:12px}.summary-grid strong{display:block;margin:7px 0 4px;font-size:25px}.summary-grid .provider-name{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.warning-text{color:#d97706}.content-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(380px,.9fr);gap:18px;margin-bottom:18px}.panel{padding:20px}.panel-title{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}.panel-title h3{font-size:16px}.panel-title p{margin-top:4px;color:var(--text-muted);font-size:13px;line-height:1.5}.check{display:flex;align-items:center;gap:7px;color:var(--text-secondary);font-size:13px;white-space:nowrap}.copilot-panel textarea{width:100%;resize:vertical;border:1px solid var(--border);border-radius:10px;padding:12px;color:var(--text);font:inherit}.actions{display:flex;align-items:center;gap:12px;margin-top:12px}.actions span{color:var(--text-muted);font-size:12px}.copilot-result{margin-top:18px;border-top:1px solid var(--border);padding-top:16px}.copilot-result h4{font-size:14px}.copilot-result pre{max-height:300px;overflow:auto;margin-top:8px;padding:12px;border-radius:9px;background:#0f172a;color:#e2e8f0;font:12px/1.6 var(--font-mono);white-space:pre-wrap}.citation-list{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;font-size:12px}.citation{border:1px solid #c7d2fe;border-radius:999px;background:#eef2ff;color:#4f46e5;padding:5px 8px;cursor:pointer}.plan-card{margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-subtle)}.plan-card p{margin-top:3px;color:var(--text-muted);font-size:13px}.plan-card ol{margin:10px 0 12px;padding-left:20px;font-size:13px;line-height:1.8}.plan-card em{margin-left:7px;color:#d97706;font-size:12px;font-style:normal}.event-panel{min-height:430px}.event-list{display:grid;gap:9px;max-height:510px;overflow:auto}.event-item{display:flex;gap:10px;padding:11px;border:1px solid var(--border);border-radius:10px}.event-dot{width:8px;height:8px;flex:none;margin-top:6px;border-radius:50%;background:#64748b}.event-item.warning .event-dot{background:#f59e0b}.event-item.critical .event-dot{background:#ef4444}.event-content{min-width:0;flex:1}.event-content>div{display:flex;justify-content:space-between;gap:8px}.event-content span,.event-content p,.event-content small{color:var(--text-muted);font-size:12px}.event-content p{margin:4px 0;line-height:1.4}.event-actions{display:flex;flex-direction:column;align-items:flex-end}.automation-panel{margin-bottom:24px}.task-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding-bottom:18px;border-bottom:1px solid var(--border)}.task-form label{display:grid;gap:6px;color:var(--text-secondary);font-size:12px}.task-form input,.task-form select,.event-panel select{height:36px;border:1px solid var(--border);border-radius:8px;padding:0 9px;background:#fff;color:var(--text);font:inherit}.task-form .check{display:flex;padding-top:21px}.task-form-actions{display:flex;align-items:flex-end;gap:8px}.task-list{display:grid;gap:8px;margin-top:16px}.task-item{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px;border:1px solid var(--border);border-radius:10px}.task-item p,.task-item small{display:block;margin-top:3px;color:var(--text-muted);font-size:12px}.task-actions{display:flex;align-items:center;gap:3px;white-space:nowrap}.empty-mini{padding:22px;color:var(--text-muted);text-align:center;font-size:13px}@media(max-width:1100px){.summary-grid{grid-template-columns:repeat(2,1fr)}.content-grid{grid-template-columns:1fr}.task-form{grid-template-columns:repeat(2,1fr)}}@media(max-width:640px){.summary-grid,.task-form{grid-template-columns:1fr}.page-header,.panel-title,.task-item{align-items:flex-start;flex-direction:column}.event-actions,.task-actions{align-items:flex-start;flex-direction:row}.actions{align-items:flex-start;flex-direction:column}}
</style>
