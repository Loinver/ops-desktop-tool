<template>
  <div class="page page--workspace ai-chat-page">
    <PageHeader :title="title" :description="description">
      <template #actions>
        <button class="btn-secondary" type="button" :disabled="chatMessages.length === 0" @click="newChat">
          <t-icon name="add" /> 新对话
        </button>
        <button class="btn-text" type="button" :disabled="chatMessages.length === 0" @click="clearChat">
          <t-icon name="trash" /> 清空
        </button>
        <button v-if="!activeProviderReady" class="btn-primary" type="button" @click="configureProvider">
          <t-icon name="server" /> 配置 Provider
        </button>
      </template>
    </PageHeader>

    <main class="page-content chat-page-content">
      <section class="surface-panel chat-workspace" aria-label="AI 对话工作区">
        <header class="chat-workspace__header">
          <div class="assistant-identity">
            <span class="assistant-identity__icon"><t-icon name="chat" /></span>
            <div>
              <div class="assistant-identity__title-row">
                <h3>智能助手</h3>
                <span :class="['connection-status', { 'connection-status--ready': activeProviderReady }]">
                  <i></i>{{ activeProviderReady ? '已连接' : '需要配置' }}
                </span>
              </div>
              <p>
                <template v-if="activeProvider">
                  {{ activeProvider.name }} <span aria-hidden="true">·</span> {{ activeProvider.model }}
                </template>
                <template v-else>配置默认 Provider 后即可开始对话</template>
              </p>
            </div>
          </div>
          <button v-if="activeProvider" class="provider-switch" type="button" @click="switchProvider">
            <t-icon name="refresh" /> 切换模型
          </button>
        </header>

        <div v-if="activeProviderReady" class="knowledge-toolbar">
          <div class="knowledge-toolbar__label">
            <t-icon name="search" />
            <span>知识库</span>
          </div>
          <input
            v-model="knowledgeQuery"
            aria-label="搜索知识库"
            placeholder="搜索知识库，例如：正式环境如何回滚"
            @keyup.enter="searchKnowledge"
          />
          <label class="knowledge-toggle">
            <input v-model="knowledgeUseAi" type="checkbox" />
            <span>基于检索结果回答</span>
          </label>
          <button class="btn-secondary knowledge-search-button" type="button" @click="searchKnowledge">
            检索
          </button>
        </div>

        <div ref="chatHistory" :class="['chat-history', { 'chat-history--empty': chatMessages.length === 0 }]" aria-live="polite">
          <div v-if="chatMessages.length" class="chat-history__status">
            <span><t-icon name="chat" /> 当前会话</span>
            <small>{{ chatMessages.length }} 条消息 · 本机暂存</small>
          </div>
          <div v-if="chatMessages.length === 0" class="chat-welcome">
            <div class="chat-welcome__eyebrow"><t-icon name="chat" /> AI 工作台</div>
            <h3>今天想解决什么问题？</h3>
            <p>可以直接提问，或用上方知识库补充当前运维上下文。</p>
            <div class="prompt-suggestions" aria-label="快捷提问">
              <button
                v-for="suggestion in examplePrompts"
                :key="suggestion"
                type="button"
                class="suggestion-card"
                :disabled="!activeProviderReady"
                @click="useSuggestion(suggestion)"
              >
                <span>{{ suggestion }}</span>
                <t-icon name="arrow-up" />
              </button>
            </div>
          </div>

          <article
            v-for="message in chatMessages"
            :key="message.id"
            :class="['chat-message', `chat-message--${message.role}`]"
          >
            <div class="message-avatar" aria-hidden="true">
              <t-icon :name="message.role === 'user' ? 'user' : 'chat'" />
            </div>
            <div class="message-stack">
              <div class="message-meta">
                <strong>{{ message.role === 'user' ? '你' : '智能助手' }}</strong>
                <time v-if="message.createdAt">{{ formatTime(message.createdAt) }}</time>
              </div>
              <div class="message-bubble">
                <p class="message-content">{{ message.content }}</p>
              </div>
              <div class="message-actions">
                <button type="button" :title="message.role === 'assistant' ? '复制回答' : '复制提问'" @click="copyMessage(message)">
                  <t-icon name="file-copy" /> 复制
                </button>
              </div>
            </div>
          </article>

          <article v-if="chatBusy" class="chat-message chat-message--assistant chat-message--pending">
            <div class="message-avatar" aria-hidden="true"><t-icon name="chat" /></div>
            <div class="message-stack">
              <div class="message-meta"><strong>智能助手</strong></div>
              <div class="message-bubble message-bubble--thinking">
                <t-icon name="loading" class="spinning" /> 正在思考，请稍候…
              </div>
            </div>
          </article>
        </div>

        <div v-if="chatError" class="form-error chat-error" role="alert">
          <span class="chat-error__content"><t-icon name="error-circle" /> {{ chatError }}</span>
          <button
            v-if="retryableChatError && latestUserMessage"
            class="chat-error__retry"
            type="button"
            :disabled="chatBusy || !activeProviderReady"
            @click="retryLastQuestion"
          >
            <t-icon name="refresh" :class="{ spinning: chatBusy }" /> 重试
          </button>
        </div>

        <footer class="composer-area">
          <div v-if="!activeProviderReady" class="composer-unavailable">
            <t-icon name="info-circle" />
            <span>请先在模型可靠性配置 Provider，并在 AI 能力中心一键添加为默认模型。</span>
            <button type="button" @click="configureProvider">前往配置</button>
          </div>
          <div class="composer" :class="{ 'composer--disabled': !activeProviderReady }">
            <textarea
              v-model="chatInput"
              rows="3"
              maxlength="4000"
              placeholder="输入你的问题…"
              ref="composerInput"
              :disabled="chatBusy || !activeProviderReady"
              @keydown.enter.exact.prevent="sendAiChat"
            />
            <div class="composer__footer">
              <span>Enter 发送 · Shift + Enter 换行</span>
              <button
                class="send-button"
                type="button"
                aria-label="发送问题"
                :disabled="chatBusy || !activeProviderReady || !chatInput.trim()"
                @click="sendAiChat"
              >
                <t-icon :name="chatBusy ? 'loading' : 'arrow-up'" :class="{ spinning: chatBusy }" />
                <span>{{ chatBusy ? '发送中' : '发送' }}</span>
              </button>
            </div>
          </div>
          <p class="composer-note"><t-icon name="secured" /> API Key 仅在主进程使用；提交内容会先脱敏常见密钥、Token 和密码字段。</p>
        </footer>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '../../components/common/PageHeader.vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'

