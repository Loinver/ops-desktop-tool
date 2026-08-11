<template>
  <div class="page ai-ops-page">
    <header class="page-header">
      <div class="page-heading">
        <div class="page-eyebrow">
          <t-icon :name="currentSection.icon" /> {{ currentSection.eyebrow }}
        </div>
        <h2 class="page-title">{{ currentSection.title }}</h2>
        <p class="page-desc">{{ currentSection.description }}</p>
      </div>
      <div class="page-actions header-actions">
        <span class="safety-chip"><t-icon name="secured" /> 凭证不出主进程 · 执行需确认</span>
        <button
          class="btn-secondary refresh-btn"
          type="button"
          :disabled="loading || refreshing"
          @click="loadState"
        >
          <t-icon name="refresh" :class="{ spinning: refreshing }" />
          {{ refreshing ? '刷新中' : '刷新' }}
        </button>
      </div>
    </header>

    <main class="page-content">
      <div
        v-if="tabs.length > 1"
        class="tab-bar"
        role="tablist"
        :aria-label="`${currentSection.title}功能`"
      >
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
        :role="tabs.length > 1 ? 'tabpanel' : 'region'"
        :aria-labelledby="tabs.length > 1 ? `ai-ops-tab-${activeTab}` : undefined"
        :aria-label="tabs.length === 1 ? currentSection.title : undefined"
        tabindex="-1"
      >
        <section v-if="activeTab === 'providers'" class="panel-grid providers-layout">
          <article class="panel form-panel provider-source-panel">
            <div class="panel-title">
              <div>
                <h3>从模型可靠性一键配置</h3>
                <p>
                  AI Provider
                  统一从“模型可靠性”读取；仅显示最近一次模型测试通过的模型。接口地址和密钥始终使用最新配置。
                </p>
              </div>
              <button
                class="btn-text source-reliability-link"
                type="button"
                title="前往模型可靠性"
                aria-label="前往模型可靠性"
                @click="openModelReliability"
              >
                <span>前往配置</span>
                <t-icon name="chevron-right" aria-hidden="true" />
              </button>
            </div>
            <div class="source-notice">
              <t-icon name="secured" aria-hidden="true" />
              <span
                >仅可选择最近一次模型测试通过的模型；支持 OpenAI Chat / Responses、Anthropic
                Messages 与 Gemini generateContent。</span
              >
            </div>
            <div v-if="sourceError" class="source-empty" role="status">
              <t-icon name="error-circle" />
              <span>{{ sourceError }}</span>
              <button
                class="btn-text"
                type="button"
                :disabled="sourceLoading"
                @click="loadProviderSources"
              >
                重新读取
              </button>
            </div>
            <template v-else-if="providerSources.length">
              <div class="form-grid">
                <label class="full">
                  <span>Provider</span>
                  <select
                    v-model="sourceSelection.sourceKey"
                    :disabled="sourceLoading || savingProvider"
                  >
                    <option value="">请选择模型可靠性 Provider</option>
                    <option
                      v-for="source in providerSources"
                      :key="sourceKey(source)"
                      :value="sourceKey(source)"
                    >
                      {{ source.name }} · {{ source.protocolLabel }}
                    </option>
                  </select>
                </label>
                <label class="full">
                  <span>已测试通过的模型</span>
                  <select
                    v-model="sourceSelection.model"
                    :disabled="!selectedProviderSource || savingProvider"
                  >
                    <option value="">请选择测试通过的模型</option>
                    <option
                      v-for="model in selectedProviderModels"
                      :key="model.model"
                      :value="model.model"
                    >
                      {{ model.label }}
                    </option>
                  </select>
                </label>
              </div>
              <p v-if="selectedProviderSource" class="source-meta">
                <t-icon name="server" /> {{ selectedProviderSource.baseUrl }}
                <span>·</span> 密钥仅在主进程从模型可靠性读取
              </p>
              <div class="actions">
                <button
                  class="btn-primary"
                  type="button"
                  :disabled="savingProvider || !selectedProviderSource || !sourceSelection.model"
                  @click="addModelReliabilityProvider"
                >
                  <t-icon
                    :name="savingProvider ? 'loading' : 'add'"
                    :class="{ spinning: savingProvider }"
                  />
                  {{ savingProvider ? '配置中' : '一键配置并设为默认' }}
                </button>
                <button
                  class="btn-text"
                  type="button"
                  :disabled="sourceLoading"
                  @click="loadProviderSources"
                >
                  刷新来源
                </button>
              </div>
            </template>
            <div v-else class="source-empty">
              <t-icon name="server" />
              <span
                >未找到测试通过的可接入模型。请先在模型可靠性完成模型测试，并确认最近一次测试通过。</span
              >
              <button class="btn-text" type="button" @click="openModelReliability">去配置</button>
            </div>
          </article>

          <article class="panel provider-list-panel">
            <div class="panel-title">
              <div>
                <h3>已配置 Provider</h3>
                <p>
                  {{
                    providers.length
                      ? `当前默认：${activeProvider?.name || '未选择'}`
                      : '尚未配置 Provider'
                  }}
                </p>
              </div>
              <span v-if="providers.length" class="count-badge">{{ providers.length }}</span>
            </div>
            <div v-if="!providers.length" class="empty-mini">
              请先从左侧的模型可靠性来源一键添加 Provider。
            </div>
            <div
              v-for="provider in providers"
              :key="provider.id"
              :class="[
                'provider-card',
                { selected: provider.id === providerState.activeProviderId }
              ]"
            >
              <div class="provider-card-main">
                <div class="provider-name-row">
                  <strong>{{ provider.name }}</strong>
                  <span
                    v-if="provider.id === providerState.activeProviderId"
                    class="status-badge primary"
                    >默认 Provider</span
                  >
                  <span class="status-badge primary">模型可靠性来源</span>
                  <span v-if="provider.protocolLabel" class="status-badge muted">{{
                    provider.protocolLabel
                  }}</span>
                  <span :class="['status-badge', provider.available ? 'success' : 'muted']">{{
                    provider.available ? '可用' : '需检查'
                  }}</span>
                </div>
                <span class="provider-model">{{ provider.model }}</span>
                <div class="provider-url-row">
                  <small :title="provider.baseUrl">{{ provider.baseUrl }}</small>
                  <button
                    class="icon-btn copy-btn"
                    type="button"
                    title="复制接口地址"
                    aria-label="复制接口地址"
                    @click="copyText(provider.baseUrl, '接口地址已复制')"
                  >
                    <t-icon name="file-copy" />
                  </button>
                </div>
                <small v-if="provider.available" class="key-status"
                  ><t-icon name="secured" /> 密钥由模型可靠性托管（{{
                    provider.apiKeyMasked
                  }}）</small
                >
                <small v-else class="danger-text">{{ provider.issue || '来源当前不可用' }}</small>
              </div>
              <div class="card-actions">
                <span v-if="provider.id === providerState.activeProviderId" class="default-label"
                  >默认</span
                >
                <button
                  v-else
                  class="btn-text"
                  type="button"
                  :disabled="activatingProviderId === provider.id || !provider.available"
                  @click="activateProvider(provider.id)"
                >
                  {{ activatingProviderId === provider.id ? '设置中' : '设为默认' }}
                </button>
                <button
                  class="icon-btn"
                  type="button"
                  title="连接测试"
                  aria-label="连接测试"
                  :disabled="testingProviderId === provider.id || !provider.available"
                  @click="testProvider(provider.id)"
                >
                  <t-icon
                    :name="testingProviderId === provider.id ? 'loading' : 'check-circle'"
                    :class="{ spinning: testingProviderId === provider.id }"
                  />
                </button>
                <button
                  class="icon-btn"
                  type="button"
                  title="前往模型可靠性"
                  aria-label="前往模型可靠性"
                  @click="openModelReliability"
                >
                  <t-icon name="jump" />
                </button>
                <button
                  class="icon-btn danger"
                  type="button"
                  title="从 AI 功能中移除"
                  aria-label="从 AI 功能中移除"
                  @click="removeProvider(provider)"
                >
                  <t-icon name="delete" />
                </button>
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
              <button
                class="btn-primary"
                type="button"
                :disabled="busy || !evaluationCases.length || !activeProviderReady"
                @click="runEvaluation"
              >
                <t-icon name="play-circle" /> 运行评测
              </button>
            </div>
            <p v-if="!activeProviderReady" class="inline-hint evaluation-hint">
              <t-icon name="info-circle" /> 配置已启用且包含密钥的默认 Provider 后，才可运行评测。
            </p>
            <div v-if="caseForm.id" class="form-context">
              <span class="context-dot"></span>
              正在编辑 <strong>{{ caseForm.name || '未命名评测用例' }}</strong>
              <button class="btn-text" type="button" @click="resetCaseForm">取消编辑</button>
            </div>
            <div class="case-form form-grid compact">
              <label
                ><span>用例名称</span
                ><input v-model="caseForm.name" placeholder="例如：JSON 结构化输出"
              /></label>
              <label
                ><span>期望关键词 <em>逗号分隔，可选</em></span
                ><input v-model="caseForm.expectedKeywords" placeholder="status, result"
              /></label>
              <label class="full"
                ><span>提示词</span
                ><textarea
                  v-model="caseForm.prompt"
                  rows="3"
                  placeholder="输入希望模型完成的任务"
                ></textarea>
              </label>
              <label class="full"
                ><span>系统提示词 <em>可选</em></span
                ><input v-model="caseForm.systemPrompt" placeholder="例如：仅返回 JSON 对象"
              /></label>
              <label class="check checkbox-row"
                ><input v-model="caseForm.expectJson" type="checkbox" /> 要求合法 JSON 对象</label
              >
              <div class="actions">
                <button class="btn-secondary" type="button" @click="upsertCase">
                  <t-icon name="add" /> {{ caseForm.id ? '更新用例' : '加入用例' }}</button
                ><button v-if="caseForm.id" class="btn-text" type="button" @click="resetCaseForm">
                  取消编辑
                </button>
              </div>
            </div>
            <div v-if="!evaluationCases.length" class="empty-mini">
              尚无评测用例。可先添加“关键词判断”或“JSON 输出”用例。
            </div>
            <div v-else class="data-table cases-table">
              <div v-for="item in evaluationCases" :key="item.id" class="table-row">
                <div>
                  <strong>{{ item.name }}</strong>
                  <p>{{ item.prompt }}</p>
                  <span v-if="item.expectedKeywords?.length" class="tag"
                    >关键词：{{ item.expectedKeywords.join('、') }}</span
                  >
                  <span v-if="item.expectJson" class="tag">JSON</span>
                </div>
                <div class="row-actions">
                  <button class="btn-text" type="button" @click="editCase(item)">编辑</button
                  ><button class="btn-text danger-text" type="button" @click="removeCase(item.id)">
                    删除
                  </button>
                </div>
              </div>
            </div>
          </article>

          <article v-if="latestEvaluation" class="panel">
            <div class="panel-title evaluation-title">
              <div>
                <h3>最近一次评测结果</h3>
                <p>
                  {{ formatTime(latestEvaluation.finishedAt) }} ·
                  {{ latestEvaluation.providerName }} / {{ latestEvaluation.model }}
                </p>
              </div>
              <div class="metric">
                <b>{{ latestEvaluation.summary.passed }}/{{ latestEvaluation.summary.total }}</b
                ><span>通过</span>
              </div>
            </div>
            <div class="evaluation-summary">
              <div>
                <span>通过率</span><strong>{{ evaluationPassRate }}%</strong>
              </div>
              <div>
                <span>失败项</span><strong class="danger-value">{{ evaluationFailedCount }}</strong>
              </div>
              <div>
                <span>平均耗时</span><strong>{{ evaluationAverageDuration }}ms</strong>
              </div>
            </div>
            <div class="result-filters" role="group" aria-label="评测结果筛选">
              <button
                v-for="filter in evaluationFilters"
                :key="filter.id"
                type="button"
                :class="['filter-btn', { active: evaluationFilter === filter.id }]"
                @click="evaluationFilter = filter.id"
              >
                {{ filter.label }}<span>{{ filter.count }}</span>
              </button>
            </div>
            <div class="result-grid">
              <div
                v-for="item in filteredEvaluationResults"
                :key="item.id"
                :class="['result-card', item.ok ? 'ok' : 'failed']"
              >
                <div>
                  <strong>{{ item.name }}</strong
                  ><span>{{ item.ok ? '通过' : '未通过' }} · {{ item.durationMs }}ms</span>
                </div>
                <p v-if="item.error">{{ item.error }}</p>
                <p v-else-if="!item.ok">
                  {{
                    item.expectJson && !item.jsonOk
                      ? '返回内容不是 JSON 对象。'
                      : '未命中所有期望关键词。'
                  }}
                </p>
                <details v-if="item.answer">
                  <summary>查看脱敏回答</summary>
                  <pre>{{ item.answer }}</pre>
                </details>
              </div>
            </div>
            <div v-if="!filteredEvaluationResults.length" class="empty-mini">
              当前筛选条件下没有评测结果。
            </div>
          </article>
        </section>

        <section v-else-if="activeTab === 'logs'" class="panel-grid logs-layout">
          <article class="panel form-panel">
            <div class="panel-title">
              <div>
                <h3>AI 日志分析</h3>
                <p>日志在发给模型前会先进行密钥、Token、密码与私钥脱敏；也可只做本地规则分析。</p>
              </div>
            </div>
            <div class="form-grid">
              <label
                ><span>日志标题</span
                ><input v-model="logForm.title" placeholder="例如：正式环境发布失败 2026-07-31"
              /></label>
              <label class="check checkbox-row align-end"
                ><input v-model="logForm.useAi" type="checkbox" :disabled="!activeProviderReady" />
                使用当前 AI Provider 生成总结</label
              >
              <p v-if="!activeProviderReady" class="inline-hint full provider-hint">
                <t-icon name="info-circle" aria-hidden="true" />
                <span
                  >暂无可用 Provider；当前可使用本地规则分析。请先在 Provider
                  页配置、启用并设为默认。</span
                >
              </p>
              <label class="full"
                ><span>日志内容</span
                ><textarea
                  v-model="logForm.text"
                  rows="12"
                  maxlength="200000"
                  placeholder="粘贴 Nginx、应用、发布或模型测试日志"
                ></textarea
                ><small class="field-meta"
                  >{{ logLineCount }} 行 · {{ logForm.text.length.toLocaleString() }} / 200,000
                  字符</small
                ></label
              >
            </div>
            <div class="actions">
              <button
                class="btn-primary"
                type="button"
                :disabled="busy || !logForm.text.trim()"
                @click="analyzeLog"
              >
                <t-icon name="search" /> 分析日志
              </button>
            </div>
          </article>
          <article class="panel">
            <div class="panel-title">
              <div>
                <h3>分析记录</h3>
                <p>仅保留脱敏后的统计、节选和 AI 总结。</p>
              </div>
              <span v-if="logs.length" class="count-badge"
                >最近 {{ Math.min(logs.length, 8) }} 条</span
              >
            </div>
            <div v-if="!logs.length" class="empty-mini">暂无日志分析记录。</div>
            <div v-for="item in logs.slice(0, 8)" :key="item.id" class="analysis-card">
              <div class="analysis-head">
                <div>
                  <strong>{{ item.title }}</strong>
                  <p>{{ formatTime(item.createdAt) }} · {{ item.lineCount }} 行</p>
                </div>
                <span :class="['risk', item.level]">{{ riskLabel(item.level) }}</span>
              </div>
              <p>{{ item.headline }}</p>
              <ul>
                <li v-for="finding in item.findings" :key="finding.type">
                  {{ finding.type }}：{{ finding.count }} 条
                </li>
              </ul>
              <details v-if="item.aiSummary">
                <summary>AI 分析结论</summary>
                <pre>{{ item.aiSummary }}</pre>
              </details>
              <details>
                <summary>查看脱敏日志节选</summary>
                <pre>{{ item.excerpt }}</pre>
              </details>
              <div class="analysis-card__actions">
                <button class="btn-secondary" type="button" @click="attachLogToAiChat(item)">
                  <t-icon name="attach" /> 附加到 AI 对话
                </button>
              </div>
            </div>
          </article>
        </section>

        <section v-else-if="activeTab === 'knowledge'" class="panel-grid knowledge-layout">
          <article class="panel form-panel">
            <div class="panel-title">
              <div>
                <h3>{{ knowledgeEditingId ? '编辑知识文档' : '本地运维知识库' }}</h3>
                <p>可保存发布规范、故障复盘、服务器说明和排障手册；检索结果显示具体行号。</p>
              </div>
            </div>
            <div class="form-grid">
              <label
                ><span>标题</span
                ><input v-model="knowledgeForm.title" placeholder="例如：正式环境发布 SOP" /></label
              ><label
                ><span>标签</span
                ><input v-model="knowledgeForm.tags" placeholder="发布, 正式环境, 回滚" /></label
              ><label class="full"
                ><span>内容</span
                ><textarea
                  v-model="knowledgeForm.content"
                  rows="13"
                  maxlength="200000"
                  placeholder="粘贴本地文档内容。保存前会脱敏。"
                ></textarea>
              </label>
            </div>
            <div class="actions">
              <button
                class="btn-primary"
                type="button"
                :disabled="busy || !knowledgeForm.content.trim()"
                @click="saveKnowledge"
              >
                <t-icon name="save" />
                {{ knowledgeEditingId ? '更新文档' : '保存到知识库' }}</button
              ><button
                v-if="knowledgeEditingId"
                class="btn-secondary"
                type="button"
                @click="cancelEditKnowledge"
              >
                取消编辑</button
              ><button
                class="btn-secondary"
                type="button"
                :disabled="busy"
                @click="importKnowledge"
              >
                <t-icon name="upload" /> 导入本地文档
              </button>
              <button
                class="btn-secondary"
                type="button"
                :disabled="busy"
                @click="importKnowledgeDirectory"
              >
                <t-icon name="folder-open" /> 增量导入目录
              </button>
            </div>
            <p v-if="knowledgeImportSummary" class="inline-hint">
              <t-icon name="info-circle" /> {{ knowledgeImportSummary }}
            </p>
            <div v-if="knowledgeAllTags.length" class="knowledge-tag-filter">
              <button
                :class="['tag-chip', { active: !knowledgeTagFilter }]"
                type="button"
                @click="knowledgeTagFilter = ''"
              >
                全部</button
              ><button
                v-for="tag in knowledgeAllTags"
                :key="tag.name"
                :class="['tag-chip', { active: knowledgeTagFilter === tag.name }]"
                type="button"
                @click="knowledgeTagFilter = knowledgeTagFilter === tag.name ? '' : tag.name"
              >
                {{ tag.name }} ({{ tag.count }})
              </button>
            </div>
            <div class="knowledge-list">
              <div
                v-for="doc in filteredKnowledgeDocuments"
                :key="doc.id"
                class="knowledge-doc"
                :class="{ editing: knowledgeEditingId === doc.id }"
              >
                <div class="knowledge-doc-info">
                  <strong>{{ doc.title }}</strong>
                  <p>
                    {{ doc.tags?.join(' · ') || '无标签' }} ·
                    {{ knowledgeSourceLabel(doc.source) }} ·
                    {{ formatTime(doc.updatedAt) }}
                  </p>
                </div>
                <div class="knowledge-doc-actions">
                  <button class="btn-text" type="button" @click="readKnowledge(doc)" title="阅读">
                    <t-icon name="file-text" /></button
                  ><button class="btn-text" type="button" @click="editKnowledge(doc)" title="编辑">
                    <t-icon name="edit" /></button
                  ><button
                    class="btn-text"
                    type="button"
                    :disabled="busy"
                    @click="exportKnowledge(doc)"
                    title="导出"
                  >
                    <t-icon name="download" /></button
                  ><button
                    class="btn-text danger-text"
                    type="button"
                    @click="removeKnowledge(doc.id)"
                    title="删除"
                  >
                    <t-icon name="delete" />
                  </button>
                </div>
              </div>
              <div v-if="!filteredKnowledgeDocuments.length" class="empty-mini">
                {{
                  knowledgeDocuments.length
                    ? '该标签下无文档。'
                    : '暂无知识文档，保存内容后可在右侧检索。'
                }}
              </div>
            </div>
            <div v-if="knowledgeDocuments.length" class="knowledge-stats">
              {{ knowledgeDocuments.length }} 篇文档 · {{ knowledgeTotalChars.toLocaleString() }} 字
            </div>
          </article>
          <article class="panel search-panel">
            <template v-if="knowledgeReadingDoc">
              <div class="panel-title">
                <div>
                  <h3>{{ knowledgeReadingDoc.title }}</h3>
                  <p>
                    {{ knowledgeReadingDoc.tags?.join(' · ') || '无标签' }} ·
                    {{ formatTime(knowledgeReadingDoc.updatedAt) }}
                  </p>
                </div>
                <button class="btn-text" type="button" @click="closeReader">
                  <t-icon name="close" /> 返回检索
                </button>
              </div>
              <div class="knowledge-reader">
                <pre>{{ knowledgeReadingDoc.content }}</pre>
              </div>
            </template>
            <template v-else>
              <div class="panel-title">
                <div>
                  <h3>检索与问答</h3>
                  <p>
                    默认使用关键词、短语和文本相似度混合排序；开启 AI 后会要求答案标注来源编号。
                  </p>
                </div>
              </div>
              <div class="search-row">
                <input
                  v-model="knowledgeQuery"
                  placeholder="例如：正式环境如何回滚？"
                  @keyup.enter="searchKnowledge"
                /><button
                  class="btn-secondary"
                  type="button"
                  :disabled="busy"
                  @click="searchKnowledge"
                >
                  <t-icon name="search" /> 检索
                </button>
              </div>
              <label class="check checkbox-row"
                ><input v-model="knowledgeUseAi" type="checkbox" :disabled="!activeProviderReady" />
                使用当前 AI Provider 基于检索结果回答</label
              >
              <p v-if="!activeProviderReady" class="inline-hint">
                <t-icon name="info-circle" /> 配置已启用且包含密钥的默认 Provider 后可生成 AI 回答。
              </p>
              <button
                class="btn-primary answer-btn"
                type="button"
                :disabled="busy || !knowledgeQuery.trim()"
                @click="answerKnowledge"
              >
                <t-icon name="chat" /> 生成带引用的回答
              </button>
              <div v-if="knowledgeAnswer" class="answer-box">
                <strong>回答</strong>
                <pre>{{ knowledgeAnswer }}</pre>
              </div>
              <div v-if="knowledgeResults.length" class="search-results">
                <div
                  v-for="(item, index) in knowledgeResults"
                  :key="`${item.documentId}-${item.startLine}`"
                  class="search-result"
                >
                  <strong>[{{ index + 1 }}] {{ item.title }}</strong>
                  <span>
                    第 {{ item.startLine }}–{{ item.endLine }} 行 · {{ item.matchReason }} · 评分
                    {{ item.score }} · 更新于 {{ formatTime(item.updatedAt) }}
                  </span>
                  <!-- eslint-disable-next-line vue/no-v-html -- highlightKnowledge escapes document content before adding <mark> tags. -->
                  <pre v-html="highlightKnowledge(item.content, item.matchedTerms)"></pre>
                  <div class="search-result__actions">
                    <button
                      class="btn-text"
                      type="button"
                      @click="attachKnowledgeToAiChat(item, index)"
                    >
                      <t-icon name="attach" /> 附加证据
                    </button>
                  </div>
                </div>
              </div>
              <div v-else-if="searched" class="empty-mini">没有检索到匹配知识。</div>
            </template>
          </article>
        </section>

        <section v-else-if="activeTab === 'workflow'" class="panel-grid workflow-layout">
          <article class="panel form-panel">
            <div class="panel-title">
              <div>
                <h3>自然语言运维工作流</h3>
                <p>
                  AI
                  工作流只生成安全预览：页面步骤由你主动前往；外部打开必须确认；不会自动发布、删除或回滚。
                </p>
              </div>
            </div>
            <textarea
              v-model="workflowPrompt"
              rows="8"
              placeholder="例如：打开测试环境后台、进入发布页面并查看模型评测"
            ></textarea>
            <div class="actions">
              <button
                class="btn-primary"
                type="button"
                :disabled="busy || !workflowPrompt.trim()"
                @click="planWorkflow"
              >
                <t-icon name="gesture-pray" /> 生成预览
              </button>
            </div>
          </article>
          <article class="panel">
            <div class="panel-title">
              <div>
                <h3>执行预览</h3>
                <p>
                  {{
                    workflowPlan
                      ? workflowPlan.summary || '请核对每一步，再决定是否执行。'
                      : '尚未生成工作流。'
                  }}
                </p>
              </div>
            </div>
            <div v-if="workflowPlan" class="workflow-plan">
              <div class="workflow-request">{{ workflowPlan.prompt }}</div>
              <ol>
                <li
                  v-for="step in workflowPlan.steps"
                  :key="step.id || `${step.type}-${step.label}`"
                >
                  <span class="step-icon"><t-icon :name="workflowStepIcon(step)" /></span>
                  <span :class="['step-risk', step.risk]">{{ workflowRiskLabel(step.risk) }}</span>
                  <div>
                    <strong>{{ step.description || step.label }}</strong>
                    <p v-if="step.target" class="workflow-step-target">{{ step.target }}</p>
                    <div class="workflow-step-details">
                      <span><b>影响</b>{{ step.impact || '仅执行预览中描述的安全动作。' }}</span>
                      <span><b>回滚点</b>{{ step.rollbackPoint || '未产生系统变更。' }}</span>
                      <span> <b>审批</b>{{ step.approval?.reason || '由用户主动触发。' }} </span>
                      <span
                        ><b>执行边界</b>{{ workflowExecutionLabel(step.allowedExecution) }}</span
                      >
                    </div>
                    <small v-if="step.approval?.required">此步必须明确确认，并写入安全审计。</small>
                    <small v-else>此步执行结果会写入安全审计。</small>
                  </div>
                  <button
                    v-if="step.type === 'navigate'"
                    class="btn-text"
                    type="button"
                    :disabled="busy"
                    @click="navigateWorkflowStep(step)"
                  >
                    {{ step.approval?.required ? '确认并前往' : '前往' }}
                  </button>
                </li>
              </ol>
              <div v-if="workflowExecution" class="workflow-complete">
                <t-icon name="check-circle" /> 已处理 {{ workflowExecution.handled }} 个步骤：打开
                {{ workflowExecution.opened }} 个外部链接，确认 {{ workflowExecution.navigation }}
                个页面导航。未执行发布、删除、回滚或进程操作；审批结果已写入安全审计。
              </div>
              <button
                v-if="workflowExternalSteps.length"
                class="btn-primary"
                type="button"
                :disabled="busy"
                @click="executeWorkflow"
              >
                <t-icon name="play-circle" /> 确认打开 {{ workflowExternalSteps.length }} 个外部链接
              </button>
              <p v-else class="inline-hint">
                <t-icon name="info-circle" />
                此计划没有外部打开步骤，请按需点击每个页面步骤的“前往”。
              </p>
            </div>
            <div v-else class="empty-mini">
              支持“打开网站”“进入发布”“模型测试”“日志排查”等关键词；发布操作只会导航到页面，不会自动执行。
            </div>
            <div v-if="workflowState.history?.length" class="workflow-history">
              <strong>最近计划</strong
              ><button
                v-for="item in workflowState.history.slice(0, 5)"
                :key="item.id"
                class="btn-text"
                type="button"
                @click="restoreWorkflow(item)"
              >
                {{ item.prompt }}
              </button>
            </div>
          </article>
        </section>

        <section v-else-if="activeTab === 'mcp'" class="panel mcp-panel">
          <div class="panel-title">
            <div>
              <h3>MCP 本地只读服务</h3>
              <p>
                供 Codex、Claude Desktop
                等客户端访问本机发布历史、模型健康度和运维知识库。不会暴露密钥，也不提供发布写操作。
              </p>
            </div>
          </div>
          <div v-if="mcpInfo" class="mcp-content">
            <div class="mcp-badge"><t-icon name="secured" /> stdio · 只读</div>
            <p>
              可用工具：<code>{{ mcpInfo.tools.join(' · ') }}</code>
            </p>
            <p>{{ mcpInfo.note }}</p>
            <label
              ><span>启动命令</span
              ><input :value="mcpInfo.command" readonly @focus="$event.target.select()" /></label
            ><label
              ><span>启动参数</span
              ><input :value="mcpInfo.args.join(' ')" readonly @focus="$event.target.select()"
            /></label>
            <pre>{{ mcpConfigExample }}</pre>
          </div>
          <div v-else class="empty-mini">正在读取 MCP 配置…</div>
        </section>
      </section>
    </main>

    <div v-if="loading" class="loading-overlay">
      <t-icon name="loading" class="spinning" /> 正在加载 AI 运维数据…
    </div>
  </div>
