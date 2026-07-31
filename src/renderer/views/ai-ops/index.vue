<template>
  <div class="page ai-ops-page">
    <header class="page-header">
      <div>
        <div class="eyebrow"><t-icon name="gesture-pray" /> AI OPS CENTER</div>
        <h2>AI 运维中心</h2>
        <p>评测模型、分析脱敏日志、检索本地知识，并把自然语言需求变成可确认的运维工作流。</p>
      </div>
      <div class="header-actions">
        <span class="safety-chip"><t-icon name="secured" /> 凭证加密 · 执行需确认</span>
        <button class="btn-secondary" :disabled="loading" @click="loadState"><t-icon name="refresh" /> 刷新</button>
      </div>
    </header>

    <div class="tab-bar" role="tablist">
      <button v-for="tab in tabs" :key="tab.id" :class="['tab-btn', { active: activeTab === tab.id }]" @click="activeTab = tab.id">
        <t-icon :name="tab.icon" /> {{ tab.name }}
      </button>
    </div>

    <section v-if="activeTab === 'providers'" class="panel-grid providers-layout">
      <article class="panel form-panel">
        <div class="panel-title"><div><h3>AI Provider</h3><p>仅支持 OpenAI 兼容的 Chat Completions 接口；API Key 仅保存为系统加密数据。</p></div></div>
        <div class="form-grid">
          <label><span>名称</span><input v-model="providerForm.name" placeholder="例如：公司 AI 网关" maxlength="80" /></label>
          <label><span>默认模型</span><input v-model="providerForm.model" placeholder="例如：gpt-4.1-mini" maxlength="160" /></label>
          <label class="full"><span>接口地址</span><input v-model="providerForm.baseUrl" placeholder="https://api.example.com/v1" maxlength="500" /></label>
          <label class="full"><span>API Key <em>编辑已有 Provider 时留空即保持不变</em></span><input v-model="providerForm.apiKey" type="password" placeholder="sk-..." autocomplete="off" /></label>
          <label class="check"><input v-model="providerForm.enabled" type="checkbox" /> 启用此 Provider</label>
          <label class="check"><input v-model="providerForm.clearApiKey" type="checkbox" /> 清除已保存的 API Key</label>
        </div>
        <div class="actions"><button class="btn-primary" :disabled="busy" @click="saveProvider"><t-icon name="save" /> 保存 Provider</button><button v-if="providerForm.id" class="btn-text" @click="resetProviderForm">取消编辑</button></div>
      </article>
      <article class="panel provider-list-panel">
        <div class="panel-title"><div><h3>已配置 Provider</h3><p>{{ providers.length ? `当前激活：${activeProvider?.name || '未选择'}` : '尚未配置 Provider' }}</p></div></div>
        <div v-if="!providers.length" class="empty-mini">先添加一个 Provider，后续 AI 总结和模型评测即可使用。</div>
        <div v-for="provider in providers" :key="provider.id" :class="['provider-card', { selected: provider.id === providerState.activeProviderId }]">
          <div class="provider-card-main"><strong>{{ provider.name }}</strong><span>{{ provider.model }}</span><small>{{ provider.baseUrl }}</small><small v-if="provider.hasApiKey">密钥：{{ provider.apiKeyMasked }}</small><small v-else class="danger-text">未配置密钥</small></div>
          <div class="card-actions"><button v-if="provider.id !== providerState.activeProviderId" class="btn-text" @click="activateProvider(provider.id)">设为默认</button><button class="icon-btn" title="连接测试" :disabled="busy" @click="testProvider(provider.id)"><t-icon name="check-circle" /></button><button class="icon-btn" title="编辑" @click="editProvider(provider)"><t-icon name="edit" /></button><button class="icon-btn danger" title="删除" @click="removeProvider(provider)"><t-icon name="delete" /></button></div>
        </div>
      </article>
    </section>

    <section v-else-if="activeTab === 'evaluation'" class="stack">
      <article class="panel">
        <div class="panel-title"><div><h3>模型语义评测</h3><p>除了连通性，验证关键字、JSON 输出和平均响应时间。评测回答会脱敏后保存在本机。</p></div><button class="btn-primary" :disabled="busy || !evaluationCases.length" @click="runEvaluation"><t-icon name="play-circle" /> 运行评测</button></div>
        <div class="case-form form-grid compact">
          <label><span>用例名称</span><input v-model="caseForm.name" placeholder="例如：JSON 结构化输出" /></label>
          <label><span>期望关键词 <em>逗号分隔，可选</em></span><input v-model="caseForm.expectedKeywords" placeholder="status, result" /></label>
          <label class="full"><span>提示词</span><textarea v-model="caseForm.prompt" rows="3" placeholder="输入希望模型完成的任务"></textarea></label>
          <label class="full"><span>系统提示词 <em>可选</em></span><input v-model="caseForm.systemPrompt" placeholder="例如：仅返回 JSON 对象" /></label>
          <label class="check"><input v-model="caseForm.expectJson" type="checkbox" /> 要求合法 JSON 对象</label>
          <div class="actions"><button class="btn-secondary" @click="upsertCase"><t-icon name="add" /> {{ caseForm.id ? '更新用例' : '加入用例' }}</button><button v-if="caseForm.id" class="btn-text" @click="resetCaseForm">取消编辑</button></div>
        </div>
        <div v-if="!evaluationCases.length" class="empty-mini">尚无评测用例。可先添加“关键词判断”或“JSON 输出”用例。</div>
        <div v-else class="data-table cases-table"><div v-for="item in evaluationCases" :key="item.id" class="table-row"><div><strong>{{ item.name }}</strong><p>{{ item.prompt }}</p><span v-if="item.expectedKeywords?.length" class="tag">关键词：{{ item.expectedKeywords.join('、') }}</span><span v-if="item.expectJson" class="tag">JSON</span></div><div class="row-actions"><button class="btn-text" @click="editCase(item)">编辑</button><button class="btn-text danger-text" @click="removeCase(item.id)">删除</button></div></div></div>
      </article>
      <article class="panel" v-if="latestEvaluation">
        <div class="panel-title"><div><h3>最近一次评测结果</h3><p>{{ formatTime(latestEvaluation.finishedAt) }} · {{ latestEvaluation.providerName }} / {{ latestEvaluation.model }}</p></div><div class="metric"><b>{{ latestEvaluation.summary.passed }}/{{ latestEvaluation.summary.total }}</b><span>通过</span></div></div>
        <div class="result-grid"><div v-for="item in latestEvaluation.results" :key="item.id" :class="['result-card', item.ok ? 'ok' : 'failed']"><div><strong>{{ item.name }}</strong><span>{{ item.ok ? '通过' : '未通过' }} · {{ item.durationMs }}ms</span></div><p v-if="item.error">{{ item.error }}</p><p v-else-if="!item.ok">{{ item.expectJson && !item.jsonOk ? '返回内容不是 JSON 对象。' : '未命中所有期望关键词。' }}</p><details v-if="item.answer"><summary>查看脱敏回答</summary><pre>{{ item.answer }}</pre></details></div></div>
      </article>
    </section>

    <section v-else-if="activeTab === 'logs'" class="panel-grid logs-layout">
      <article class="panel form-panel">
        <div class="panel-title"><div><h3>AI 日志分析</h3><p>日志在发给模型前会先进行密钥、Token、密码与私钥脱敏；也可只做本地规则分析。</p></div></div>
        <div class="form-grid"><label><span>日志标题</span><input v-model="logForm.title" placeholder="例如：正式环境发布失败 2026-07-31" /></label><label class="check align-end"><input v-model="logForm.useAi" type="checkbox" :disabled="!providers.length" /> 使用当前 AI Provider 生成总结</label><label class="full"><span>日志内容</span><textarea v-model="logForm.text" rows="16" maxlength="200000" placeholder="粘贴 Nginx、应用、发布或模型测试日志"></textarea></label></div>
        <div class="actions"><button class="btn-primary" :disabled="busy || !logForm.text.trim()" @click="analyzeLog"><t-icon name="search" /> 分析日志</button></div>
      </article>
      <article class="panel"><div class="panel-title"><div><h3>分析记录</h3><p>仅保留脱敏后的统计、节选和 AI 总结。</p></div></div><div v-if="!logs.length" class="empty-mini">暂无日志分析记录。</div><div v-for="item in logs.slice(0, 8)" :key="item.id" class="analysis-card"><div class="analysis-head"><div><strong>{{ item.title }}</strong><p>{{ formatTime(item.createdAt) }} · {{ item.lineCount }} 行</p></div><span :class="['risk', item.level]">{{ riskLabel(item.level) }}</span></div><p>{{ item.headline }}</p><ul><li v-for="finding in item.findings" :key="finding.type">{{ finding.type }}：{{ finding.count }} 条</li></ul><details v-if="item.aiSummary"><summary>AI 分析结论</summary><pre>{{ item.aiSummary }}</pre></details><details><summary>查看脱敏日志节选</summary><pre>{{ item.excerpt }}</pre></details></div></article>
    </section>

    <section v-else-if="activeTab === 'knowledge'" class="panel-grid knowledge-layout">
      <article class="panel form-panel"><div class="panel-title"><div><h3>本地运维知识库</h3><p>可保存发布规范、故障复盘、服务器说明和排障手册；检索结果显示具体行号。</p></div></div><div class="form-grid"><label><span>标题</span><input v-model="knowledgeForm.title" placeholder="例如：正式环境发布 SOP" /></label><label><span>标签</span><input v-model="knowledgeForm.tags" placeholder="发布, 正式环境, 回滚" /></label><label class="full"><span>内容</span><textarea v-model="knowledgeForm.content" rows="13" maxlength="200000" placeholder="粘贴本地文档内容。保存前会脱敏。"></textarea></label></div><div class="actions"><button class="btn-primary" :disabled="busy || !knowledgeForm.content.trim()" @click="saveKnowledge"><t-icon name="save" /> 保存到知识库</button></div><div class="knowledge-list"><div v-for="doc in knowledgeDocuments" :key="doc.id" class="knowledge-doc"><div><strong>{{ doc.title }}</strong><p>{{ doc.tags?.join(' · ') || '无标签' }} · {{ formatTime(doc.updatedAt) }}</p></div><button class="btn-text danger-text" @click="removeKnowledge(doc.id)">删除</button></div></div></article>
      <article class="panel search-panel"><div class="panel-title"><div><h3>检索与问答</h3><p>默认仅返回本地证据片段；开启 AI 后会要求答案标注来源编号。</p></div></div><div class="search-row"><input v-model="knowledgeQuery" placeholder="例如：正式环境如何回滚？" @keyup.enter="searchKnowledge" /><button class="btn-secondary" :disabled="busy" @click="searchKnowledge"><t-icon name="search" /> 检索</button></div><label class="check"><input v-model="knowledgeUseAi" type="checkbox" :disabled="!providers.length" /> 使用当前 AI Provider 基于检索结果回答</label><button class="btn-primary answer-btn" :disabled="busy || !knowledgeQuery.trim()" @click="answerKnowledge"><t-icon name="chat" /> 生成带引用的回答</button><div v-if="knowledgeAnswer" class="answer-box"><strong>回答</strong><pre>{{ knowledgeAnswer }}</pre></div><div v-if="knowledgeResults.length" class="search-results"><div v-for="(item, index) in knowledgeResults" :key="`${item.documentId}-${item.startLine}`" class="search-result"><strong>[{{ index + 1 }}] {{ item.title }}</strong><span>第 {{ item.startLine }}–{{ item.endLine }} 行 · 匹配 {{ item.score }}</span><pre>{{ item.content }}</pre></div></div><div v-else-if="searched" class="empty-mini">没有检索到匹配知识。</div></article>
    </section>

    <section v-else-if="activeTab === 'workflow'" class="panel-grid workflow-layout">
      <article class="panel form-panel"><div class="panel-title"><div><h3>自然语言运维工作流</h3><p>AI 工作流当前只会生成预览；外部打开必须在你确认后执行，不会自动发布、删除或回滚。</p></div></div><textarea v-model="workflowPrompt" rows="8" placeholder="例如：打开测试环境后台、进入发布页面并查看模型评测"></textarea><div class="actions"><button class="btn-primary" :disabled="busy || !workflowPrompt.trim()" @click="planWorkflow"><t-icon name="gesture-pray" /> 生成预览</button></div></article>
      <article class="panel"><div class="panel-title"><div><h3>执行预览</h3><p>{{ workflowPlan ? '请核对每一步，再决定是否执行。' : '尚未生成工作流。' }}</p></div></div><div v-if="workflowPlan" class="workflow-plan"><div class="workflow-request">{{ workflowPlan.prompt }}</div><ol><li v-for="step in workflowPlan.steps" :key="`${step.type}-${step.label}`"><span :class="['step-risk', step.risk]">{{ step.risk === 'medium' ? '需注意' : '低风险' }}</span><div><strong>{{ step.label }}</strong><p v-if="step.target">{{ step.target }}</p><small v-if="step.requiresConfirmation">此步需要确认后才会执行。</small></div></li></ol><button class="btn-primary" :disabled="busy" @click="executeWorkflow"><t-icon name="play-circle" /> {{ workflowPlan.requiresConfirmation ? '确认并执行允许的步骤' : '确认工作流' }}</button></div><div v-else class="empty-mini">支持“打开网站”“进入发布”“模型测试”“日志排查”等关键词；发布操作只会导航到页面，不会自动执行。</div></article>
    </section>

    <section v-else-if="activeTab === 'mcp'" class="panel mcp-panel"><div class="panel-title"><div><h3>MCP 本地只读服务</h3><p>供 Codex、Claude Desktop 等客户端访问本机发布历史、模型健康度和运维知识库。不会暴露密钥，也不提供发布写操作。</p></div></div><div v-if="mcpInfo" class="mcp-content"><div class="mcp-badge"><t-icon name="secured" /> stdio · 只读</div><p>可用工具：<code>{{ mcpInfo.tools.join(' · ') }}</code></p><p>{{ mcpInfo.note }}</p><label><span>启动命令</span><input :value="mcpInfo.command" readonly @focus="$event.target.select()" /></label><label><span>启动参数</span><input :value="mcpInfo.args.join(' ')" readonly @focus="$event.target.select()" /></label><pre>{{ mcpConfigExample }}</pre></div><div v-else class="empty-mini">正在读取 MCP 配置…</div></section>

    <div v-if="loading" class="loading-overlay"><t-icon name="loading" /> 正在加载 AI 运维数据…</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useConfirm } from '../../composables/useConfirm'

