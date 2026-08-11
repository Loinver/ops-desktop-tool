<template>
  <div class="page page--workspace ai-chat-page">
    <PageHeader :title="title" :description="description">
      <template #actions>
        <button class="btn-secondary" type="button" :disabled="chatBusy" @click="newChat">
          <t-icon name="add" /> 新对话
        </button>
        <button
          class="btn-secondary"
          type="button"
          :disabled="chatBusy || chatMessages.length === 0"
          @click="exportChat('markdown')"
        >
          <t-icon name="download" /> 导出 MD
        </button>
        <button
          class="btn-secondary"
          type="button"
          :disabled="chatBusy || chatMessages.length === 0"
          @click="exportChat('json')"
        >
          <t-icon name="file-code" /> 导出 JSON
        </button>
        <button
          class="btn-text"
          type="button"
          :disabled="chatBusy || chatMessages.length === 0"
          @click="clearChat"
        >
          <t-icon name="trash" /> 清空
        </button>
        <button
          v-if="!activeProviderReady"
          class="btn-primary"
          type="button"
          @click="configureProvider"
        >
          <t-icon name="server" /> 配置 Provider
        </button>
      </template>
    </PageHeader>

    <main class="page-content chat-page-content">
      <section class="surface-panel chat-workspace" aria-label="AI 对话工作区">
        <ChatSessionSidebar
          :sessions="chatSessions"
          :active-id="activeSessionId"
          :busy="chatBusy"
          @select="selectSession"
          @rename="renameSession"
          @delete="deleteSession"
        />

        <section class="chat-conversation" aria-label="当前 AI 对话">
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
            <label class="knowledge-toggle checkbox-row">
              <input v-model="knowledgeUseAi" type="checkbox" />
              <span>基于检索结果回答</span>
            </label>
            <button
              class="btn-secondary knowledge-search-button"
              type="button"
              @click="searchKnowledge"
            >
              检索
            </button>
          </div>

          <div
            ref="chatHistory"
            :class="['chat-history', { 'chat-history--empty': chatMessages.length === 0 }]"
            aria-live="polite"
          >
            <div v-if="chatMessages.length" class="chat-history__status">
              <span><t-icon name="chat" /> {{ activeChatSession?.title || '当前会话' }}</span>
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
                  <button
                    type="button"
                    :title="message.role === 'assistant' ? '复制回答' : '复制提问'"
                    @click="copyMessage(message)"
                  >
                    <t-icon name="file-copy" /> 复制
                  </button>
                </div>
              </div>
            </article>

            <article
              v-if="chatBusy"
              class="chat-message chat-message--assistant chat-message--pending"
            >
              <div class="message-avatar" aria-hidden="true"><t-icon name="chat" /></div>
              <div class="message-stack">
                <div class="message-meta"><strong>智能助手</strong></div>
                <div :class="['message-bubble', { 'message-bubble--thinking': !streamingReply }]">
                  <template v-if="streamingReply">
                    <p class="message-content message-content--streaming">{{ streamingReply }}</p>
                  </template>
                  <template v-else>
                    <t-icon name="loading" class="spinning" /> 正在思考，请稍候…
                  </template>
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
              <span>请先在模型可靠性配置 Provider，并在模型中心一键添加为默认模型。</span>
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
                <span class="composer-shortcut">Enter 发送 · Shift + Enter 换行</span>
                <div class="composer-actions">
                  <button
                    v-if="activeProvider"
                    class="provider-switch"
                    type="button"
                    :disabled="chatBusy"
                    @click="switchProvider"
                  >
                    <t-icon name="refresh" /> 切换模型
                  </button>
                  <button
                    v-if="chatBusy"
                    class="send-button send-button--stop"
                    type="button"
                    :aria-label="cancelRequested ? '正在停止生成' : '停止生成'"
                    :disabled="cancelRequested"
                    @click="cancelAiChat"
                  >
                    <t-icon name="stop-circle" :class="{ spinning: cancelRequested }" />
                    <span>{{ cancelRequested ? '停止中…' : '停止' }}</span>
                  </button>
                  <button
                    v-else
                    class="send-button"
                    type="button"
                    aria-label="发送问题"
                    :disabled="!activeProviderReady || !chatInput.trim()"
                    @click="sendAiChat"
                  >
                    <t-icon name="arrow-up" />
                    <span>发送</span>
                  </button>
                </div>
              </div>
            </div>
            <p class="composer-note">
              <t-icon name="secured" /> API Key 仅在主进程使用；提交内容会先脱敏常见密钥、Token
              和密码字段。
            </p>
          </footer>
        </section>
      </section>
    </main>
  </div>