</template>

<script setup>
import { opsApi } from '../../api/opsApi.js'
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useConfirm } from '../../composables/useConfirm'
import { addAiContextAttachment } from '../../utils/ai-context.js'

defineOptions({ name: 'AiOps' })

const props = defineProps({ section: { type: String, default: 'models' } })

const { confirm } = useConfirm()
const route = useRoute()
const router = useRouter()
const allTabs = [
  { id: 'providers', name: 'Provider', icon: 'server' },
  { id: 'evaluation', name: '质量评测', icon: 'chart-bar' },
  { id: 'logs', name: '日志分析', icon: 'search' },
  { id: 'knowledge', name: '知识库', icon: 'folder-open' },
  { id: 'workflow', name: '安全操作编排', icon: 'rocket' },
  { id: 'mcp', name: 'MCP', icon: 'api' }
]

const sectionDefinitions = {
  models: {
    title: '模型中心',
    eyebrow: 'MODEL CENTER',
    description: '管理通过连接测试的 AI Provider，并使用评测用例验证模型输出质量。',
    icon: 'server',
    tabs: ['providers', 'evaluation']
  },
  knowledge: {
    title: '知识库',
    eyebrow: 'KNOWLEDGE BASE',
    description: '集中管理本地知识文档、检索内容并为 AI 对话提供可引用的上下文。',
    icon: 'folder-open',
    tabs: ['knowledge']
  },
  operations: {
    title: 'AI 运维工具',
    eyebrow: 'AI OPERATIONS',
    description: '对脱敏日志进行辅助分析，并通过需要确认的安全操作编排处理运维任务。',
    icon: 'search',
    tabs: ['logs', 'workflow']
  },
  integrations: {
    title: 'AI 集成',
    eyebrow: 'AI INTEGRATIONS',
    description: '查看 MCP 本地只读服务配置，并安全接入支持 MCP 的外部客户端。',
    icon: 'api',
    tabs: ['mcp']
  }
}