const { confirm } = useConfirm()
const tabs = [
  { id: 'providers', name: 'Provider', icon: 'server' },
  { id: 'evaluation', name: '模型评测', icon: 'chart-bar' },
  { id: 'logs', name: '日志分析', icon: 'search' },
  { id: 'knowledge', name: '知识库', icon: 'folder-open' },
  { id: 'workflow', name: '智能工作流', icon: 'rocket' },
  { id: 'mcp', name: 'MCP', icon: 'api' },
]
const activeTab = ref('providers')
const loading = ref(true)
const busy = ref(false)
const providerState = ref({ activeProviderId: '', providers: [] })
const evaluationState = ref({ cases: [], runs: [] })
const logState = ref({ items: [] })
const knowledgeState = ref({ documents: [] })
const workflowState = ref({ history: [] })
const mcpInfo = ref(null)

const newProvider = () => ({ id: '', name: '', baseUrl: '', model: '', apiKey: '', enabled: true, clearApiKey: false })
const newCase = () => ({ id: '', name: '', prompt: '', systemPrompt: '', expectedKeywords: '', expectJson: false })
const providerForm = ref(newProvider())
const caseForm = ref(newCase())
const logForm = ref({ title: '', text: '', useAi: false })
const knowledgeForm = ref({ title: '', tags: '', content: '' })
const knowledgeQuery = ref('')
const knowledgeUseAi = ref(false)
const knowledgeResults = ref([])
const knowledgeAnswer = ref('')
const searched = ref(false)
const workflowPrompt = ref('')
const workflowPlan = ref(null)