const router = useRouter()
const title = 'AI 问答'
const description = '使用模型可靠性来源的一键配置 Provider 进行多轮对话，并按需关联本地知识库。'

const chatMessages = ref([])
const chatInput = ref('')
const chatBusy = ref(false)
const chatError = ref('')
const retryableChatError = ref(false)

const knowledgeQuery = ref('')
const knowledgeUseAi = ref(false)
const searched = ref(false)

const providerState = ref({ activeProviderId: '', providers: [] })
const activeProvider = computed(() => providerState.value.providers.find(provider => provider.id === providerState.value.activeProviderId) || null)
const activeProviderReady = computed(() => Boolean(activeProvider.value?.enabled && activeProvider.value?.available && activeProvider.value?.hasApiKey))
const latestUserMessage = computed(() => [...chatMessages.value].reverse().find(message => message.role === 'user') || null)

const examplePrompts = [
  '如何为当前项目设计安全的备份策略？',
  '请解释一下 Node.js 的事件循环机制',
  '如何排查 Nginx 配置文件问题？'
]

const chatHistory = ref(null)
const composerInput = ref(null)

onMounted(async () => {
  loadHistory()
  try {
    const result = await window.opsApi.getAiOpsState()
    if (result?.ok && Array.isArray(result.providers?.providers)) {
      providerState.value = result.providers
    } else if (!result?.ok) {
      console.error('加载 AI Provider 状态失败', result?.error)
    }
  } catch (error) {
    console.error('加载 AI 状态失败', error)
  }
  nextTick(scrollToBottom)
})

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function scrollToBottom() {
  if (chatHistory.value) chatHistory.value.scrollTop = chatHistory.value.scrollHeight
}

