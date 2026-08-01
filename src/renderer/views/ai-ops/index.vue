<template>
  <div class="page ai-ops-page">
    <header class="page-header">
      <div class="page-heading">
        <div class="page-eyebrow"><t-icon name="gesture-pray" /> AI CAPABILITY CENTER</div>
        <h2 class="page-title">AI 能力中心</h2>
        <p class="page-desc">统一管理 Provider、模型评测、脱敏日志、知识库与需要确认的安全工作流。</p>
      </div>
      <div class="page-actions header-actions">
        <span class="safety-chip"><t-icon name="secured" /> 凭证不出主进程 · 执行需确认</span>
        <button class="btn-secondary refresh-btn" type="button" :disabled="loading || refreshing" @click="loadState">
          <t-icon name="refresh" :class="{ spinning: refreshing }" />
          {{ refreshing ? '刷新中' : '刷新' }}
        </button>
      </div>
    </header>

    <main class="page-content">
      <div class="tab-bar" role="tablist" aria-label="AI 能力功能">
      <button
        v-for="tab in tabs"
        :id="`ai-ops-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        :class="['tab-btn', { active: activeTab === tab.id }]"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`ai-ops-panel-${tab.id}`"
        :tabindex="activeTab === tab.id ? 0 : -1"
        @click="selectTab(tab.id)"
        @keydown="handleTabKeydown($event, tab.id)"
      >
        <t-icon :name="tab.icon" />
        <span>{{ tab.name }}</span>
      </button>
    </div>

      <section
        :id="`ai-ops-panel-${activeTab}`"
      class="tab-panel"
      role="tabpanel"
      :aria-labelledby="`ai-ops-tab-${activeTab}`"
      tabindex="-1"
    >
      <section v-if="activeTab === 'providers'" class="panel-grid providers-layout">
        <article class="panel form-panel provider-source-panel">
          <div class="panel-title">
            <div>
              <h3>从模型可靠性一键配置</h3>
              <p>AI Provider 统一从“模型可靠性”读取；仅显示最近一次模型测试通过的模型。接口地址和密钥始终使用最新配置。</p>
            </div>
            <button class="btn-secondary" type="button" @click="openModelReliability"><t-icon name="jump" /> 前往模型可靠性</button>
          </div>
          <div class="source-notice"><t-icon name="secured" /> 仅可选择最近一次模型测试通过的模型；支持 OpenAI Chat / Responses、Anthropic Messages 与 Gemini generateContent。</div>
          <div v-if="sourceError" class="source-empty" role="status">
            <t-icon name="error-circle" />
            <span>{{ sourceError }}</span>
            <button class="btn-text" type="button" :disabled="sourceLoading" @click="loadProviderSources">重新读取</button>
          </div>
          <template v-else-if="providerSources.length">
            <div class="form-grid">
              <label class="full">
                <span>Provider</span>
                <select v-model="sourceSelection.sourceKey" :disabled="sourceLoading || savingProvider">
                  <option value="">请选择模型可靠性 Provider</option>
                  <option v-for="source in providerSources" :key="sourceKey(source)" :value="sourceKey(source)">{{ source.name }} · {{ source.protocolLabel }}</option>
                </select>
              </label>
              <label class="full">
                <span>已测试通过的模型</span>
                <select v-model="sourceSelection.model" :disabled="!selectedProviderSource || savingProvider">
                  <option value="">请选择测试通过的模型</option>
                  <option v-for="model in selectedProviderModels" :key="model.model" :value="model.model">{{ model.label }}</option>
                </select>
              </label>
            </div>
            <p v-if="selectedProviderSource" class="source-meta"><t-icon name="server" /> {{ selectedProviderSource.baseUrl }} <span>·</span> 密钥仅在主进程从模型可靠性读取</p>
            <div class="actions">
              <button class="btn-primary" type="button" :disabled="savingProvider || !selectedProviderSource || !sourceSelection.model" @click="addModelReliabilityProvider">
                <t-icon :name="savingProvider ? 'loading' : 'add'" :class="{ spinning: savingProvider }" />
                {{ savingProvider ? '配置中' : '一键配置并设为默认' }}
              </button>
              <button class="btn-text" type="button" :disabled="sourceLoading" @click="loadProviderSources">刷新来源</button>
            </div>
          </template>
          <div v-else class="source-empty">
            <t-icon name="server" />
            <span>未找到测试通过的可接入模型。请先在模型可靠性完成模型测试，并确认最近一次测试通过。</span>
            <button class="btn-text" type="button" @click="openModelReliability">去配置</button>
          </div>
        </article>

        <article class="panel provider-list-panel">
          <div class="panel-title">
            <div>
              <h3>已配置 Provider</h3>
              <p>{{ providers.length ? `当前默认：${activeProvider?.name || '未选择'}` : '尚未配置 Provider' }}</p>
            </div>
            <span v-if="providers.length" class="count-badge">{{ providers.length }}</span>
          </div>
          <div v-if="!providers.length" class="empty-mini">请先从左侧的模型可靠性来源一键添加 Provider。</div>
          <div v-for="provider in providers" :key="provider.id" :class="['provider-card', { selected: provider.id === providerState.activeProviderId }]">
            <div class="provider-card-main">
              <div class="provider-name-row">
                <strong>{{ provider.name }}</strong>
                <span v-if="provider.id === providerState.activeProviderId" class="status-badge primary">默认 Provider</span>
                <span class="status-badge primary">模型可靠性来源</span>
                <span v-if="provider.protocolLabel" class="status-badge muted">{{ provider.protocolLabel }}</span>
                <span :class="['status-badge', provider.available ? 'success' : 'muted']">{{ provider.available ? '可用' : '需检查' }}</span>
              </div>
              <span class="provider-model">{{ provider.model }}</span>
              <div class="provider-url-row">
                <small :title="provider.baseUrl">{{ provider.baseUrl }}</small>
                <button class="icon-btn copy-btn" type="button" title="复制接口地址" aria-label="复制接口地址" @click="copyText(provider.baseUrl, '接口地址已复制')"><t-icon name="file-copy" /></button>
              </div>
              <small v-if="provider.available" class="key-status"><t-icon name="secured" /> 密钥由模型可靠性托管（{{ provider.apiKeyMasked }}）</small>
              <small v-else class="danger-text">{{ provider.issue || '来源当前不可用' }}</small>
            </div>
            <div class="card-actions">
              <span v-if="provider.id === providerState.activeProviderId" class="default-label">默认</span>
              <button v-else class="btn-text" type="button" :disabled="activatingProviderId === provider.id || !provider.available" @click="activateProvider(provider.id)">
                {{ activatingProviderId === provider.id ? '设置中' : '设为默认' }}
              </button>
              <button class="icon-btn" type="button" title="连接测试" aria-label="连接测试" :disabled="testingProviderId === provider.id || !provider.available" @click="testProvider(provider.id)">
                <t-icon :name="testingProviderId === provider.id ? 'loading' : 'check-circle'" :class="{ spinning: testingProviderId === provider.id }" />
              </button>
              <button class="icon-btn" type="button" title="前往模型可靠性" aria-label="前往模型可靠性" @click="openModelReliability"><t-icon name="jump" /></button>
              <button class="icon-btn danger" type="button" title="从 AI 功能中移除" aria-label="从 AI 功能中移除" @click="removeProvider(provider)"><t-icon name="delete" /></button>
            </div>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'evaluation'" class="stack">
        <article class="panel">
          <div class="panel-title">
            <div>
              <h3>模型语义评测</h3>
              <p>除了连通性，验证关键字、JSON 输出和平均响应时间。评测回答会脱敏后保存在本机。</p>
            </div>
            <button class="btn-primary" type="button" :disabled="busy || !evaluationCases.length || !activeProviderReady" @click="runEvaluation"><t-icon name="play-circle" /> 运行评测</button>
          </div>
          <p v-if="!activeProviderReady" class="inline-hint evaluation-hint"><t-icon name="info-circle" /> 配置已启用且包含密钥的默认 Provider 后，才可运行评测。</p>
          <div v-if="caseForm.id" class="form-context">
            <span class="context-dot"></span>
            正在编辑 <strong>{{ caseForm.name || '未命名评测用例' }}</strong>
            <button class="btn-text" type="button" @click="resetCaseForm">取消编辑</button>
          </div>
          <div class="case-form form-grid compact">
            <label><span>用例名称</span><input v-model="caseForm.name" placeholder="例如：JSON 结构化输出" /></label>
            <label><span>期望关键词 <em>逗号分隔，可选</em></span><input v-model="caseForm.expectedKeywords" placeholder="status, result" /></label>
            <label class="full"><span>提示词</span><textarea v-model="caseForm.prompt" rows="3" placeholder="输入希望模型完成的任务"></textarea></label>
            <label class="full"><span>系统提示词 <em>可选</em></span><input v-model="caseForm.systemPrompt" placeholder="例如：仅返回 JSON 对象" /></label>
            <label class="check"><input v-model="caseForm.expectJson" type="checkbox" /> 要求合法 JSON 对象</label>
            <div class="actions"><button class="btn-secondary" type="button" @click="upsertCase"><t-icon name="add" /> {{ caseForm.id ? '更新用例' : '加入用例' }}</button><button v-if="caseForm.id" class="btn-text" type="button" @click="resetCaseForm">取消编辑</button></div>
          </div>
          <div v-if="!evaluationCases.length" class="empty-mini">尚无评测用例。可先添加“关键词判断”或“JSON 输出”用例。</div>
          <div v-else class="data-table cases-table">
            <div v-for="item in evaluationCases" :key="item.id" class="table-row">
              <div>
                <strong>{{ item.name }}</strong>
                <p>{{ item.prompt }}</p>
                <span v-if="item.expectedKeywords?.length" class="tag">关键词：{{ item.expectedKeywords.join('、') }}</span>
                <span v-if="item.expectJson" class="tag">JSON</span>
              </div>
              <div class="row-actions"><button class="btn-text" type="button" @click="editCase(item)">编辑</button><button class="btn-text danger-text" type="button" @click="removeCase(item.id)">删除</button></div>
            </div>
          </div>
        </article>

        <article v-if="latestEvaluation" class="panel">
          <div class="panel-title evaluation-title">
            <div>
              <h3>最近一次评测结果</h3>
              <p>{{ formatTime(latestEvaluation.finishedAt) }} · {{ latestEvaluation.providerName }} / {{ latestEvaluation.model }}</p>
            </div>
            <div class="metric"><b>{{ latestEvaluation.summary.passed }}/{{ latestEvaluation.summary.total }}</b><span>通过</span></div>
          </div>
          <div class="evaluation-summary">
            <div><span>通过率</span><strong>{{ evaluationPassRate }}%</strong></div>
            <div><span>失败项</span><strong class="danger-value">{{ evaluationFailedCount }}</strong></div>
            <div><span>平均耗时</span><strong>{{ evaluationAverageDuration }}ms</strong></div>
          </div>
          <div class="result-filters" role="group" aria-label="评测结果筛选">
            <button v-for="filter in evaluationFilters" :key="filter.id" type="button" :class="['filter-btn', { active: evaluationFilter === filter.id }]" @click="evaluationFilter = filter.id">{{ filter.label }}<span>{{ filter.count }}</span></button>
          </div>
          <div class="result-grid">
            <div v-for="item in filteredEvaluationResults" :key="item.id" :class="['result-card', item.ok ? 'ok' : 'failed']">
              <div><strong>{{ item.name }}</strong><span>{{ item.ok ? '通过' : '未通过' }} · {{ item.durationMs }}ms</span></div>
              <p v-if="item.error">{{ item.error }}</p>
              <p v-else-if="!item.ok">{{ item.expectJson && !item.jsonOk ? '返回内容不是 JSON 对象。' : '未命中所有期望关键词。' }}</p>
              <details v-if="item.answer"><summary>查看脱敏回答</summary><pre>{{ item.answer }}</pre></details>
            </div>
          </div>
          <div v-if="!filteredEvaluationResults.length" class="empty-mini">当前筛选条件下没有评测结果。</div>
        </article>
      </section>

      <section v-else-if="activeTab === 'logs'" class="panel-grid logs-layout">
        <article class="panel form-panel">
          <div class="panel-title"><div><h3>AI 日志分析</h3><p>日志在发给模型前会先进行密钥、Token、密码与私钥脱敏；也可只做本地规则分析。</p></div></div>
          <div class="form-grid">
            <label><span>日志标题</span><input v-model="logForm.title" placeholder="例如：正式环境发布失败 2026-07-31" /></label>
            <label class="check align-end"><input v-model="logForm.useAi" type="checkbox" :disabled="!activeProviderReady" /> 使用当前 AI Provider 生成总结</label>
            <p v-if="!activeProviderReady" class="inline-hint full"><t-icon name="info-circle" /> 暂无可用 Provider；当前可使用本地规则分析。请先在 Provider 页配置、启用并设为默认。</p>
            <label class="full"><span>日志内容</span><textarea v-model="logForm.text" rows="12" maxlength="200000" placeholder="粘贴 Nginx、应用、发布或模型测试日志"></textarea><small class="field-meta">{{ logLineCount }} 行 · {{ logForm.text.length.toLocaleString() }} / 200,000 字符</small></label>
          </div>
          <div class="actions"><button class="btn-primary" type="button" :disabled="busy || !logForm.text.trim()" @click="analyzeLog"><t-icon name="search" /> 分析日志</button></div>
        </article>
        <article class="panel"><div class="panel-title"><div><h3>分析记录</h3><p>仅保留脱敏后的统计、节选和 AI 总结。</p></div><span v-if="logs.length" class="count-badge">最近 {{ Math.min(logs.length, 8) }} 条</span></div><div v-if="!logs.length" class="empty-mini">暂无日志分析记录。</div><div v-for="item in logs.slice(0, 8)" :key="item.id" class="analysis-card"><div class="analysis-head"><div><strong>{{ item.title }}</strong><p>{{ formatTime(item.createdAt) }} · {{ item.lineCount }} 行</p></div><span :class="['risk', item.level]">{{ riskLabel(item.level) }}</span></div><p>{{ item.headline }}</p><ul><li v-for="finding in item.findings" :key="finding.type">{{ finding.type }}：{{ finding.count }} 条</li></ul><details v-if="item.aiSummary"><summary>AI 分析结论</summary><pre>{{ item.aiSummary }}</pre></details><details><summary>查看脱敏日志节选</summary><pre>{{ item.excerpt }}</pre></details></div></article>
      </section>

      <section v-else-if="activeTab === 'knowledge'" class="panel-grid knowledge-layout">
        <article class="panel form-panel"><div class="panel-title"><div><h3>本地运维知识库</h3><p>可保存发布规范、故障复盘、服务器说明和排障手册；检索结果显示具体行号。</p></div></div><div class="form-grid"><label><span>标题</span><input v-model="knowledgeForm.title" placeholder="例如：正式环境发布 SOP" /></label><label><span>标签</span><input v-model="knowledgeForm.tags" placeholder="发布, 正式环境, 回滚" /></label><label class="full"><span>内容</span><textarea v-model="knowledgeForm.content" rows="13" maxlength="200000" placeholder="粘贴本地文档内容。保存前会脱敏。"></textarea></label></div><div class="actions"><button class="btn-primary" type="button" :disabled="busy || !knowledgeForm.content.trim()" @click="saveKnowledge"><t-icon name="save" /> 保存到知识库</button><button class="btn-secondary" type="button" :disabled="busy" @click="importKnowledge"><t-icon name="upload" /> 导入本地文档</button></div><div class="knowledge-list"><div v-for="doc in knowledgeDocuments" :key="doc.id" class="knowledge-doc"><div><strong>{{ doc.title }}</strong><p>{{ doc.tags?.join(' · ') || '无标签' }} · {{ doc.source?.type === 'file' ? `来源：${doc.source.name}` : '手动录入' }} · {{ formatTime(doc.updatedAt) }}</p></div><button class="btn-text danger-text" type="button" @click="removeKnowledge(doc.id)">删除</button></div><div v-if="!knowledgeDocuments.length" class="empty-mini">暂无知识文档，保存内容后可在右侧检索。</div></div></article>
        <article class="panel search-panel"><div class="panel-title"><div><h3>检索与问答</h3><p>默认仅返回本地证据片段；开启 AI 后会要求答案标注来源编号。</p></div></div><div class="search-row"><input v-model="knowledgeQuery" placeholder="例如：正式环境如何回滚？" @keyup.enter="searchKnowledge" /><button class="btn-secondary" type="button" :disabled="busy" @click="searchKnowledge"><t-icon name="search" /> 检索</button></div><label class="check"><input v-model="knowledgeUseAi" type="checkbox" :disabled="!activeProviderReady" /> 使用当前 AI Provider 基于检索结果回答</label><p v-if="!activeProviderReady" class="inline-hint"><t-icon name="info-circle" /> 配置已启用且包含密钥的默认 Provider 后可生成 AI 回答。</p><button class="btn-primary answer-btn" type="button" :disabled="busy || !knowledgeQuery.trim()" @click="answerKnowledge"><t-icon name="chat" /> 生成带引用的回答</button><div v-if="knowledgeAnswer" class="answer-box"><strong>回答</strong><pre>{{ knowledgeAnswer }}</pre></div><div v-if="knowledgeResults.length" class="search-results"><div v-for="(item, index) in knowledgeResults" :key="`${item.documentId}-${item.startLine}`" class="search-result"><strong>[{{ index + 1 }}] {{ item.title }}</strong><span>第 {{ item.startLine }}–{{ item.endLine }} 行 · 匹配 {{ item.score }}</span><pre>{{ item.content }}</pre></div></div><div v-else-if="searched" class="empty-mini">没有检索到匹配知识。</div></article>
      </section>

      <section v-else-if="activeTab === 'workflow'" class="panel-grid workflow-layout">
        <article class="panel form-panel">
          <div class="panel-title"><div><h3>自然语言运维工作流</h3><p>AI 工作流只生成安全预览：页面步骤由你主动前往；外部打开必须确认；不会自动发布、删除或回滚。</p></div></div>
          <textarea v-model="workflowPrompt" rows="8" placeholder="例如：打开测试环境后台、进入发布页面并查看模型评测"></textarea>
          <div class="actions"><button class="btn-primary" type="button" :disabled="busy || !workflowPrompt.trim()" @click="planWorkflow"><t-icon name="gesture-pray" /> 生成预览</button></div>
        </article>
        <article class="panel">
          <div class="panel-title"><div><h3>执行预览</h3><p>{{ workflowPlan ? workflowPlan.summary || '请核对每一步，再决定是否执行。' : '尚未生成工作流。' }}</p></div></div>
          <div v-if="workflowPlan" class="workflow-plan">
            <div class="workflow-request">{{ workflowPlan.prompt }}</div>
            <ol>
              <li v-for="step in workflowPlan.steps" :key="step.id || `${step.type}-${step.label}`">
                <span class="step-icon"><t-icon :name="workflowStepIcon(step)" /></span>
                <span :class="['step-risk', step.risk]">{{ step.risk === 'medium' ? '需注意' : '低风险' }}</span>
                <div><strong>{{ step.description || step.label }}</strong><p v-if="step.target">{{ step.target }}</p><small v-if="step.requiresConfirmation">此步需要确认后才会执行。</small></div>
                <button v-if="step.type === 'navigate'" class="btn-text" type="button" @click="navigateWorkflowStep(step)">前往</button>
              </li>
            </ol>
            <div v-if="workflowExecution" class="workflow-complete"><t-icon name="check-circle" /> 已打开 {{ workflowExecution.opened }} 个外部链接；{{ workflowExecution.navigation }} 个页面步骤需点击“前往”。未执行发布、删除或回滚操作。</div>
            <button v-if="workflowExternalSteps.length" class="btn-primary" type="button" :disabled="busy" @click="executeWorkflow"><t-icon name="play-circle" /> 确认打开 {{ workflowExternalSteps.length }} 个外部链接</button>
            <p v-else class="inline-hint"><t-icon name="info-circle" /> 此计划没有外部打开步骤，请按需点击每个页面步骤的“前往”。</p>
          </div>
          <div v-else class="empty-mini">支持“打开网站”“进入发布”“模型测试”“日志排查”等关键词；发布操作只会导航到页面，不会自动执行。</div>
          <div v-if="workflowState.history?.length" class="workflow-history"><strong>最近计划</strong><button v-for="item in workflowState.history.slice(0, 5)" :key="item.id" class="btn-text" type="button" @click="restoreWorkflow(item)">{{ item.prompt }}</button></div>
        </article>
      </section>

      <section v-else-if="activeTab === 'mcp'" class="panel mcp-panel"><div class="panel-title"><div><h3>MCP 本地只读服务</h3><p>供 Codex、Claude Desktop 等客户端访问本机发布历史、模型健康度和运维知识库。不会暴露密钥，也不提供发布写操作。</p></div></div><div v-if="mcpInfo" class="mcp-content"><div class="mcp-badge"><t-icon name="secured" /> stdio · 只读</div><p>可用工具：<code>{{ mcpInfo.tools.join(' · ') }}</code></p><p>{{ mcpInfo.note }}</p><label><span>启动命令</span><input :value="mcpInfo.command" readonly @focus="$event.target.select()" /></label><label><span>启动参数</span><input :value="mcpInfo.args.join(' ')" readonly @focus="$event.target.select()" /></label><pre>{{ mcpConfigExample }}</pre></div><div v-else class="empty-mini">正在读取 MCP 配置…</div></section>
      </section>
    </main>

    <div v-if="loading" class="loading-overlay"><t-icon name="loading" class="spinning" /> 正在加载 AI 运维数据…</div>
  </div>