const providers = computed(() => providerState.value.providers || [])
const activeProvider = computed(() => providers.value.find(item => item.id === providerState.value.activeProviderId))
const evaluationCases = computed(() => evaluationState.value.cases || [])
const latestEvaluation = computed(() => evaluationState.value.runs?.[0] || null)
const logs = computed(() => logState.value.items || [])
const knowledgeDocuments = computed(() => knowledgeState.value.documents || [])
const mcpConfigExample = computed(() => mcpInfo.value ? JSON.stringify({ mcpServers: { 'ops-desktop': { command: mcpInfo.value.command, args: mcpInfo.value.args } } }, null, 2) : '')

function notify(result, fallback = '操作失败') {
  if (result?.ok) return true
  MessagePlugin.error({ content: result?.error || fallback, placement: 'bottom-right' })
  return false
}
function formatTime(timestamp) { return timestamp ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '—' }
function riskLabel(level) { return ({ high: '高风险', medium: '需关注', low: '低风险' })[level] || '未知' }

async function loadState() {
  loading.value = true
  try {
    const result = await window.opsApi.getAiOpsState()
    if (!notify(result, '读取 AI 运维数据失败')) return
    providerState.value = result.providers || providerState.value
    evaluationState.value = result.evaluations || evaluationState.value
    logState.value = result.logs || logState.value
    knowledgeState.value = result.knowledge || knowledgeState.value
    workflowState.value = result.workflows || workflowState.value
    const info = await window.opsApi.getAiMcpInfo()
    if (info?.ok) mcpInfo.value = info
  } catch (error) { MessagePlugin.error({ content: error.message || '读取 AI 运维数据失败', placement: 'bottom-right' }) } finally { loading.value = false }
}