watch(chatMessages, () => nextTick(scrollToBottom), { deep: true })

function loadHistory() {
  const saved = localStorage.getItem('aiChatHistory')
  if (!saved) return

  try {
    const messages = JSON.parse(saved)
    chatMessages.value = Array.isArray(messages)
      ? messages.map(message => ({ ...message, createdAt: message.createdAt || null }))
      : []
  } catch {
    chatMessages.value = []
  }
}

function saveHistory() {
  localStorage.setItem('aiChatHistory', JSON.stringify(chatMessages.value))
}

function addMessage(role, content) {
  chatMessages.value.push({
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: Date.now()
  })
  saveHistory()
}

async function requestAssistantReply() {
  chatBusy.value = true
  try {
    const result = searched.value && knowledgeUseAi.value && knowledgeQuery.value
      ? await window.opsApi.answerAiKnowledge({
        query: knowledgeQuery.value,
        useAi: true,
        providerId: activeProvider.value?.id
      })
      : await window.opsApi.askAiChat({
        providerId: providerState.value.activeProviderId,
        messages: chatMessages.value.map(message => ({ role: message.role, content: message.content }))
      })

    if (!result?.ok) {
      chatError.value = result?.error || 'AI 问答失败'
      retryableChatError.value = true
      return
    }

    addMessage('assistant', result.content || result.answer || '')
    retryableChatError.value = false
  } catch (error) {
    chatError.value = error?.message || 'AI 问答失败，请重试'
    retryableChatError.value = true
    MessagePlugin.error({ content: chatError.value, placement: 'bottom-right' })
  } finally {
    chatBusy.value = false
    searched.value = false
  }
}

async function sendAiChat() {
  const prompt = chatInput.value.trim()
  if (!prompt || chatBusy.value) return
  if (!activeProviderReady.value) {
    chatError.value = '请先配置、启用并设为默认 Provider'
    retryableChatError.value = false
    return
  }

  addMessage('user', prompt)
  chatInput.value = ''
  chatError.value = ''
  retryableChatError.value = false
  await requestAssistantReply()
}

async function retryLastQuestion() {
  if (chatBusy.value || !latestUserMessage.value) return
  if (!activeProviderReady.value) {
    chatError.value = '请先配置、启用并设为默认 Provider'
    retryableChatError.value = false
    return
  }

  chatError.value = ''
  retryableChatError.value = false
  await requestAssistantReply()
}

async function searchKnowledge() {
  const query = knowledgeQuery.value.trim()
  if (!query) return

  searched.value = true
  chatError.value = ''
  try {
    const result = await window.opsApi.searchAiKnowledge(query)
    if (!result?.ok) {
      chatError.value = result?.error || '知识检索失败'
      return
    }
    addMessage('assistant', result.results?.length ? `已检索到 ${result.results.length} 条知识。现在可以继续提问，我会基于这些结果回答。` : '没有检索到匹配的知识。')
  } catch (error) {
    chatError.value = '知识检索失败'
  }
}

async function copyMessage(message) {
  try {
    await navigator.clipboard.writeText(message.content)
    MessagePlugin.success({ content: '已复制到剪贴板', placement: 'bottom-right' })
  } catch {
    MessagePlugin.error({ content: '复制失败，请手动选择内容', placement: 'bottom-right' })
  }
}

function clearChat() {
  chatMessages.value = []
  chatInput.value = ''
  chatError.value = ''
  retryableChatError.value = false
  saveHistory()
}

function newChat() {
  clearChat()
  MessagePlugin.success({ content: '已开始新对话', placement: 'bottom-right' })
}

function useSuggestion(suggestion) {
  chatInput.value = suggestion
  nextTick(() => composerInput.value?.focus())
}

function switchProvider() {
  configureProvider()
}

function configureProvider() {
  router.push('/ai-ops')
}
</script>

<style scoped>
.ai-chat-page {
  gap: 0;
}