</template>

<script setup>
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useConfirm } from '../../composables/useConfirm'

const { confirm } = useConfirm()
const route = useRoute()
const router = useRouter()
const tabs = [
  { id: 'providers', name: 'Provider', icon: 'server' },
  { id: 'evaluation', name: '模型评测', icon: 'chart-bar' },
  { id: 'logs', name: '日志分析', icon: 'search' },
  { id: 'knowledge', name: '知识库', icon: 'folder-open' },
  { id: 'workflow', name: '智能工作流', icon: 'rocket' },
  { id: 'mcp', name: 'MCP', icon: 'api' },
]

const activeTab = ref(tabs.some(tab => tab.id === route.query.tab) ? route.query.tab : 'providers')
const loading = ref(true)
const refreshing = ref(false)
const hasLoaded = ref(false)
const busy = ref(false)
const savingProvider = ref(false)
const sourceLoading = ref(false)
const sourceError = ref('')
const testingProviderId = ref('')
const activatingProviderId = ref('')
const providerState = ref({ activeProviderId: '', providers: [] })
const evaluationState = ref({ cases: [], runs: [] })
const logState = ref({ items: [] })
const knowledgeState = ref({ documents: [] })
const workflowState = ref({ history: [] })
const mcpInfo = ref(null)

const newCase = () => ({ id: '', name: '', prompt: '', systemPrompt: '', expectedKeywords: '', expectJson: false })
const providerSources = ref([])
const sourceSelection = ref({ sourceKey: '', model: '' })
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
const workflowExecution = ref(null)
const evaluationFilter = ref('all')