function resetProviderForm() { providerForm.value = newProvider() }
function editProvider(provider) { providerForm.value = { ...newProvider(), ...provider, apiKey: '', clearApiKey: false }; activeTab.value = 'providers' }
async function saveProvider() {
  busy.value = true
  try { const result = await window.opsApi.saveAiProvider(providerForm.value); if (notify(result, '保存 Provider 失败')) { providerState.value = result.activeProviderId ? { ...providerState.value, activeProviderId: result.activeProviderId, providers: providers.value.filter(item => item.id !== result.provider.id).concat(result.provider) } : providerState.value; await loadState(); resetProviderForm(); MessagePlugin.success({ content: 'AI Provider 已加密保存', placement: 'bottom-right' }) } } finally { busy.value = false }
}
async function activateProvider(id) { busy.value = true; try { const result = await window.opsApi.activateAiProvider(id); if (notify(result)) { providerState.value = result.providers; MessagePlugin.success({ content: '已切换默认 Provider', placement: 'bottom-right' }) } } finally { busy.value = false } }
async function testProvider(id) { busy.value = true; try { const result = await window.opsApi.testAiProvider(id); if (notify(result, '连接测试失败')) MessagePlugin.success({ content: `连接正常：${result.content}`, placement: 'bottom-right', duration: 5000 }) } finally { busy.value = false } }
async function removeProvider(provider) { if (!await confirm({ title: '删除 AI Provider', content: `确定删除「${provider.name}」吗？已保存的加密密钥将一并删除。`, theme: 'warning' })) return; busy.value = true; try { const result = await window.opsApi.deleteAiProvider(provider.id); if (notify(result)) { providerState.value = result.providers; resetProviderForm() } } finally { busy.value = false } }