</template>

<script setup>
import { opsApi } from '../../api/opsApi.js'
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PageHeader from '../../components/common/PageHeader.vue'
import { useConfirm } from '../../composables/useConfirm'
import ChatSessionSidebar from './ChatSessionSidebar.vue'
import {
  CHAT_SESSIONS_STORAGE_KEY,
  DEFAULT_CHAT_SESSION_TITLE,
  LEGACY_CHAT_HISTORY_STORAGE_KEY,
  MAX_CHAT_SESSIONS,
  MAX_CHAT_SESSION_TITLE_LENGTH,
  chatHistoryToMarkdown,
  chatSessionToJson,
  createChatSession,
  deriveChatSessionTitle,
  normalizeChatHistory,
  normalizeChatSessions,
  serializeChatSessions
} from './chat-history.js'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'

defineOptions({ name: 'AiChat' })

const router = useRouter()
const { confirm } = useConfirm()
const title = 'AI 对话'
const description = '使用模型可靠性来源的一键配置 Provider 进行多轮对话，并按需关联本地知识库。'

const chatMessages = ref([])
const chatSessions = ref([])
const activeSessionId = ref('')
const chatInput = ref('')
const chatBusy = ref(false)
const chatError = ref('')
const retryableChatError = ref(false)
const streamingReply = ref('')
const cancelRequested = ref(false)

const knowledgeQuery = ref('')
const knowledgeUseAi = ref(false)
const knowledgeResults = ref([])
const searched = ref(false)

const providerState = ref({ activeProviderId: '', providers: [] })
const activeProvider = computed(
  () =>
    providerState.value.providers.find(
      (provider) => provider.id === providerState.value.activeProviderId
    ) || null
)
const activeProviderReady = computed(() =>
  Boolean(
    activeProvider.value?.enabled &&
    activeProvider.value?.available &&
    activeProvider.value?.hasApiKey
  )
)
const latestUserMessage = computed(
  () => [...chatMessages.value].reverse().find((message) => message.role === 'user') || null
)
const activeChatSession = computed(
  () => chatSessions.value.find((session) => session.id === activeSessionId.value) || null
)

const examplePrompts = [
  '如何为当前项目设计安全的备份策略？',
  '请解释一下 Node.js 的事件循环机制',
  '如何排查 Nginx 配置文件问题？'
]

const chatHistory = ref(null)
const composerInput = ref(null)
let historyStorageWarningShown = false
let activeChatRequestId = ''
let unsubscribeChatStream = null

async function loadProviderState() {
  try {
    const result = await opsApi.getAiOpsState()
    if (result?.ok && Array.isArray(result.providers?.providers)) {
      providerState.value = result.providers
    } else if (!result?.ok) {
      console.error('加载 AI Provider 状态失败', result?.error)
    }
  } catch (error) {
    console.error('加载 AI 状态失败', error)
  }
}

function subscribeToChatStream() {
  const subscribe = opsApi.onAiChatStreamEvent
  if (typeof subscribe !== 'function') return
  unsubscribeChatStream = subscribe((payload) => {
    if (!payload || payload.requestId !== activeChatRequestId || cancelRequested.value) return
    if (payload.type === 'delta' && payload.delta) {
      streamingReply.value = `${streamingReply.value}${String(payload.delta)}`.slice(0, 20_000)
      nextTick(scrollToBottom)
    }
  })
}

onMounted(async () => {
  subscribeToChatStream()
  loadHistory()
  await loadProviderState()
  nextTick(scrollToBottom)
})

onBeforeUnmount(() => {
  unsubscribeChatStream?.()
  unsubscribeChatStream = null
  if (activeChatRequestId)
    void Promise.resolve(opsApi.cancelAiChatStream?.(activeChatRequestId)).catch(() => {})
})

onActivated(loadProviderState)

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function scrollToBottom() {
  if (chatHistory.value) chatHistory.value.scrollTop = chatHistory.value.scrollHeight
}