const providers = computed(() => providerState.value.providers || [])
const activeProvider = computed(() => providers.value.find(item => item.id === providerState.value.activeProviderId))
const activeProviderReady = computed(() => Boolean(activeProvider.value?.enabled && activeProvider.value?.available && activeProvider.value?.hasApiKey))
const sourceKey = source => `${source.appType}::${source.id}`
const selectedProviderSource = computed(() => providerSources.value.find(source => sourceKey(source) === sourceSelection.value.sourceKey) || null)
const selectedProviderModels = computed(() => selectedProviderSource.value?.models || [])
const evaluationCases = computed(() => evaluationState.value.cases || [])
const latestEvaluation = computed(() => evaluationState.value.runs?.[0] || null)
const logs = computed(() => logState.value.items || [])
const knowledgeDocuments = computed(() => knowledgeState.value.documents || [])
const mcpConfigExample = computed(() => mcpInfo.value ? JSON.stringify({ mcpServers: { 'ops-desktop': { command: mcpInfo.value.command, args: mcpInfo.value.args } } }, null, 2) : '')
const evaluationResults = computed(() => latestEvaluation.value?.results || [])
const evaluationFailedCount = computed(() => evaluationResults.value.filter(item => !item.ok).length)
const evaluationPassRate = computed(() => {
  const total = latestEvaluation.value?.summary?.total || 0
  return total ? Math.round(((latestEvaluation.value?.summary?.passed || 0) / total) * 100) : 0
})
const evaluationAverageDuration = computed(() => {
  if (!evaluationResults.value.length) return 0
  return Math.round(evaluationResults.value.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0) / evaluationResults.value.length)
})
const evaluationFilters = computed(() => [
  { id: 'all', label: '全部', count: evaluationResults.value.length },
  { id: 'failed', label: '未通过', count: evaluationFailedCount.value },
  { id: 'json', label: 'JSON 异常', count: evaluationResults.value.filter(item => item.expectJson && !item.jsonOk).length },
  { id: 'keyword', label: '关键词未命中', count: evaluationResults.value.filter(item => !item.ok && !item.error && (!item.expectJson || item.jsonOk)).length },
])
const filteredEvaluationResults = computed(() => {
  if (evaluationFilter.value === 'failed') return evaluationResults.value.filter(item => !item.ok)
  if (evaluationFilter.value === 'json') return evaluationResults.value.filter(item => item.expectJson && !item.jsonOk)
  if (evaluationFilter.value === 'keyword') return evaluationResults.value.filter(item => !item.ok && !item.error && (!item.expectJson || item.jsonOk))
  return evaluationResults.value
})
const logLineCount = computed(() => logForm.value.text ? logForm.value.text.split(/\r?\n/).length : 0)
const workflowExternalSteps = computed(() => (workflowPlan.value?.steps || []).filter(step => step.type === 'open-url'))