function resetCaseForm() { caseForm.value = newCase() }
function editCase(item) { caseForm.value = { ...newCase(), ...item, expectedKeywords: (item.expectedKeywords || []).join(', ') } }
async function persistCases(next) { const result = await window.opsApi.saveAiEvaluationCases(next); if (notify(result, '保存评测用例失败')) evaluationState.value = { ...evaluationState.value, cases: result.cases }; return result?.ok }
async function upsertCase() { try { const form = caseForm.value; if (!form.prompt.trim()) throw new Error('请输入提示词'); const item = { ...form, expectedKeywords: form.expectedKeywords }; const index = evaluationCases.value.findIndex(row => row.id === item.id); const next = [...evaluationCases.value]; if (index >= 0) next[index] = item; else next.push(item); if (await persistCases(next)) { resetCaseForm(); MessagePlugin.success({ content: '评测用例已保存', placement: 'bottom-right' }) } } catch (error) { MessagePlugin.error({ content: error.message || '保存评测用例失败', placement: 'bottom-right' }) } }
async function removeCase(id) { if (await persistCases(evaluationCases.value.filter(item => item.id !== id))) resetCaseForm() }
async function runEvaluation() { busy.value = true; try { const result = await window.opsApi.runAiEvaluation({ providerId: providerState.value.activeProviderId }); if (notify(result, '运行评测失败')) { evaluationState.value = { ...evaluationState.value, runs: [result.run, ...(evaluationState.value.runs || [])] }; MessagePlugin.success({ content: `评测完成：${result.run.summary.passed}/${result.run.summary.total} 通过`, placement: 'bottom-right' }) } } finally { busy.value = false } }