watch(chatMessages, () => nextTick(scrollToBottom), { deep: true })
watch(knowledgeQuery, () => {
  searched.value = false
  knowledgeResults.value = []
})

function loadHistory() {
  let shouldPersist = false
  try {
    const saved = localStorage.getItem(CHAT_SESSIONS_STORAGE_KEY)
    const legacy = localStorage.getItem(LEGACY_CHAT_HISTORY_STORAGE_KEY)
    let source = null

    if (saved) {
      try {
        source = JSON.parse(saved)
      } catch {
        shouldPersist = true
        MessagePlugin.warning({
          content: '检测到损坏的本机会话数据，已尝试恢复旧对话或创建空白会话',
          placement: 'bottom-right'
        })
      }
    }

    if (!source && legacy) {
      source = JSON.parse(legacy)
      shouldPersist = true
    }

    applyChatState(normalizeChatSessions(source))
    if (!saved || shouldPersist) saveHistory()
    else if (legacy) localStorage.removeItem(LEGACY_CHAT_HISTORY_STORAGE_KEY)
  } catch {
    applyChatState(normalizeChatSessions(null))
    saveHistory()
  }
}

function applyChatState(state) {
  const normalized = normalizeChatSessions(state)
  chatSessions.value = normalized.sessions
  activeSessionId.value = normalized.activeSessionId
  chatMessages.value = normalizeChatHistory(
    normalized.sessions.find((session) => session.id === normalized.activeSessionId)?.messages
  )
}

function chatStateSnapshot() {
  return {
    version: 1,
    activeSessionId: activeSessionId.value,
    sessions: chatSessions.value
  }
}

function saveHistory() {
  try {
    const serialized = serializeChatSessions(chatStateSnapshot())
    localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, serialized)
    localStorage.removeItem(LEGACY_CHAT_HISTORY_STORAGE_KEY)
    applyChatState(JSON.parse(serialized))
    return true
  } catch {
    // localStorage 可能被系统策略禁用或被其他页面占满，不能阻断提问流程。
    try {
      const active = activeChatSession.value || createChatSession()
      const fallback = serializeChatSessions({
        version: 1,
        activeSessionId: active.id,
        sessions: [{ ...active, messages: chatMessages.value.slice(-20) }]
      })
      localStorage.removeItem(CHAT_SESSIONS_STORAGE_KEY)
      localStorage.setItem(CHAT_SESSIONS_STORAGE_KEY, fallback)
      localStorage.removeItem(LEGACY_CHAT_HISTORY_STORAGE_KEY)
    } catch {
      // 内存中的当前会话仍然可用，仅不再持久化。
    }
    if (!historyStorageWarningShown) {
      historyStorageWarningShown = true
      MessagePlugin.warning({
        content: '本机暂存空间不足，当前对话仍可使用但可能无法持久化',
        placement: 'bottom-right'
      })
    }
    return false
  }
}

function updateActiveSessionMessages(value, { touch = true, autoTitle = true } = {}) {
  const messages = normalizeChatHistory(value)
  const current = activeChatSession.value || createChatSession()
  const title =
    autoTitle && current.title === DEFAULT_CHAT_SESSION_TITLE && messages.length
      ? deriveChatSessionTitle(messages)
      : current.title
  const updated = {
    ...current,
    title,
    updatedAt: touch ? Date.now() : current.updatedAt,
    messages
  }
  chatMessages.value = messages
  activeSessionId.value = updated.id
  chatSessions.value = [
    updated,
    ...chatSessions.value.filter((session) => session.id !== updated.id)
  ].slice(0, MAX_CHAT_SESSIONS)
  saveHistory()
}

function addMessage(role, content) {
  updateActiveSessionMessages([
    ...chatMessages.value,
    {
      id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role,
      content,
      createdAt: Date.now()
    }
  ])
}

function createChatRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function saveInterruptedReply(suffix) {
  const partial = streamingReply.value.trim()
  if (!partial) return
  addMessage('assistant', `${partial}\n\n${suffix}`)
}