function notify(result, fallback = '操作失败') {
  if (result?.ok) return true
  MessagePlugin.error({ content: result?.error || fallback, placement: 'bottom-right' })
  return false
}

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function riskLabel(level) {
  return ({ high: '高风险', medium: '需关注', low: '低风险' })[level] || '未知'
}

function selectTab(tabId) {
  activeTab.value = tabId
  if (route.query.tab !== tabId) router.replace({ query: { ...route.query, tab: tabId } })
}

function handleTabKeydown(event, tabId) {
  const currentIndex = tabs.findIndex(tab => tab.id === tabId)
  let nextIndex = currentIndex
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = tabs.length - 1
  else return

  event.preventDefault()
  const nextTab = tabs[nextIndex]
  selectTab(nextTab.id)
  requestAnimationFrame(() => document.getElementById(`ai-ops-tab-${nextTab.id}`)?.focus())
}

async function copyText(value, successMessage) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    MessagePlugin.success({ content: successMessage, placement: 'bottom-right' })
  } catch {
    MessagePlugin.error({ content: '复制失败，请手动选择内容', placement: 'bottom-right' })
  }
}

function workflowStepIcon(step) {
  if (/打开|网站|链接|浏览器/.test(`${step.type || ''} ${step.label || ''}`)) return 'link'
  if (/发布|模型|日志|知识库|页面/.test(`${step.type || ''} ${step.label || ''}`)) return 'jump'
  return 'check-circle'
}