/* PageHeader 仅提供布局；AI 问答在这里定义成组操作按钮的视觉层级。 */
.ai-chat-page :deep(.btn-primary),
.ai-chat-page :deep(.btn-secondary),
.ai-chat-page :deep(.btn-text) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: var(--header-control-height);
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  font-size: var(--header-control-font-size);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast);
}

.ai-chat-page :deep(.btn-primary) {
  color: #fff;
  background: var(--primary);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--primary) 26%, transparent);
}

.ai-chat-page :deep(.btn-primary:hover:not(:disabled)) {
  background: var(--primary-hover);
  box-shadow: 0 4px 10px color-mix(in srgb, var(--primary) 20%, transparent);
  transform: translateY(-1px);
}

.ai-chat-page :deep(.btn-secondary) {
  border-color: var(--border);
  color: var(--text-secondary);
  background: var(--card-bg);
}

.ai-chat-page :deep(.btn-secondary:hover:not(:disabled)) {
  border-color: color-mix(in srgb, var(--primary) 42%, var(--border));
  color: var(--primary);
  background: var(--primary-light);
}

.ai-chat-page :deep(.btn-text) {
  color: var(--text-muted);
  background: transparent;
}

.ai-chat-page :deep(.btn-text:hover:not(:disabled)) {
  color: var(--danger);
  background: var(--danger-light);
}

.ai-chat-page :deep(.btn-primary:disabled),
.ai-chat-page :deep(.btn-secondary:disabled),
.ai-chat-page :deep(.btn-text:disabled) {
  cursor: not-allowed;
  opacity: 0.48;
}

.chat-page-content {
  min-height: 0;
  flex: 1;
  display: flex;
}

.chat-workspace {
  width: min(1180px, 100%);
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 0 auto;
  overflow: hidden;
}

.chat-workspace__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  min-height: 76px;
  padding: var(--spacing-md) var(--panel-padding);
  border-bottom: 1px solid var(--border-light);
}

.assistant-identity,
.assistant-identity__title-row,
.connection-status,
.provider-switch,
.knowledge-toolbar,
.knowledge-toolbar__label,
.knowledge-toggle,
.chat-welcome__eyebrow,
.chat-message,
.message-meta,
.message-actions,
.composer-unavailable,
.composer__footer,
.send-button,
.composer-note {
  display: flex;
  align-items: center;
}

.assistant-identity {
  min-width: 0;
  gap: 12px;
}

.assistant-identity__icon,
.message-avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: var(--primary);
  background: var(--primary-light);
}

.assistant-identity__icon {
  width: 40px;
  height: 40px;
  border: 1px solid color-mix(in srgb, var(--primary) 16%, var(--border-light));
  border-radius: 12px;
  font-size: 20px;
}

.assistant-identity__title-row {
  gap: var(--spacing-sm);
  min-width: 0;
}

.assistant-identity h3 {
  color: var(--text);
  font-size: var(--section-title-size);
  line-height: var(--section-title-line-height);
}

.assistant-identity p {
  overflow: hidden;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-status {
  gap: 5px;
  padding: 3px 7px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--bg-subtle);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.connection-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}

.connection-status--ready {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, var(--bg-subtle));
}

.connection-status--ready i {
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 12%, transparent);
}

.provider-switch {
  flex: 0 0 auto;
  gap: 6px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.provider-switch:hover {
  color: var(--primary);
  background: var(--primary-light);
}

.knowledge-toolbar {
  gap: 10px;
  padding: 10px var(--panel-padding);
  border-bottom: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-subtle) 76%, transparent);
}