const currentSection = computed(
  () => sectionDefinitions[props.section] || sectionDefinitions.models
)
const tabs = computed(() =>
  currentSection.value.tabs.map((id) => allTabs.find((tab) => tab.id === id)).filter(Boolean)
)
const activeTab = ref('providers')
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

const newCase = () => ({
  id: '',
  name: '',
  prompt: '',
  systemPrompt: '',
  expectedKeywords: '',
  expectJson: false
})
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
const knowledgeImportSummary = ref('')
const knowledgeEditingId = ref('')
const knowledgeReadingDoc = ref(null)
const knowledgeTagFilter = ref('')
const workflowPrompt = ref('')
const workflowPlan = ref(null)
const workflowExecution = ref(null)
const evaluationFilter = ref('all')

const providers = computed(() => providerState.value.providers || [])
const activeProvider = computed(() =>
  providers.value.find((item) => item.id === providerState.value.activeProviderId)
)
const activeProviderReady = computed(() =>
  Boolean(
    activeProvider.value?.enabled &&
    activeProvider.value?.available &&
    activeProvider.value?.hasApiKey
  )
)
const sourceKey = (source) => `${source.appType}::${source.id}`
const selectedProviderSource = computed(
  () =>
    providerSources.value.find((source) => sourceKey(source) === sourceSelection.value.sourceKey) ||
    null
)
const selectedProviderModels = computed(() => selectedProviderSource.value?.models || [])
const evaluationCases = computed(() => evaluationState.value.cases || [])
const latestEvaluation = computed(() => evaluationState.value.runs?.[0] || null)
const logs = computed(() => logState.value.items || [])
const knowledgeDocuments = computed(() => knowledgeState.value.documents || [])
const knowledgeAllTags = computed(() => {
  const counts = new Map()
  for (const doc of knowledgeDocuments.value) {
    for (const tag of doc.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
})
const filteredKnowledgeDocuments = computed(() => {
  if (!knowledgeTagFilter.value) return knowledgeDocuments.value
  return knowledgeDocuments.value.filter((doc) =>
    (doc.tags || []).includes(knowledgeTagFilter.value)
  )
})
const knowledgeTotalChars = computed(() =>
  knowledgeDocuments.value.reduce((sum, doc) => sum + (doc.content?.length || 0), 0)
)
const mcpConfigExample = computed(() =>
  mcpInfo.value
    ? JSON.stringify(
        {
          mcpServers: {
            'ops-desktop': { command: mcpInfo.value.command, args: mcpInfo.value.args }
          }
        },
        null,
        2
      )
    : ''
)
const evaluationResults = computed(() => latestEvaluation.value?.results || [])
const evaluationFailedCount = computed(
  () => evaluationResults.value.filter((item) => !item.ok).length
)
const evaluationPassRate = computed(() => {
  const total = latestEvaluation.value?.summary?.total || 0
  return total ? Math.round(((latestEvaluation.value?.summary?.passed || 0) / total) * 100) : 0
})
const evaluationAverageDuration = computed(() => {
  if (!evaluationResults.value.length) return 0
  return Math.round(
    evaluationResults.value.reduce((sum, item) => sum + (Number(item.durationMs) || 0), 0) /
      evaluationResults.value.length
  )
})
const evaluationFilters = computed(() => [
  { id: 'all', label: '全部', count: evaluationResults.value.length },
  { id: 'failed', label: '未通过', count: evaluationFailedCount.value },
  {
    id: 'json',
    label: 'JSON 异常',
    count: evaluationResults.value.filter((item) => item.expectJson && !item.jsonOk).length
  },
  {
    id: 'keyword',
    label: '关键词未命中',
    count: evaluationResults.value.filter(
      (item) => !item.ok && !item.error && (!item.expectJson || item.jsonOk)
    ).length
  }
])
const filteredEvaluationResults = computed(() => {
  if (evaluationFilter.value === 'failed') return evaluationResults.value.filter((item) => !item.ok)
  if (evaluationFilter.value === 'json')
    return evaluationResults.value.filter((item) => item.expectJson && !item.jsonOk)
  if (evaluationFilter.value === 'keyword')
    return evaluationResults.value.filter(
      (item) => !item.ok && !item.error && (!item.expectJson || item.jsonOk)
    )
  return evaluationResults.value
})
const logLineCount = computed(() =>
  logForm.value.text ? logForm.value.text.split(/\r?\n/).length : 0
)
const workflowExternalSteps = computed(() =>
  (workflowPlan.value?.steps || []).filter((step) => step.type === 'open-url')
)

function notify(result, fallback = '操作失败') {
  if (result?.ok) return true
  MessagePlugin.error({ content: result?.error || fallback, placement: 'bottom-right' })
  return false
}

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '—'
}

function riskLabel(level) {
  return { high: '高风险', medium: '需关注', low: '低风险' }[level] || '未知'
}

function selectTab(tabId) {
  activeTab.value = tabId
  if (route.query.tab !== tabId) router.replace({ query: { ...route.query, tab: tabId } })
}

function handleTabKeydown(event, tabId) {
  const currentIndex = tabs.value.findIndex((tab) => tab.id === tabId)
  let nextIndex = currentIndex
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.value.length
  else if (event.key === 'ArrowLeft')
    nextIndex = (currentIndex - 1 + tabs.value.length) % tabs.value.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = tabs.value.length - 1
  else return

  event.preventDefault()
  const nextTab = tabs.value[nextIndex]
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
  if (/发布|模型|日志|知识库|页面|进程|回滚/.test(`${step.type || ''} ${step.label || ''}`))
    return 'jump'
  return 'check-circle'
}

function workflowRiskLabel(level) {
  return { high: '高风险', medium: '需注意', low: '低风险' }[level] || '未知'
}

function workflowExecutionLabel(value) {
  return (
    {
      'confirmed-external-open': '确认后仅打开外部链接',
      'renderer-navigation-only': '仅允许应用内页面导航',
      'guidance-only': '仅展示建议，不执行操作'
    }[value] || '不允许自动执行'
  )
}

function validWorkflowRoute(target) {
  return [
    '/system-release',
    '/ai-models',
    '/ai-operations',
    '/knowledge-base',
    '/ai-integrations',
    '/node-services'
  ].includes(String(target || '').split('?')[0])
}

async function loadState() {
  const initialLoad = !hasLoaded.value
  if (initialLoad) loading.value = true
  else refreshing.value = true

  try {
    const result = await opsApi.getAiOpsState()
    if (!notify(result, '读取 AI 运维数据失败')) return
    providerState.value = result.providers || providerState.value
    evaluationState.value = result.evaluations || evaluationState.value
    logState.value = result.logs || logState.value
    knowledgeState.value = result.knowledge || knowledgeState.value
    workflowState.value = result.workflows || workflowState.value
    await loadProviderSources()
    const info = await opsApi.getAiMcpInfo()
    if (info?.ok) mcpInfo.value = info
    hasLoaded.value = true
  } catch (error) {
    MessagePlugin.error({
      content: error.message || '读取 AI 运维数据失败',
      placement: 'bottom-right'
    })
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function loadProviderSources() {
  sourceLoading.value = true
  sourceError.value = ''
  try {
    const result = await opsApi.listAiProviderSources()
    if (!result?.ok) {
      sourceError.value = result?.error || '读取模型可靠性 Provider 失败'
      return
    }
    providerSources.value = result.sources || []
    const selectedSource = providerSources.value.find(
      (source) => sourceKey(source) === sourceSelection.value.sourceKey
    )
    if (!selectedSource) {
      sourceSelection.value = { sourceKey: '', model: '' }
    } else if (
      !selectedSource.models.some((model) => model.model === sourceSelection.value.model)
    ) {
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
    const result = await opsApi.addAiProviderFromModelReliability({
      sourceProviderId: source.id,
      sourceAppType: source.appType,
      model
    })
    if (!notify(result, '一键配置 Provider 失败')) return
    await loadState()
    MessagePlugin.success({
      content: '已从模型可靠性一键配置并设为默认 Provider',
      placement: 'bottom-right'
    })
  } finally {
    savingProvider.value = false
  }
}

async function activateProvider(id) {
  activatingProviderId.value = id
  try {
    const result = await opsApi.activateAiProvider(id)
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
    const result = await opsApi.testAiProvider(id)
    if (notify(result, '连接测试失败'))
      MessagePlugin.success({
        content: `连接正常：${result.content}`,
        placement: 'bottom-right',
        duration: 5000
      })
  } finally {
    testingProviderId.value = ''
  }
}

async function removeProvider(provider) {
  if (
    !(await confirm({
      title: '从 AI 功能中移除 Provider',
      content: `确定移除“${provider.name} · ${provider.model}”吗？不会删除模型可靠性中的原始 Provider。`,
      theme: 'warning'
    }))
  )
    return
  busy.value = true
  try {
    const result = await opsApi.deleteAiProvider(provider.id)
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
  caseForm.value = {
    ...newCase(),
    ...item,
    expectedKeywords: (item.expectedKeywords || []).join(', ')
  }
}

async function persistCases(next) {
  const result = await opsApi.saveAiEvaluationCases(next)
  if (notify(result, '保存评测用例失败'))
    evaluationState.value = { ...evaluationState.value, cases: result.cases }
  return result?.ok
}

async function upsertCase() {
  try {
    const form = caseForm.value
    if (!form.prompt.trim()) throw new Error('请输入提示词')
    const item = { ...form, expectedKeywords: form.expectedKeywords }
    const index = evaluationCases.value.findIndex((row) => row.id === item.id)
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
  if (await persistCases(evaluationCases.value.filter((item) => item.id !== id))) resetCaseForm()
}

async function runEvaluation() {
  busy.value = true
  try {
    const result = await opsApi.runAiEvaluation({
      providerId: providerState.value.activeProviderId
    })
    if (notify(result, '运行评测失败')) {
      evaluationState.value = {
        ...evaluationState.value,
        runs: [result.run, ...(evaluationState.value.runs || [])]
      }
      evaluationFilter.value = 'all'
      MessagePlugin.success({
        content: `评测完成：${result.run.summary.passed}/${result.run.summary.total} 通过`,
        placement: 'bottom-right'
      })
    }
  } finally {
    busy.value = false
  }
}

async function analyzeLog() {
  busy.value = true
  try {
    const result = await opsApi.analyzeAiLog({
      ...logForm.value,
      providerId: providerState.value.activeProviderId
    })
    if (notify(result, '日志分析失败')) {
      logState.value = { ...logState.value, items: [result.item, ...logs.value] }
      logForm.value = { title: '', text: '', useAi: logForm.value.useAi }
      MessagePlugin.success({ content: '日志已脱敏分析并保存', placement: 'bottom-right' })
    }
  } finally {
    busy.value = false
  }
}

function attachLogToAiChat(item) {
  const findings = (item.findings || []).map(
    (finding) => `${finding.type || '异常'}：${finding.count || 0} 条`
  )
  addAiContextAttachment({
    source: '日志分析',
    title: item.title || '日志分析结果',
    content: [item.headline, ...findings, item.aiSummary, item.excerpt].filter(Boolean).join('\n'),
    metadata: {
      level: riskLabel(item.level),
      lines: item.lineCount,
      analyzedAt: formatTime(item.createdAt)
    }
  })
  MessagePlugin.success({ content: '日志证据已附加到 AI 对话', placement: 'bottom-right' })
}

async function saveKnowledge() {
  busy.value = true
  try {
    const payload = {
      ...knowledgeForm.value,
      id: knowledgeEditingId.value || undefined,
      tags: knowledgeForm.value.tags
    }
    const result = await opsApi.saveAiKnowledge(payload)
    if (notify(result, '保存知识失败')) {
      knowledgeState.value = {
        ...knowledgeState.value,
        documents: [
          result.document,
          ...knowledgeDocuments.value.filter((item) => item.id !== result.document.id)
        ]
      }
      knowledgeForm.value = { title: '', tags: '', content: '' }
      knowledgeEditingId.value = ''
      MessagePlugin.success({ content: '知识文档已脱敏保存', placement: 'bottom-right' })
    }
  } finally {
    busy.value = false
  }
}

function editKnowledge(doc) {
  knowledgeEditingId.value = doc.id
  knowledgeForm.value = {
    title: doc.title || '',
    tags: (doc.tags || []).join(', '),
    content: doc.content || ''
  }
  knowledgeReadingDoc.value = null
}

function cancelEditKnowledge() {
  knowledgeEditingId.value = ''
  knowledgeForm.value = { title: '', tags: '', content: '' }
}

function readKnowledge(doc) {
  knowledgeReadingDoc.value = doc
}

function closeReader() {
  knowledgeReadingDoc.value = null
}

function knowledgeSourceLabel(source = {}) {
  if (source.type === 'directory')
    return `目录：${source.collection ? `${source.collection}/` : ''}${source.name || '文档'}`
  if (source.type === 'file') return `来源：${source.name || '本地文件'}`
  return '手动录入'
}

async function exportKnowledge(doc) {
  busy.value = true
  try {
    const result = await opsApi.exportAiKnowledge({
      title: doc.title,
      tags: doc.tags,
      content: doc.content
    })
    if (result?.ok) MessagePlugin.success({ content: '文档已导出', placement: 'bottom-right' })
    else if (!result?.canceled) notify(result, '导出失败')
  } finally {
    busy.value = false
  }
}

function highlightKnowledge(content, matchedTerms) {
  // XSS-safe: content is HTML-escaped before any <mark> markup is inserted,
  // and match text always originates from the escaped string.
  let html = String(content || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const terms = Array.from(
    new Set(
      (Array.isArray(matchedTerms) ? matchedTerms : []).filter((term) => term && term.length >= 2)
    )
  ).sort((a, b) => b.length - a.length)
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    html = html.replace(new RegExp(escaped, 'gi'), (match) => `<mark>${match}</mark>`)
  }
  return html
}

function attachKnowledgeToAiChat(item, index) {
  addAiContextAttachment({
    source: '知识库检索',
    title: item.title || `检索结果 ${index + 1}`,
    content: item.content,
    metadata: {
      documentId: item.documentId,
      lines: `${item.startLine || '—'}-${item.endLine || '—'}`,
      score: item.score
    }
  })
  MessagePlugin.success({ content: '知识库证据已附加到 AI 对话', placement: 'bottom-right' })
}

async function importKnowledge() {
  busy.value = true
  try {
    const filePath = await opsApi.browseFile({
      filters: [
        { name: '支持的知识文档', extensions: ['md', 'txt', 'log', 'json', 'yml', 'yaml', 'conf'] }
      ]
    })
    if (!filePath) return
    const result = await opsApi.importAiKnowledge(filePath)
    if (notify(result, '导入知识文档失败')) {
      knowledgeState.value = {
        ...knowledgeState.value,
        documents: [result.document, ...knowledgeDocuments.value]
      }
      MessagePlugin.success({
        content: '文档已脱敏导入，回答时会展示来源与行号',
        placement: 'bottom-right'
      })
    }
  } finally {
    busy.value = false
  }
}

async function importKnowledgeDirectory() {
  busy.value = true
  try {
    const result = await opsApi.importAiKnowledgeDirectory()
    if (result?.canceled) return
    if (!notify(result, '导入知识目录失败')) return
    knowledgeState.value = result.state || knowledgeState.value
    const summary = result.summary || {}
    knowledgeImportSummary.value = `${summary.collection || '知识目录'}：新增 ${summary.imported || 0}，更新 ${summary.updated || 0}，未变化 ${summary.unchanged || 0}，跳过 ${summary.skipped || 0}${summary.truncated ? '；已达到安全扫描上限' : ''}`
    MessagePlugin.success({
      content: '目录已完成脱敏增量导入，未变化文档不会重复写入',
      placement: 'bottom-right'
    })
  } finally {
    busy.value = false
  }
}

async function removeKnowledge(id) {
  if (
    !(await confirm({
      title: '删除知识文档',
      content: '确定删除该本地知识文档吗？',
      theme: 'warning'
    }))
  )
    return
  const result = await opsApi.deleteAiKnowledge(id)
  if (notify(result))
    knowledgeState.value = { ...knowledgeState.value, documents: result.documents }
}

async function searchKnowledge() {
  if (!knowledgeQuery.value.trim()) return
  busy.value = true
  searched.value = false
  try {
    const result = await opsApi.searchAiKnowledge(knowledgeQuery.value)
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
    const result = await opsApi.answerAiKnowledge({
      query: knowledgeQuery.value,
      useAi: knowledgeUseAi.value,
      providerId: providerState.value.activeProviderId
    })
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
    const result = await opsApi.planAiWorkflow(workflowPrompt.value)
    if (notify(result, '生成工作流失败')) {
      workflowPlan.value = result.plan
      workflowState.value = {
        ...workflowState.value,
        history: [
          result.plan,
          ...(workflowState.value.history || []).filter((item) => item.id !== result.plan.id)
        ]
      }
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

async function navigateWorkflowStep(step) {
  if (step?.type !== 'navigate' || !step.target || !workflowPlan.value?.id) return
  if (!validWorkflowRoute(step.target)) {
    MessagePlugin.error({ content: '该页面步骤无效，请重新生成工作流', placement: 'bottom-right' })
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
      planId: workflowPlan.value.id,
      stepIds: [step.id],
      confirmed
    })
    if (!notify(result, '审批页面步骤失败')) return
    const completed = result.completed || []
    const navigation = completed.find((item) => item.status === 'requires-user-navigation')
    if (!navigation || !validWorkflowRoute(navigation.target)) {
      MessagePlugin.error({ content: '页面步骤未通过主进程校验', placement: 'bottom-right' })
      return
    }
    workflowExecution.value = {
      handled: completed.length,
      opened: 0,
      navigation: 1,
      audited: result.approval?.audited === true
    }
    await router.push(String(navigation.target))
  } finally {
    busy.value = false
  }
}

async function executeWorkflow() {
  if (!workflowPlan.value?.id || !workflowExternalSteps.value.length) return
  if (
    !(await confirm({
      title: '确认打开外部链接',
      content:
        '只会打开预览中列出的外部地址，不会自动提交数据，也不会执行发布、删除、回滚或进程操作。确认继续吗？',
      theme: 'warning'
    }))
  )
    return
  busy.value = true
  try {
    const result = await opsApi.executeAiWorkflow({
      planId: workflowPlan.value.id,
      stepIds: workflowExternalSteps.value.map((step) => step.id),
      confirmed: true
    })
    if (notify(result, '执行工作流失败')) {
      const completed = result.completed || []
      workflowExecution.value = {
        handled: completed.length,
        opened: completed.filter((step) => step.status === 'done').length,
        navigation: completed.filter((step) => step.status === 'requires-user-navigation').length,
        audited: result.approval?.audited === true
      }
      MessagePlugin.success({
        content: workflowExecution.value.opened
          ? `已打开 ${workflowExecution.value.opened} 个外部链接，审批已记录`
          : '此计划没有可执行的外部打开步骤',
        placement: 'bottom-right'
      })
    }
  } finally {
    busy.value = false
  }
}

watch(
  () => sourceSelection.value.sourceKey,
  () => {
    sourceSelection.value.model = ''
  }
)

watch(
  [tabs, () => route.query.tab],
  ([availableTabs, routeTab]) => {
    activeTab.value = availableTabs.some((item) => item.id === routeTab)
      ? routeTab
      : availableTabs[0]?.id || 'providers'
  },
  { immediate: true }
)

watch(activeTab, (tab) => {
  if (tab === 'mcp' && !mcpInfo.value) loadState()
})

onMounted(loadState)
onActivated(() => {
  if (hasLoaded.value) loadState()
})
</script>

<style scoped src="./styles.css"></style>