async function loadState() {
  const initialLoad = !hasLoaded.value
  if (initialLoad) loading.value = true
  else refreshing.value = true

  try {
    const result = await window.opsApi.getAiOpsState()
    if (!notify(result, '读取 AI 运维数据失败')) return
    providerState.value = result.providers || providerState.value
    evaluationState.value = result.evaluations || evaluationState.value
    logState.value = result.logs || logState.value
    knowledgeState.value = result.knowledge || knowledgeState.value
    workflowState.value = result.workflows || workflowState.value
    await loadProviderSources()
    const info = await window.opsApi.getAiMcpInfo()
    if (info?.ok) mcpInfo.value = info
    hasLoaded.value = true
  } catch (error) {
    MessagePlugin.error({ content: error.message || '读取 AI 运维数据失败', placement: 'bottom-right' })
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function loadProviderSources() {
  sourceLoading.value = true
  sourceError.value = ''
  try {
    const result = await window.opsApi.listAiProviderSources()
    if (!result?.ok) {
      sourceError.value = result?.error || '读取模型可靠性 Provider 失败'
      return
    }
    providerSources.value = result.sources || []
    const selectedSource = providerSources.value.find(source => sourceKey(source) === sourceSelection.value.sourceKey)
    if (!selectedSource) {
      sourceSelection.value = { sourceKey: '', model: '' }
    } else if (!selectedSource.models.some(model => model.model === sourceSelection.value.model)) {
      sourceSelection.value.model = ''
    }
  } catch (error) {
    sourceError.value = error?.message || '读取模型可靠性 Provider 失败'
  } finally {
    sourceLoading.value = false
  }
}

function openModelReliability() {
  router.push('/model-test')
}

async function addModelReliabilityProvider() {
  const source = selectedProviderSource.value
  const model = sourceSelection.value.model
  if (!source || !model) return
  savingProvider.value = true
  try {
    const result = await window.opsApi.addAiProviderFromModelReliability({
      sourceProviderId: source.id,
      sourceAppType: source.appType,
      model,
    })
    if (!notify(result, '一键配置 Provider 失败')) return
    await loadState()
    MessagePlugin.success({ content: '已从模型可靠性一键配置并设为默认 Provider', placement: 'bottom-right' })
  } finally {
    savingProvider.value = false
  }
}

async function activateProvider(id) {
  activatingProviderId.value = id
  try {
    const result = await window.opsApi.activateAiProvider(id)
    if (notify(result)) {
      providerState.value = result.providers
      MessagePlugin.success({ content: '已切换默认 Provider', placement: 'bottom-right' })
    }
  } finally {
    activatingProviderId.value = ''
  }
}

async function testProvider(id) {
  testingProviderId.value = id
  try {
    const result = await window.opsApi.testAiProvider(id)
    if (notify(result, '连接测试失败')) MessagePlugin.success({ content: `连接正常：${result.content}`, placement: 'bottom-right', duration: 5000 })
  } finally {
    testingProviderId.value = ''
  }
}

async function removeProvider(provider) {
  if (!await confirm({ title: '从 AI 功能中移除 Provider', content: `确定移除“${provider.name} · ${provider.model}”吗？不会删除模型可靠性中的原始 Provider。`, theme: 'warning' })) return
  busy.value = true
  try {
    const result = await window.opsApi.deleteAiProvider(provider.id)
    if (notify(result)) {
      providerState.value = result.providers
      MessagePlugin.success({ content: '已从 AI 功能中移除 Provider', placement: 'bottom-right' })
    }
  } finally {
    busy.value = false
  }
}

function resetCaseForm() {
  caseForm.value = newCase()
}

function editCase(item) {
  caseForm.value = { ...newCase(), ...item, expectedKeywords: (item.expectedKeywords || []).join(', ') }
}

async function persistCases(next) {
  const result = await window.opsApi.saveAiEvaluationCases(next)
  if (notify(result, '保存评测用例失败')) evaluationState.value = { ...evaluationState.value, cases: result.cases }
  return result?.ok
}

async function upsertCase() {
  try {
    const form = caseForm.value
    if (!form.prompt.trim()) throw new Error('请输入提示词')
    const item = { ...form, expectedKeywords: form.expectedKeywords }
    const index = evaluationCases.value.findIndex(row => row.id === item.id)
    const next = [...evaluationCases.value]
    if (index >= 0) next[index] = item
    else next.push(item)
    if (await persistCases(next)) {
      resetCaseForm()
      MessagePlugin.success({ content: '评测用例已保存', placement: 'bottom-right' })
    }
  } catch (error) {
    MessagePlugin.error({ content: error.message || '保存评测用例失败', placement: 'bottom-right' })
  }
}

async function removeCase(id) {
  if (await persistCases(evaluationCases.value.filter(item => item.id !== id))) resetCaseForm()
}

async function runEvaluation() {
  busy.value = true
  try {
    const result = await window.opsApi.runAiEvaluation({ providerId: providerState.value.activeProviderId })
    if (notify(result, '运行评测失败')) {
      evaluationState.value = { ...evaluationState.value, runs: [result.run, ...(evaluationState.value.runs || [])] }
      evaluationFilter.value = 'all'
      MessagePlugin.success({ content: `评测完成：${result.run.summary.passed}/${result.run.summary.total} 通过`, placement: 'bottom-right' })
    }
  } finally {
    busy.value = false
  }
}

async function analyzeLog() {
  busy.value = true
  try {
    const result = await window.opsApi.analyzeAiLog({ ...logForm.value, providerId: providerState.value.activeProviderId })
    if (notify(result, '日志分析失败')) {
      logState.value = { ...logState.value, items: [result.item, ...logs.value] }
      logForm.value = { title: '', text: '', useAi: logForm.value.useAi }
      MessagePlugin.success({ content: '日志已脱敏分析并保存', placement: 'bottom-right' })
    }
  } finally {
    busy.value = false
  }
}

async function saveKnowledge() {
  busy.value = true
  try {
    const result = await window.opsApi.saveAiKnowledge({ ...knowledgeForm.value, tags: knowledgeForm.value.tags })
    if (notify(result, '保存知识失败')) {
      knowledgeState.value = { ...knowledgeState.value, documents: [result.document, ...knowledgeDocuments.value.filter(item => item.id !== result.document.id)] }
      knowledgeForm.value = { title: '', tags: '', content: '' }
      MessagePlugin.success({ content: '知识文档已脱敏保存', placement: 'bottom-right' })
    }
  } finally {
    busy.value = false
  }
}

async function importKnowledge() {
  busy.value = true
  try {
    const filePath = await window.opsApi.browseFile({
      filters: [
        { name: '支持的知识文档', extensions: ['md', 'txt', 'log', 'json', 'yml', 'yaml', 'conf'] },
      ],
    })
    if (!filePath) return
    const result = await window.opsApi.importAiKnowledge(filePath)
    if (notify(result, '导入知识文档失败')) {
      knowledgeState.value = { ...knowledgeState.value, documents: [result.document, ...knowledgeDocuments.value] }
      MessagePlugin.success({ content: '文档已脱敏导入，回答时会展示来源与行号', placement: 'bottom-right' })
    }
  } finally {
    busy.value = false
  }
}

async function removeKnowledge(id) {
  if (!await confirm({ title: '删除知识文档', content: '确定删除该本地知识文档吗？', theme: 'warning' })) return
  const result = await window.opsApi.deleteAiKnowledge(id)
  if (notify(result)) knowledgeState.value = { ...knowledgeState.value, documents: result.documents }
}

async function searchKnowledge() {
  if (!knowledgeQuery.value.trim()) return
  busy.value = true
  searched.value = false
  try {
    const result = await window.opsApi.searchAiKnowledge(knowledgeQuery.value)
    if (notify(result, '检索失败')) {
      knowledgeResults.value = result.results || []
      knowledgeAnswer.value = ''
      searched.value = true
    }
  } finally {
    busy.value = false
  }
}

async function answerKnowledge() {
  if (!knowledgeQuery.value.trim()) return
  busy.value = true
  searched.value = false
  try {
    const result = await window.opsApi.answerAiKnowledge({ query: knowledgeQuery.value, useAi: knowledgeUseAi.value, providerId: providerState.value.activeProviderId })
    if (notify(result, '知识库问答失败')) {
      knowledgeResults.value = result.results || []
      knowledgeAnswer.value = result.answer || ''
      searched.value = true
    }
  } finally {
    busy.value = false
  }
}

async function planWorkflow() {
  busy.value = true
  workflowExecution.value = null
  try {
    const result = await window.opsApi.planAiWorkflow(workflowPrompt.value)
    if (notify(result, '生成工作流失败')) {
      workflowPlan.value = result.plan
      workflowState.value = { ...workflowState.value, history: [result.plan, ...(workflowState.value.history || []).filter(item => item.id !== result.plan.id)] }
    }
  } finally {
    busy.value = false
  }
}

function restoreWorkflow(plan) {
  workflowPlan.value = plan
  workflowPrompt.value = plan.prompt || ''
  workflowExecution.value = null
}

function navigateWorkflowStep(step) {
  if (step?.type !== 'navigate' || !step.target) return
  const target = String(step.target)
  if (!['/system-release', '/ai-ops'].includes(target.split('?')[0])) {
    MessagePlugin.error({ content: '该页面步骤无效，请重新生成工作流', placement: 'bottom-right' })
    return
  }
  router.push(target)
}

async function executeWorkflow() {
  if (!workflowPlan.value) return
  if (workflowPlan.value.requiresConfirmation && !await confirm({ title: '确认执行工作流', content: '工作流将仅执行预览中列出的外部打开步骤；不会自动发布、删除或回滚。确认继续吗？', theme: 'warning' })) return
  busy.value = true
  try {
    const result = await window.opsApi.executeAiWorkflow({ plan: workflowPlan.value, confirmed: true })
    if (notify(result, '执行工作流失败')) {
      const completed = result.completed || []
      workflowExecution.value = {
        opened: completed.filter(step => step.status === 'done').length,
        navigation: completed.filter(step => step.status === 'requires-user-navigation').length,
      }
      MessagePlugin.success({ content: workflowExecution.value.opened ? `已打开 ${workflowExecution.value.opened} 个外部链接` : '此计划没有可执行的外部打开步骤', placement: 'bottom-right' })
    }
  } finally {
    busy.value = false
  }
}

watch(() => sourceSelection.value.sourceKey, () => {
  sourceSelection.value.model = ''
})

watch(() => route.query.tab, tab => {
  if (tabs.some(item => item.id === tab)) activeTab.value = tab
}, { immediate: true })

watch(activeTab, tab => {
  if (tab === 'mcp' && !mcpInfo.value) loadState()
})

onMounted(loadState)
onActivated(() => {
  if (hasLoaded.value) loadState()
})
</script>

<style scoped>
.panel-title,
.actions,
.provider-card,
.provider-name-row,
.provider-url-row,
.card-actions,
.table-row,
.knowledge-doc,
.search-row,
.analysis-head,
.evaluation-summary,
.result-filters,
.workflow-plan li,
.workflow-complete,
.mcp-badge,
.form-context,
.inline-hint {
  display: flex;
  align-items: center;
}

.panel-title p {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.65;
}

.safety-chip,
.status-badge,
.count-badge,
.default-label,
.tag,
.risk,
.step-risk {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  white-space: nowrap;
  font-weight: 700;
}

.safety-chip {
  gap: 5px;
  padding: 7px 10px;
  border: 1px solid color-mix(in srgb, var(--primary) 20%, var(--border));
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
}

.tab-bar {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 5px;
  margin: 0;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bg-subtle) 76%, #fff);
  box-shadow: var(--shadow-xs);
  scrollbar-width: thin;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  flex: 1 0 auto;
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  font-weight: 650;
  transition: color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.tab-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.78);
}