.knowledge-toolbar__label {
  flex: 0 0 auto;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.knowledge-toolbar input {
  width: 100%;
  min-width: 120px;
  height: var(--control-height-sm);
  padding: 0 var(--spacing-sm);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  font-size: 13px;
}

.knowledge-toggle {
  flex: 0 0 auto;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.knowledge-toggle input {
  width: auto;
  height: auto;
}

.knowledge-search-button {
  flex: 0 0 auto;
  min-height: var(--control-height-sm);
  padding: 0 12px;
  font-size: 12px;
}

.chat-history {
  position: relative;
  min-height: 240px;
  flex: 1;
  overflow-y: auto;
  padding: clamp(20px, 3vw, 32px) var(--panel-padding);
  background:
    radial-gradient(circle at 12% 0, color-mix(in srgb, var(--primary) 5%, transparent), transparent 26%),
    linear-gradient(180deg, color-mix(in srgb, var(--bg-subtle) 68%, transparent), transparent 34%);
  scroll-behavior: smooth;
}

.chat-history--empty {
  display: grid;
  place-items: center;
}

.chat-history__status {
  position: sticky;
  z-index: 1;
  top: -20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  width: min(800px, 100%);
  padding: 4px 0 14px;
  margin: 0 auto var(--spacing-lg);
  border-bottom: 1px solid color-mix(in srgb, var(--border-light) 84%, transparent);
  color: var(--text-muted);
  background: linear-gradient(180deg, var(--bg-subtle) 55%, transparent);
  font-size: 11px;
  backdrop-filter: blur(8px);
}

.chat-history__status span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-weight: 600;
}

.chat-history__status small {
  color: var(--text-muted);
  font-size: 11px;
}

.chat-welcome {
  width: min(920px, 100%);
  padding: clamp(20px, 6vh, 72px) 0 var(--spacing-xl);
  margin: auto;
}

.chat-welcome__eyebrow {
  gap: 6px;
  margin-bottom: var(--spacing-sm);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.chat-welcome h3 {
  color: var(--text);
  font-size: clamp(24px, 3vw, 32px);
  letter-spacing: -0.04em;
  line-height: 1.25;
}

.chat-welcome > p {
  margin-top: 10px;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 22px;
}

.prompt-suggestions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: var(--spacing-lg);
}

.suggestion-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm);
  min-height: 88px;
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: var(--card-bg);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  transition: border-color var(--transition), box-shadow var(--transition), transform var(--transition), color var(--transition);
}

.suggestion-card :deep(svg) {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--primary);
  transform: rotate(45deg);
}

.suggestion-card:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--primary) 42%, var(--border-light));
  box-shadow: var(--shadow-sm);
  color: var(--text);
  transform: translateY(-2px);
}

.suggestion-card:disabled {
  opacity: 0.55;
}

.chat-message {
  align-items: flex-start;
  gap: 10px;
  width: min(980px, 100%);
  margin: 0 auto;
  transition: transform var(--transition-fast);
}

.chat-message + .chat-message {
  margin-top: var(--spacing-lg);
}

.chat-message:hover {
  transform: translateY(-1px);
}

.message-avatar {
  width: 30px;
  height: 30px;
  margin-top: 2px;
  border-radius: 10px;
  font-size: 15px;
}

.chat-message--user {
  flex-direction: row-reverse;
}

.chat-message--user .message-avatar {
  color: var(--text-secondary);
  background: var(--bg-subtle);
}

.message-stack {
  min-width: 0;
  max-width: min(820px, calc(100% - 40px));
}

.message-meta {
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin: 0 2px 5px;
  color: var(--text-muted);
  font-size: 11px;
}

.message-meta strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.message-meta time {
  color: var(--text-muted);
  white-space: nowrap;
}

.chat-message--user .message-meta {
  flex-direction: row-reverse;
}

.message-bubble {
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--border-light) 92%, transparent);
  border-radius: 5px 15px 15px;
  color: var(--text);
  background: color-mix(in srgb, var(--card-bg) 96%, var(--bg-subtle));
  box-shadow: 0 2px 7px rgba(15, 23, 42, 0.035);
  font-size: 14px;
  line-height: 1.72;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), background var(--transition-fast);
}

.chat-message--assistant:hover .message-bubble {
  border-color: color-mix(in srgb, var(--primary) 18%, var(--border-light));
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.055);
}