async function requestAssistantReply() {
  const requestId = createChatRequestId()
  activeChatRequestId = requestId
  streamingReply.value = ''
  cancelRequested.value = false
  chatBusy.value = true
  let completed = false
  try {
    const streamRequest = opsApi.askAiChatStream
    const requestOptions = {
      requestId,
      providerId: providerState.value.activeProviderId,
      messages: chatMessages.value.map((message) => ({
        role: message.role,
        content: message.content
      })),
      knowledgeResults: searched.value && knowledgeUseAi.value ? knowledgeResults.value : []
    }
    const result =
      typeof streamRequest === 'function'
        ? await streamRequest(requestOptions)
        : await opsApi.askAiChat(requestOptions)

    if (result?.cancelled) {
      saveInterruptedReply('（已停止生成）')
      chatError.value = '已停止生成，可以重试上一条问题'
      retryableChatError.value = true
      return
    }

    if (!result?.ok) {
      saveInterruptedReply('（响应中断）')
      chatError.value = result?.error || 'AI 对话失败'
      retryableChatError.value = true
      return
    }

    const content = String(result.content || streamingReply.value).trim()
    if (!content) throw new Error('AI 未返回可用文本')
    addMessage('assistant', content)
    if (result.truncated) {
      MessagePlugin.warning({ content: '回答过长，已安全截断', placement: 'bottom-right' })
    }
    retryableChatError.value = false
    completed = true
  } catch (error) {
    const cancelled = cancelRequested.value || error?.code === 'AI_CHAT_CANCELLED'
    if (cancelled) {
      saveInterruptedReply('（已停止生成）')
      chatError.value = '已停止生成，可以重试上一条问题'
      retryableChatError.value = true
    } else {
      saveInterruptedReply('（响应中断）')
      chatError.value = error?.message || 'AI 对话失败，请重试'
      retryableChatError.value = true
      MessagePlugin.error({ content: chatError.value, placement: 'bottom-right' })
    }
  } finally {
    if (activeChatRequestId === requestId) activeChatRequestId = ''
    streamingReply.value = ''
    cancelRequested.value = false
    chatBusy.value = false
    // 检索证据只用于下一次提问；请求失败时保留它，确保“重试”仍使用同一批证据。
    if (completed) searched.value = false
  }
}

async function cancelAiChat() {
  if (!chatBusy.value || !activeChatRequestId || cancelRequested.value) return
  cancelRequested.value = true
  try {
    const result = await opsApi.cancelAiChatStream?.(activeChatRequestId)
    if (result?.ok === false) throw new Error(result.error || '停止生成失败')
  } catch (error) {
    cancelRequested.value = false
    chatError.value = error?.message || '停止生成失败'
    MessagePlugin.error({ content: chatError.value, placement: 'bottom-right' })
  }
}