.tab-btn.active {
  border-color: color-mix(in srgb, var(--primary) 15%, transparent);
  background: #fff;
  box-shadow: 0 1px 4px rgba(26, 36, 58, 0.1);
  color: var(--primary);
}

.tab-btn:focus-visible,
button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--primary) 62%, #fff);
  outline-offset: 2px;
}

.tab-panel {
  outline: none;
}

.panel-grid {
  display: grid;
  gap: var(--content-gap);
}

.providers-layout,
.logs-layout,
.knowledge-layout,
.workflow-layout {
  grid-template-columns: minmax(0, 1fr) minmax(360px, 0.94fr);
}

.stack {
  display: grid;
  gap: var(--content-gap);
}

.panel {
  min-width: 0;
  padding: var(--panel-padding);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--shadow-xs);
}

.panel-title {
  justify-content: space-between;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);
}

.panel-title h3 {
  margin: 0 0 4px;
  color: var(--text);
  font-size: 16px;
  letter-spacing: -0.01em;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}

.form-grid label,
.mcp-content label {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
}

.form-grid label.full {
  grid-column: 1 / -1;
}

.form-grid label.check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  font-size: 13px;
  font-weight: 500;
}

.form-grid label.align-end {
  align-self: end;
}

.form-grid em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
}

input,
select,
textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
  color: var(--text);
  font: inherit;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