.chat-message--user .message-bubble {
  border-color: color-mix(in srgb, var(--primary) 20%, var(--border-light));
  border-radius: 15px 5px 15px 15px;
  background: linear-gradient(135deg, var(--primary-light), color-mix(in srgb, var(--primary-light) 78%, #fff));
  box-shadow: 0 2px 8px color-mix(in srgb, var(--primary) 8%, transparent);
}

.message-bubble--thinking {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}

.message-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-actions {
  gap: 4px;
  margin-top: 4px;
}

.chat-message--user .message-actions {
  justify-content: flex-end;
}

.message-actions button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: var(--bg-subtle);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  opacity: 1;
  transition: color var(--transition-fast), border-color var(--transition-fast), background var(--transition-fast);
}

.message-actions button:hover {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--border-light));
  color: var(--primary);
  background: var(--primary-light);
}

.chat-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  margin: 0 var(--panel-padding) var(--spacing-sm);
}

.chat-error__content {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

.chat-error__retry {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--danger) 25%, var(--border-light));
  border-radius: var(--radius-sm);
  color: var(--danger);
  background: var(--card-bg);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.chat-error__retry:hover:not(:disabled) {
  background: var(--danger-light);
}

.chat-error__retry:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.composer-area {
  padding: 0 var(--panel-padding) var(--spacing-md);
  border-top: 1px solid var(--border-light);
  background: var(--card-bg);
}

.composer-unavailable {
  gap: 7px;
  padding: 10px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 18px;
}

.composer-unavailable :deep(svg) {
  flex: 0 0 auto;
  color: var(--warning);
}

.composer-unavailable button {
  padding: 0;
  border: 0;
  color: var(--primary);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.composer {
  margin-top: var(--spacing-md);
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-bg);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.composer:focus-within {
  border-color: color-mix(in srgb, var(--primary) 56%, var(--border));
  box-shadow: var(--focus-ring);
}

.composer--disabled {
  background: var(--bg-subtle);
}

.composer textarea {
  display: block;
  width: 100%;
  min-height: 74px;
  padding: 10px;
  border: 0;
  outline: 0;
  resize: vertical;
  background: transparent;
  box-shadow: none;
  font-size: 14px;
  line-height: 21px;
}

.composer textarea:focus {
  border: 0;
  box-shadow: none;
}

.composer__footer {
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: 0 4px 2px 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.send-button {
  justify-content: center;
  gap: 6px;
  min-width: 76px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  color: #fff;
  background: var(--primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  transition: filter var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast);
}

.send-button:hover:not(:disabled) {
  filter: brightness(0.96);
  transform: translateY(-1px);
}

.send-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.composer-note {
  gap: 5px;
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 16px;
}

.composer-note :deep(svg) {
  flex: 0 0 auto;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 760px) {
  .chat-page-content {
    min-height: auto;
  }

  .chat-workspace {
    min-height: 620px;
  }

  .chat-workspace__header {
    align-items: flex-start;
    min-height: 0;
    padding: var(--spacing-md);
  }

  .provider-switch {
    padding-right: 0;
  }

  .knowledge-toolbar {
    align-items: stretch;
    flex-wrap: wrap;
    padding: 10px var(--spacing-md);
  }

  .knowledge-toolbar__label {
    width: 100%;
  }

  .knowledge-toggle {
    flex: 1;
  }

  .chat-history {
    min-height: 300px;
    padding: var(--spacing-lg) var(--spacing-md);
  }

  .chat-history__status {
    top: -24px;
  }

  .prompt-suggestions {
    grid-template-columns: 1fr;
  }

  .suggestion-card {
    min-height: 0;
  }

  .composer-area {
    padding: 0 var(--spacing-md) var(--spacing-md);
  }

  .composer-unavailable {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .composer-unavailable button {
    width: 100%;
    padding-left: 20px;
    text-align: left;
  }
}

@media (max-width: 480px) {
  .assistant-identity__title-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .assistant-identity p {
    max-width: 190px;
  }

  .provider-switch {
    font-size: 0;
  }

  .provider-switch :deep(svg) {
    font-size: 16px;
  }

  .knowledge-toolbar input {
    flex-basis: 100%;
  }

  .knowledge-toggle {
    flex-basis: 100%;
  }

  .knowledge-search-button {
    flex: 1;
  }

  .composer__footer > span {
    display: none;
  }

  .composer__footer {
    justify-content: flex-end;
  }
}
</style>