async function analyzeLog() { busy.value = true; try { const result = await window.opsApi.analyzeAiLog({ ...logForm.value, providerId: providerState.value.activeProviderId }); if (notify(result, '日志分析失败')) { logState.value = { ...logState.value, items: [result.item, ...logs.value] }; logForm.value = { title: '', text: '', useAi: logForm.value.useAi }; MessagePlugin.success({ content: '日志已脱敏分析并保存', placement: 'bottom-right' }) } } finally { busy.value = false } }

async function saveKnowledge() { busy.value = true; try { const result = await window.opsApi.saveAiKnowledge({ ...knowledgeForm.value, tags: knowledgeForm.value.tags }); if (notify(result, '保存知识失败')) { knowledgeState.value = { ...knowledgeState.value, documents: [result.document, ...knowledgeDocuments.value.filter(item => item.id !== result.document.id)] }; knowledgeForm.value = { title: '', tags: '', content: '' }; MessagePlugin.success({ content: '知识文档已脱敏保存', placement: 'bottom-right' }) } } finally { busy.value = false } }
async function removeKnowledge(id) { if (!await confirm({ title: '删除知识文档', content: '确定删除该本地知识文档吗？', theme: 'warning' })) return; const result = await window.opsApi.deleteAiKnowledge(id); if (notify(result)) knowledgeState.value = { ...knowledgeState.value, documents: result.documents } }
async function searchKnowledge() { if (!knowledgeQuery.value.trim()) return; busy.value = true; searched.value = false; try { const result = await window.opsApi.searchAiKnowledge(knowledgeQuery.value); if (notify(result, '检索失败')) { knowledgeResults.value = result.results || []; knowledgeAnswer.value = ''; searched.value = true } } finally { busy.value = false } }
async function answerKnowledge() { if (!knowledgeQuery.value.trim()) return; busy.value = true; searched.value = false; try { const result = await window.opsApi.answerAiKnowledge({ query: knowledgeQuery.value, useAi: knowledgeUseAi.value, providerId: providerState.value.activeProviderId }); if (notify(result, '知识库问答失败')) { knowledgeResults.value = result.results || []; knowledgeAnswer.value = result.answer || ''; searched.value = true } } finally { busy.value = false } }

async function planWorkflow() { busy.value = true; try { const result = await window.opsApi.planAiWorkflow(workflowPrompt.value); if (notify(result, '生成工作流失败')) workflowPlan.value = result.plan } finally { busy.value = false } }
async function executeWorkflow() { if (!workflowPlan.value) return; if (workflowPlan.value.requiresConfirmation && !await confirm({ title: '确认执行工作流', content: '工作流将仅执行预览中列出的外部打开步骤；不会自动发布、删除或回滚。确认继续吗？', theme: 'warning' })) return; busy.value = true; try { const result = await window.opsApi.executeAiWorkflow({ plan: workflowPlan.value, confirmed: true }); if (notify(result, '执行工作流失败')) MessagePlugin.success({ content: `已处理 ${result.completed.length} 个工作流步骤`, placement: 'bottom-right' }) } finally { busy.value = false } }

watch(activeTab, tab => { if (tab === 'mcp' && !mcpInfo.value) loadState() })
onMounted(loadState)
</script>