async function sendAiChat() {
  const prompt = chatInput.value.trim()
  if (!prompt || chatBusy.value) return
  if (!activeProviderReady.value) {
    chatError.value = '请先在模型可靠性完成配置，并在模型中心一键添加默认 Provider'
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
    chatError.value = '请先在模型可靠性完成配置，并在模型中心一键添加默认 Provider'
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

  searched.value = false
  knowledgeResults.value = []
  chatError.value = ''
  try {
    const result = await opsApi.searchAiKnowledge(query)
    if (!result?.ok) {
      chatError.value = result?.error || '知识检索失败'
      return
    }
    knowledgeResults.value = result.results || []
    searched.value = true
    addMessage(
      'assistant',
      knowledgeResults.value.length
        ? `已检索到 ${knowledgeResults.value.length} 条本地知识。开启“基于检索结果回答”后，下一次提问会引用这些片段。`
        : '没有检索到匹配的知识。'
    )
  } catch {
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

function resetTransientChatState() {
  chatInput.value = ''
  chatError.value = ''
  retryableChatError.value = false
  streamingReply.value = ''
  cancelRequested.value = false
  knowledgeQuery.value = ''
  knowledgeResults.value = []
  searched.value = false
}

function selectSession(sessionId) {
  if (chatBusy.value || sessionId === activeSessionId.value) return
  const session = chatSessions.value.find((item) => item.id === sessionId)
  if (!session) return
  activeSessionId.value = session.id
  chatMessages.value = normalizeChatHistory(session.messages)
  resetTransientChatState()
  saveHistory()
  nextTick(scrollToBottom)
}

function renameSession({ id, title: nextTitle }) {
  if (chatBusy.value) return
  const session = chatSessions.value.find((item) => item.id === id)
  if (!session) return
  const normalizedTitle = String(nextTitle || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_CHAT_SESSION_TITLE_LENGTH)
  const title = normalizedTitle || deriveChatSessionTitle(session.messages)
  chatSessions.value = chatSessions.value.map((item) =>
    item.id === id ? { ...item, title, updatedAt: Date.now() } : item
  )
  saveHistory()
}

async function deleteSession(sessionId) {
  if (chatBusy.value) return
  const session = chatSessions.value.find((item) => item.id === sessionId)
  if (!session) return
  const confirmed = await confirm({
    title: '删除 AI 会话',
    message: `确定删除“${session.title}”？`,
    detail: '本机暂存的对话内容将无法恢复。'
  })
  if (!confirmed) return

  let remaining = chatSessions.value.filter((item) => item.id !== sessionId)
  if (!remaining.length) remaining = [createChatSession()]
  chatSessions.value = remaining
  if (sessionId === activeSessionId.value) {
    activeSessionId.value = remaining[0].id
    chatMessages.value = normalizeChatHistory(remaining[0].messages)
    resetTransientChatState()
  }
  saveHistory()
  MessagePlugin.success({ content: '会话已删除', placement: 'bottom-right' })
}

async function clearChat() {
  if (chatBusy.value) return
  if (chatMessages.value.length) {
    const confirmed = await confirm({
      title: '清空当前会话',
      message: '确定清空当前会话的全部消息？',
      detail: '会话名称会保留，此操作无法撤销。'
    })
    if (!confirmed) return
  }
  resetTransientChatState()
  updateActiveSessionMessages([], { autoTitle: false })
}

function exportChat(format = 'markdown') {
  if (chatMessages.value.length === 0) return
  const session = activeChatSession.value || createChatSession({ messages: chatMessages.value })
  const isJson = format === 'json'
  const content = isJson
    ? chatSessionToJson(session)
    : chatHistoryToMarkdown(chatMessages.value, Date.now(), session.title)
  const blob = new Blob([content], {
    type: isJson ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ai-chat-${new Date().toISOString().replace(/[:.]/g, '-')}.${isJson ? 'json' : 'md'}`
  link.click()
  URL.revokeObjectURL(url)
  MessagePlugin.success({
    content: `对话已导出为 ${isJson ? 'JSON' : 'Markdown'}`,
    placement: 'bottom-right'
  })
}

function newChat() {
  if (chatBusy.value) return
  if (chatMessages.value.length === 0 && activeChatSession.value) {
    resetTransientChatState()
    nextTick(() => composerInput.value?.focus())
    MessagePlugin.info({ content: '当前已是空白新对话', placement: 'bottom-right' })
    return
  }
  const session = createChatSession()
  chatSessions.value = [session, ...chatSessions.value].slice(0, MAX_CHAT_SESSIONS)
  activeSessionId.value = session.id
  chatMessages.value = []
  resetTransientChatState()
  saveHistory()
  MessagePlugin.success({ content: '已开始新对话', placement: 'bottom-right' })
  nextTick(() => composerInput.value?.focus())
}

function useSuggestion(suggestion) {
  chatInput.value = suggestion
  nextTick(() => composerInput.value?.focus())
}

function switchProvider() {
  configureProvider()
}

function configureProvider() {
  router.push('/ai-models')
}
</script>

<style scoped>
.ai-chat-page {
  --chat-content-width: 1120px;
  gap: 0;
}

/* PageHeader 仅提供布局；AI 对话在这里定义成组操作按钮的视觉层级。 */
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
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast),
    opacity var(--transition-fast);
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
  flex: 1 1 auto;
  display: flex;
}

.chat-workspace {
  width: min(1280px, 100%);
  min-height: 0;
  height: 100%;
  flex: 1 1 auto;
  display: flex;
  margin: 0 auto;
  overflow: hidden;
}

.chat-conversation {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

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
.composer-actions,
.send-button,
.composer-note {
  display: flex;
  align-items: center;
}

.message-avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: var(--primary);
  background: var(--primary-light);
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
  transition:
    color var(--transition-fast),
    background var(--transition-fast);
}

.provider-switch:hover {
  color: var(--primary);
  background: var(--primary-light);
}

.knowledge-toolbar {
  gap: var(--spacing-sm);
  padding: 8px var(--panel-padding);
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

.knowledge-toolbar input:not([type='checkbox']) {
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
  width: var(--checkbox-size);
  height: var(--checkbox-size);
}

.knowledge-search-button {
  flex: 0 0 auto;
  min-height: var(--control-height-sm);
  padding: 0 12px;
  font-size: 12px;
}

.chat-history {
  position: relative;
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0 var(--panel-padding) clamp(24px, 3vw, 40px);
  background:
    radial-gradient(
      circle at 12% 0,
      color-mix(in srgb, var(--primary) 5%, transparent),
      transparent 26%
    ),
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
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  width: min(var(--chat-content-width), 100%);
  padding: 8px 0 10px;
  margin: 0 auto var(--spacing-md);
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
  width: min(var(--chat-content-width), 100%);
  padding: clamp(28px, 8vh, 88px) 0 var(--spacing-xl);
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
  transition:
    border-color var(--transition),
    box-shadow var(--transition),
    transform var(--transition),
    color var(--transition);
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
  width: min(var(--chat-content-width), 100%);
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
  max-width: min(960px, calc(100% - 40px));
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
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
}

.chat-message--assistant:hover .message-bubble {
  border-color: color-mix(in srgb, var(--primary) 18%, var(--border-light));
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.055);
}

.chat-message--user .message-bubble {
  border-color: color-mix(in srgb, var(--primary) 20%, var(--border-light));
  border-radius: 15px 5px 15px 15px;
  background: linear-gradient(
    135deg,
    var(--primary-light),
    color-mix(in srgb, var(--primary-light) 78%, #fff)
  );
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

.message-content--streaming::after {
  display: inline-block;
  width: 6px;
  height: 1.1em;
  margin-left: 3px;
  vertical-align: -0.18em;
  background: var(--primary);
  content: '';
  animation: stream-caret 0.9s steps(1, end) infinite;
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
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast);
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
  flex: 0 0 auto;
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
  width: min(var(--chat-content-width), 100%);
  margin: 12px auto 0;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--card-bg);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
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
  min-height: 82px;
  padding: 11px 12px;
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

.composer-actions {
  flex: 0 0 auto;
  gap: 4px;
}

.composer-actions .provider-switch {
  height: 32px;
  padding: 0 8px;
  background: var(--bg-subtle);
}

.composer-actions .provider-switch:hover {
  background: var(--primary-light);
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
  transition:
    filter var(--transition-fast),
    transform var(--transition-fast),
    opacity var(--transition-fast);
}

.send-button:hover:not(:disabled) {
  filter: brightness(0.96);
  transform: translateY(-1px);
}

.send-button--stop {
  color: var(--danger);
  background: var(--danger-light);
}

.send-button--stop:hover:not(:disabled) {
  filter: none;
  background: color-mix(in srgb, var(--danger-light) 78%, var(--card-bg));
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
  to {
    transform: rotate(360deg);
  }
}

@keyframes stream-caret {
  50% {
    opacity: 0;
  }
}

@media (max-height: 760px) {
  .ai-chat-page {
    padding-block: var(--spacing-md);
  }

  .ai-chat-page :deep(.page-header) {
    margin-bottom: var(--spacing-md);
  }

  .chat-welcome {
    padding-block: var(--spacing-lg);
  }

  .prompt-suggestions {
    margin-top: var(--spacing-md);
  }

  .suggestion-card {
    min-height: 64px;
    padding: 10px 12px;
  }

  .composer textarea {
    min-height: 56px;
    max-height: 120px;
    padding-block: 8px;
  }

  .composer-note {
    margin-top: var(--spacing-xs);
  }
}

@media (max-width: 760px) {
  .chat-page-content {
    min-height: auto;
  }

  .chat-workspace {
    min-height: 0;
    flex-direction: column;
  }

  .chat-conversation {
    min-height: 480px;
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
    min-height: 0;
    padding: var(--spacing-lg) var(--spacing-md);
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
  .provider-switch {
    font-size: 0;
  }

  .provider-switch :deep(svg) {
    font-size: 16px;
  }

  .knowledge-toolbar input:not([type='checkbox']) {
    flex-basis: 100%;
  }

  .knowledge-toggle {
    flex-basis: 100%;
  }

  .knowledge-search-button {
    flex: 1;
  }

  .composer-shortcut {
    display: none;
  }

  .composer__footer {
    justify-content: flex-end;
  }
}
</style>