input,
select {
  height: 36px;
  padding: 0 10px;
}

textarea {
  display: block;
  padding: 10px;
  line-height: 1.55;
  resize: vertical;
}

input:hover,
select:hover,
textarea:hover {
  border-color: color-mix(in srgb, var(--primary) 30%, var(--border));
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
  outline: none;
}

input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--primary);
}

.actions {
  gap: 9px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.btn-primary,
.btn-secondary,
.btn-text,
.icon-btn,
.filter-btn {
  border: 0;
  cursor: pointer;
  font: inherit;
  transition: transform 0.18s ease, color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 13px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 700;
}

.btn-primary {
  background: var(--primary);
  box-shadow: 0 5px 12px color-mix(in srgb, var(--primary) 18%, transparent);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

.btn-secondary {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-secondary);
}

.btn-secondary:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--primary) 35%, var(--border));
  color: var(--primary);
  background: var(--primary-soft);
}

.btn-text {
  padding: 5px 7px;
  border-radius: 7px;
  background: transparent;
  color: var(--primary);
  font-size: 12px;
  font-weight: 650;
}

.btn-text:hover:not(:disabled) {
  background: var(--primary-soft);
}

.icon-btn {
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
}

.icon-btn:hover:not(:disabled) {
  border-color: var(--border);
  background: var(--bg-subtle);
  color: var(--primary);
}

.icon-btn.danger:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--danger) 22%, var(--border));
  background: var(--danger-light);
  color: var(--danger);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none !important;
}

.form-context {
  gap: 7px;
  margin: -3px 0 14px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
  border-radius: 9px;
  background: var(--primary-soft);
  color: var(--text-secondary);
  font-size: 12px;
}

.form-error { display: flex; align-items: center; gap: 6px; margin: 0 0 var(--spacing-sm); color: var(--danger); font-size: 12px; line-height: 18px; }
.form-context strong {
  color: var(--primary);
}

.form-context .btn-text {
  margin-left: auto;
}

.context-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent);
}

.provider-source-panel {
  align-content: start;
}

.source-notice,
.source-empty,
.source-meta {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 var(--spacing-md);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.source-notice {
  padding: 10px 11px;
  border: 1px solid color-mix(in srgb, var(--primary) 16%, var(--border));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--primary-soft) 70%, #fff);
}