<style scoped>
.ai-ops-page{position:relative;max-width:1560px;margin:0 auto;padding-bottom:42px}.page-header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:22px}.eyebrow{display:flex;align-items:center;gap:7px;color:#6366f1;font-size:11px;font-weight:800;letter-spacing:1.3px}.page-header h2{margin:7px 0 8px;font-size:28px;color:var(--text)}.page-header p{margin:0;color:var(--text-muted);line-height:1.6}.header-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}.safety-chip{border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;border-radius:99px;padding:8px 11px;font-size:12px;font-weight:600;white-space:nowrap}.tab-bar{display:flex;gap:8px;overflow:auto;padding-bottom:8px;margin-bottom:18px}.tab-btn{display:flex;align-items:center;gap:7px;border:1px solid var(--border);background:var(--card-bg);color:var(--text-muted);border-radius:10px;padding:9px 13px;white-space:nowrap;cursor:pointer;font-size:13px}.tab-btn:hover,.tab-btn.active{background:#eef2ff;border-color:#a5b4fc;color:#4338ca;font-weight:650}.panel-grid{display:grid;gap:18px}.providers-layout,.logs-layout,.knowledge-layout,.workflow-layout{grid-template-columns:minmax(0,1.05fr) minmax(360px,.95fr)}.stack{display:grid;gap:18px}.panel{background:var(--card-bg);border:1px solid var(--border-light);border-radius:16px;padding:22px;box-shadow:var(--shadow-xs)}.panel-title{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}.panel-title h3{margin:0 0 5px;font-size:17px;color:var(--text)}.panel-title p{margin:0;color:var(--text-muted);font-size:13px;line-height:1.55}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.form-grid label,.mcp-content label{display:grid;gap:7px;font-size:13px;color:var(--text-muted)}.form-grid .full{grid-column:1/-1}.form-grid span em{font-style:normal;font-size:11px;color:#94a3b8}.form-grid input,.form-grid textarea,.search-row input,.mcp-content input,.workflow-layout textarea{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:9px;background:#fff;color:var(--text);font:inherit;padding:10px 11px;outline:none}.form-grid textarea,.workflow-layout textarea{resize:vertical;line-height:1.55}.form-grid input:focus,.form-grid textarea:focus,.search-row input:focus,.workflow-layout textarea:focus{border-color:#818cf8;box-shadow:0 0 0 3px rgba(99,102,241,.12)}.check{display:flex!important;align-items:center;gap:8px!important;color:var(--text)!important;cursor:pointer}.align-end{align-self:end}.actions{display:flex;gap:10px;align-items:center;margin-top:18px}.btn-primary,.btn-secondary,.btn-text,.icon-btn{border:0;border-radius:9px;font:inherit;cursor:pointer;transition:.18s}.btn-primary{display:inline-flex;align-items:center;gap:7px;background:#4f46e5;color:#fff;padding:10px 14px;font-weight:650}.btn-primary:hover{background:#4338ca}.btn-secondary{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);background:#fff;color:var(--text);padding:9px 12px}.btn-text{background:transparent;color:#4f46e5;padding:7px 8px}.icon-btn{width:31px;height:31px;background:#f8fafc;border:1px solid var(--border);color:#64748b}.icon-btn.danger,.danger-text{color:#dc2626}.btn-primary:disabled,.btn-secondary:disabled,.icon-btn:disabled{opacity:.55;cursor:not-allowed}.provider-list-panel{display:flex;flex-direction:column;gap:11px}.provider-card{border:1px solid var(--border-light);border-radius:12px;padding:13px;display:flex;justify-content:space-between;gap:12px}.provider-card.selected{border-color:#818cf8;background:#f8faff}.provider-card-main{display:grid;gap:3px;min-width:0}.provider-card-main strong{color:var(--text)}.provider-card-main span{font-size:12px;color:#4f46e5}.provider-card-main small{color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px}.card-actions{display:flex;align-items:start;gap:3px;flex-wrap:wrap;justify-content:flex-end}.empty-mini{padding:24px 14px;border:1px dashed #cbd5e1;border-radius:11px;color:#64748b;text-align:center;font-size:13px;line-height:1.6}.compact{padding:15px;background:#f8fafc;border-radius:12px;border:1px solid var(--border-light)}.cases-table{display:grid;gap:8px;margin-top:16px}.table-row,.knowledge-doc{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--border-light)}.table-row:last-child,.knowledge-doc:last-child{border-bottom:0}.table-row strong,.knowledge-doc strong{color:var(--text)}.table-row p{margin:5px 0 7px;color:var(--text-muted);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:700px}.tag{display:inline-block;font-size:11px;padding:2px 6px;border-radius:6px;background:#eef2ff;color:#4338ca;margin-right:5px}.row-actions{display:flex;align-items:start;white-space:nowrap}.metric{text-align:right}.metric b{display:block;font-size:24px;color:#4f46e5}.metric span{font-size:12px;color:var(--text-muted)}.result-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:11px}.result-card{border-left:4px solid #16a34a;border-radius:9px;background:#f8fafc;padding:12px}.result-card.failed{border-left-color:#dc2626}.result-card>div{display:flex;justify-content:space-between;gap:8px}.result-card span{font-size:12px;color:var(--text-muted)}.result-card p{font-size:12px;color:#dc2626;margin:8px 0 0}.result-card details{margin-top:8px;font-size:12px}.result-card pre,.analysis-card pre,.answer-box pre,.search-result pre,.mcp-content pre{white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155}.analysis-card{border:1px solid var(--border-light);border-radius:12px;padding:14px;margin-bottom:11px}.analysis-head{display:flex;justify-content:space-between;gap:12px}.analysis-head p{margin:4px 0;color:var(--text-muted);font-size:12px}.analysis-card>p{font-size:13px}.analysis-card ul{padding-left:18px;margin:9px 0;color:#475569;font-size:13px}.analysis-card details{margin-top:8px;font-size:13px}.risk{font-size:11px;border-radius:99px;padding:4px 8px;height:max-content;font-weight:650}.risk.high{background:#fee2e2;color:#b91c1c}.risk.medium{background:#fef3c7;color:#a16207}.risk.low{background:#dcfce7;color:#15803d}.knowledge-list{max-height:290px;overflow:auto;margin-top:16px}.knowledge-doc p{margin:4px 0 0;color:var(--text-muted);font-size:12px}.search-row{display:flex;gap:9px;margin-bottom:12px}.search-row input{flex:1}.answer-btn{margin:12px 0}.answer-box{border:1px solid #c7d2fe;background:#f8faff;padding:13px;border-radius:10px}.answer-box strong{color:#4338ca}.search-results{margin-top:14px;display:grid;gap:10px}.search-result{border:1px solid var(--border-light);border-radius:10px;padding:12px}.search-result span{display:block;color:var(--text-muted);font-size:12px;margin-top:4px}.search-result pre{margin:9px 0 0}.workflow-request{background:#f8fafc;border-left:3px solid #6366f1;padding:10px 12px;border-radius:6px;color:#475569}.workflow-plan ol{list-style:none;padding:0;margin:16px 0}.workflow-plan li{display:flex;gap:11px;padding:12px 0;border-bottom:1px solid var(--border-light)}.step-risk{font-size:10px;font-weight:700;border-radius:99px;padding:4px 7px;height:max-content;background:#dcfce7;color:#15803d}.step-risk.medium{background:#fef3c7;color:#a16207}.workflow-plan li p{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#64748b;margin:5px 0 0;word-break:break-all}.workflow-plan li small{color:#b45309}.mcp-panel{max-width:860px}.mcp-content{display:grid;gap:14px}.mcp-content p{margin:0;color:#475569;line-height:1.6}.mcp-content code{font-size:12px}.mcp-badge{display:flex;gap:7px;align-items:center;color:#15803d;font-weight:700}.mcp-content pre{padding:14px;background:#0f172a;color:#e2e8f0;border-radius:10px;overflow:auto}.loading-overlay{position:absolute;inset:0;min-height:220px;background:rgba(255,255,255,.68);backdrop-filter:blur(2px);display:flex;gap:9px;align-items:center;justify-content:center;color:#4f46e5;font-weight:600;z-index:5}@media(max-width:980px){.providers-layout,.logs-layout,.knowledge-layout,.workflow-layout{grid-template-columns:1fr}.page-header{flex-direction:column}.header-actions{justify-content:flex-start}.form-grid{grid-template-columns:1fr}.provider-card-main small{max-width:210px}}@media(max-width:600px){.panel{padding:16px}.page-header h2{font-size:23px}.card-actions{flex-direction:row}.provider-card{flex-direction:column}.table-row{flex-direction:column}.row-actions{justify-content:flex-end}.search-row{flex-direction:column}}
</style>