.source-empty {
  padding: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.source-empty .btn-text {
  flex: 0 0 auto;
  margin-left: auto;
}

.source-meta {
  align-items: center;
  overflow-wrap: anywhere;
  color: var(--text-muted);
}

.count-badge {
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: 11px;
}

.provider-list-panel {
  display: grid;
  align-content: start;
  gap: 10px;
}

.provider-list-panel .panel-title {
  margin-bottom: 3px;
}

.provider-card {
  justify-content: space-between;
  gap: 14px;
  padding: 13px;
  border: 1px solid var(--border-light);
  border-radius: 12px;
  background: var(--bg-subtle);
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.provider-card:hover {
  border-color: color-mix(in srgb, var(--primary) 22%, var(--border));
  background: #fff;
}

.provider-card.selected {
  border-color: color-mix(in srgb, var(--primary) 38%, var(--border));
  background: color-mix(in srgb, var(--primary-soft) 76%, #fff);
  box-shadow: 0 5px 14px color-mix(in srgb, var(--primary) 8%, transparent);
}

.provider-card-main {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.provider-name-row,
.provider-url-row {
  gap: 7px;
  min-width: 0;
  flex-wrap: wrap;
}

.provider-card-main strong {
  color: var(--text);
}

.provider-model {
  color: var(--primary);
  font-size: 12px;
  font-weight: 650;
}

.provider-url-row small {
  overflow: hidden;
  min-width: 0;
  max-width: 340px;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
  width: 24px;
  height: 24px;
}

.key-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
}

.status-badge,
.default-label,
.tag,
.risk,
.step-risk {
  padding: 3px 7px;
  border-radius: 999px;
  font-size: 10px;
}

.status-badge.primary,
.default-label {
  background: var(--primary-soft);
  color: var(--primary);
}

.status-badge.success {
  background: var(--success-light);
  color: var(--success);
}

.status-badge.muted {
  background: #e7ebf1;
  color: var(--text-muted);
}

.card-actions {
  align-items: flex-start;
  justify-content: flex-end;
  gap: 3px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.default-label {
  min-height: 22px;
}

.empty-mini {
  padding: 24px 14px;
  border: 1px dashed color-mix(in srgb, var(--text-muted) 30%, transparent);
  border-radius: 11px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.65;
  text-align: center;
}

.compact {
  padding: 15px;
  border: 1px solid var(--border-light);
  border-radius: 12px;
  background: var(--bg-subtle);
}

.cases-table {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.table-row,
.knowledge-doc {
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-light);
}

.table-row:last-child,
.knowledge-doc:last-child {
  border-bottom: 0;
}

.table-row strong,
.knowledge-doc strong {
  color: var(--text);
}

.table-row p {
  max-width: 700px;
  margin: 5px 0 7px;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag {
  margin-right: 5px;
  border-radius: 6px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
}

.row-actions {
  display: flex;
  align-items: flex-start;
  white-space: nowrap;
}

.metric {
  min-width: 74px;
  text-align: right;
}

.metric b {
  display: block;
  color: var(--primary);
  font-size: 24px;
}

.metric span {
  color: var(--text-muted);
  font-size: 12px;
}

.evaluation-summary {
  gap: 1px;
  margin-bottom: 14px;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: 11px;
  background: var(--border-light);
}

.evaluation-summary div {
  display: grid;
  flex: 1;
  gap: 4px;
  padding: 11px 13px;
  background: #fff;
}

.evaluation-summary span {
  color: var(--text-muted);
  font-size: 11px;
}

.evaluation-summary strong {
  color: var(--text);
  font-size: 17px;
}

.evaluation-summary .danger-value {
  color: var(--danger);
}

.result-filters {
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 13px;
}

.filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border-radius: 7px;
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 12px;
}

.filter-btn span {
  min-width: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  font-size: 10px;
}

.filter-btn:hover,
.filter-btn.active {
  background: var(--primary-soft);
  color: var(--primary);
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 11px;
}

.result-card {
  padding: 13px;
  border: 1px solid var(--border-light);
  border-left: 4px solid var(--success);
  border-radius: 10px;
  background: var(--bg-subtle);
}

.result-card.failed {
  border-left-color: var(--danger);
}

.result-card > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.result-card span {
  color: var(--text-muted);
  font-size: 12px;
}

.result-card p {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.55;
}

.result-card details,
.analysis-card details {
  margin-top: 9px;
  color: var(--text-secondary);
  font-size: 12px;
}

.result-card summary,
.analysis-card summary {
  cursor: pointer;
  color: var(--primary);
}

.result-card pre,
.analysis-card pre,
.answer-box pre,
.search-result pre,
.mcp-content pre {
  margin: 9px 0 0;
  color: #334155;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.inline-hint {
  gap: 6px;
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.evaluation-hint {
  margin: -4px 0 12px;
}

.field-meta {
  display: block;
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 400;
  text-align: right;
}

.analysis-card {
  margin-bottom: 11px;
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: 12px;
}

.analysis-head {
  justify-content: space-between;
  gap: 12px;
}

.analysis-head p,
.knowledge-doc p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.analysis-card > p {
  color: var(--text-secondary);
  font-size: 13px;
}

.analysis-card ul {
  margin: 9px 0;
  padding-left: 18px;
  color: var(--text-secondary);
  font-size: 13px;
}

.risk.high {
  background: var(--danger-light);
  color: var(--danger);
}

.risk.medium,
.step-risk.medium {
  background: var(--warning-light);
  color: #a16207;
}

.risk.low,
.step-risk {
  background: var(--success-light);
  color: var(--success);
}

.knowledge-list {
  max-height: 290px;
  margin-top: 16px;
  overflow: auto;
}

.search-row {
  gap: 9px;
  margin-bottom: 12px;
}

.search-row input {
  flex: 1;
}

.answer-btn {
  margin: 12px 0;
}

.answer-box {
  padding: 13px;
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
  border-radius: 10px;
  background: var(--primary-soft);
}

.answer-box strong {
  color: var(--primary);
}

.search-results {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.search-result {
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: 10px;
}

.search-result span {
  display: block;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.workflow-request {
  padding: 11px 12px;
  border-left: 3px solid var(--primary);
  border-radius: 7px;
  background: var(--bg-subtle);
  color: var(--text-secondary);
  font-size: 13px;
}

.workflow-plan ol {
  margin: 16px 0;
  padding: 0;
  list-style: none;
}

.workflow-plan li {
  align-items: flex-start;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-light);
}

.step-icon {
  display: inline-grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  background: var(--primary-soft);
  color: var(--primary);
}

.workflow-plan li > div {
  min-width: 0;
  flex: 1;
}

.workflow-plan li p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}

.workflow-plan li small {
  color: #a16207;
}

.workflow-complete {
  gap: 7px;
  margin: -5px 0 14px;
  padding: 9px 10px;
  border-radius: 9px;
  background: var(--success-light);
  color: color-mix(in srgb, var(--success) 82%, #14532d);
  font-size: 12px;
  font-weight: 650;
}

.workflow-history {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--border-light);
  color: var(--text-secondary);
  font-size: 12px;
}

.workflow-history strong {
  color: var(--text);
  font-size: 12px;
}

.workflow-history .btn-text {
  max-width: min(100%, 240px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-panel { max-width: 960px; }
.chat-title { align-items: flex-start; }
.chat-provider { flex: 0 1 auto; max-width: 300px; overflow: hidden; color: var(--primary); font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.chat-notice { display: flex; align-items: flex-start; gap: 7px; margin: 14px 0; color: var(--text-muted); font-size: 12px; line-height: 1.6; }
.chat-history { display: grid; max-height: 460px; min-height: 180px; gap: 10px; overflow: auto; padding: 12px; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--bg-subtle); }
.chat-history .empty-mini { align-self: center; }
.chat-message { display: grid; gap: 5px; max-width: min(88%, 720px); padding: 10px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--card-bg); }
.chat-message--user { justify-self: end; border-color: color-mix(in srgb, var(--primary) 32%, var(--border)); background: var(--primary-soft); }
.chat-message--assistant { justify-self: start; }
.chat-message--pending { color: var(--text-muted); }
.chat-message-role { color: var(--text-muted); font-size: 11px; font-weight: 700; }
.chat-message--user .chat-message-role { color: var(--primary); }
.chat-message p { margin: 0; color: var(--text); font-size: 13px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.chat-input { display: grid; gap: 7px; margin-top: 14px; color: var(--text-secondary); font-size: 13px; font-weight: 600; }
.chat-input textarea { min-height: 110px; }
.chat-actions { justify-content: space-between; }

.mcp-panel {
  max-width: 860px;
}

.mcp-content {
  display: grid;
  gap: 14px;
}

.mcp-content p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.65;
}

.mcp-content code {
  font-size: 12px;
}

.mcp-badge {
  gap: 7px;
  color: var(--success);
  font-weight: 700;
}

.mcp-content pre {
  padding: 14px;
  overflow: auto;
  border-radius: 10px;
  background: #111827;
  color: #e5e7eb;
}

.danger-text {
  color: var(--danger) !important;
}

.spinning {
  animation: ai-ops-spin 0.85s linear infinite;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 220px;
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(3px);
  color: var(--primary);
  font-weight: 650;
}

@keyframes ai-ops-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 980px) {
  .providers-layout,
  .logs-layout,
  .knowledge-layout,
  .workflow-layout {
    grid-template-columns: 1fr;
  }

  .ai-ops-page .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .ai-ops-page .page-actions {
    justify-content: flex-start;
  }

  .provider-url-row small {
    max-width: 440px;
  }

  .chat-title { align-items: flex-start; flex-direction: column; }
  .chat-provider { max-width: 100%; }
}

@media (max-width: 640px) {
  .panel {
    padding: var(--panel-padding);
  }

  .tab-bar {
    margin-left: -2px;
    margin-right: -2px;
  }

  .tab-btn {
    flex: 0 0 auto;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-grid label.full {
    grid-column: auto;
  }

  .provider-card,
  .table-row,
  .knowledge-doc {
    align-items: stretch;
    flex-direction: column;
  }

  .card-actions,
  .row-actions {
    justify-content: flex-end;
  }

  .evaluation-summary div {
    padding: 10px;
  }

  .search-row {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
