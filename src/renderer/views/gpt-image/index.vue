<template>
  <div class="page page--workspace">
    <div class="page-header">
      <div class="page-heading header-left">
        <div class="page-eyebrow"><t-icon name="image" /> AI IMAGE LAB</div>
        <h2 class="page-title">图像生成</h2>
        <p class="page-desc">调用 OpenAI 兼容图像模型生成、管理和保存图片</p>
      </div>
      <div class="page-actions header-actions">
        <div class="model-summary">
          <span>{{ config.model || '未设置模型' }}</span>
          <span>{{ config.size }}</span>
          <span>{{ config.quality }}</span>
        </div>
        <button type="button" class="btn-ghost" @click="openHistory">
          <t-icon name="history" />
          <span>历史记录</span>
        </button>
        <button type="button" class="btn-ghost" @click="clearConversation">
          <t-icon name="clear" />
          <span>新对话</span>
        </button>
        <button type="button" class="btn-ghost primary" @click="openSettings">
          <t-icon name="setting" />
          <span>模型设置</span>
        </button>
      </div>
    </div>

    <div class="workspace">
      <section class="chat-pane">
        <div ref="messagesEl" class="messages">
          <div v-if="messages.length === 0" class="empty-state">
            <div class="empty-icon">
              <t-icon name="image" />
            </div>
            <h3>暂无图片</h3>
            <p>输入描述后开始生成，也可以从下面的示例开始</p>
            <div class="prompt-suggestions">
              <button
                type="button"
                v-for="suggestion in promptSuggestions"
                :key="suggestion"
                @click="useSuggestion(suggestion)"
              >
                {{ suggestion }}
              </button>
            </div>
          </div>

          <article v-for="message in messages" :key="message.id" :class="['message', message.role]">
            <div class="message-meta">
              <span>{{ message.role === 'user' ? '你' : 'AI 生图' }}</span>
              <time>{{ message.time }}</time>
              <span
                v-if="message.role === 'assistant' && message.durationText"
                class="duration-chip"
              >
                <t-icon name="time" />
                {{ message.loading ? '已用' : '用时' }} {{ message.durationText }}
              </span>
            </div>

            <p v-if="message.text" class="message-text">{{ message.text }}</p>

            <div v-if="message.loading" class="generating">
              <span class="spinner"></span>
              <span>生成中...</span>
            </div>

            <div v-if="message.error" class="error-box">
              {{ message.error }}
            </div>

            <figure v-if="message.imageUrl" class="image-result">
              <img :src="message.imageUrl" alt="AI 生图 生成结果" />
              <figcaption v-if="message.revisedPrompt">{{ message.revisedPrompt }}</figcaption>
              <div class="image-actions">
                <button type="button" class="btn-download" @click="continueFromMessage(message)">
                  <t-icon name="edit" />
                  <span>继续调整</span>
                </button>
                <button
                  type="button"
                  class="btn-download"
                  :disabled="isDownloading(message.id)"
                  @click="downloadImage(message)"
                >
                  <t-icon name="download" />
                  <span>{{ isDownloading(message.id) ? '准备下载…' : '下载' }}</span>
                </button>
              </div>
            </figure>
          </article>
        </div>

        <form class="composer" @submit.prevent="sendMessage">
          <div class="composer-input">
            <input
              v-model="draft"
              type="text"
              placeholder="描述图片，或继续说想怎么调整..."
              :disabled="generating"
            />
          </div>
          <span class="composer-hint">{{
            config.hasApiKey ? 'Enter 发送' : '请先设置 API Key'
          }}</span>
          <button class="btn-send" type="submit" :disabled="generating || !draft.trim()">
            <t-icon name="send" />
            <span>{{ generating ? '生成中' : '发送' }}</span>
          </button>
        </form>
      </section>
    </div>

    <Teleport to="body">
      <div v-if="showSettings" class="modal-mask">
        <div
          class="settings-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gpt-image-settings-title"
        >
          <div class="dialog-header">
            <div>
              <h3 id="gpt-image-settings-title">模型设置</h3>
              <p>配置 OpenAI 兼容图片生成接口</p>
            </div>
            <button
              type="button"
              class="icon-button"
              title="关闭"
              aria-label="关闭"
              @click="closeSettings"
            >
              <t-icon name="close" />
            </button>
          </div>

          <div class="settings-grid">
            <label class="field wide">
              <span>Base URL</span>
              <input
                v-model.trim="settingsConfig.baseUrl"
                type="text"
                placeholder="https://api.openai.com/v1"
              />
            </label>

            <label class="field wide">
              <span>API Key</span>
              <input
                v-model.trim="settingsConfig.apiKey"
                type="password"
                :placeholder="
                  config.hasApiKey ? `${config.apiKeyMasked}（留空表示不修改）` : 'sk-...'
                "
                autocomplete="off"
                @input="clearApiKey = false"
              />
              <small v-if="config.hasApiKey" class="field-help"
                >API Key 已由系统安全存储加密保存。</small
              >
            </label>

            <label v-if="config.hasApiKey" class="toggle-row checkbox-row wide">
              <input v-model="clearApiKey" type="checkbox" />
              <span>清除已保存的 API Key</span>
            </label>

            <label class="field wide">
              <span>Model</span>
              <div class="model-picker">
                <select v-model="settingsConfig.model" :disabled="modelLoading">
                  <option v-for="model in selectableModels" :key="model" :value="model">
                    {{ model }}
                  </option>
                </select>
                <button
                  type="button"
                  class="btn-ghost model-refresh"
                  :disabled="modelLoading"
                  @click="loadModels"
                >
                  <t-icon name="refresh" :class="{ spinning: modelLoading }" />
                  <span>{{ modelLoading ? '获取中' : '刷新模型' }}</span>
                </button>
              </div>
              <em v-if="modelError" class="field-error">{{ modelError }}</em>
            </label>

            <label class="field">
              <span>尺寸</span>
              <select v-model="settingsConfig.size">
                <option value="auto">Auto</option>
                <option value="1024x1024">1024 x 1024</option>
                <option value="1024x1536">1024 x 1536</option>
                <option value="1536x1024">1536 x 1024</option>
              </select>
            </label>

            <label class="field">
              <span>质量</span>
              <select v-model="settingsConfig.quality">
                <option value="auto">Auto</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>

            <label class="toggle-row checkbox-row wide">
              <input v-model="useContext" type="checkbox" />
              <span>携带最近对话上下文</span>
            </label>
          </div>

          <div class="dialog-actions">
            <button type="button" class="btn-ghost" @click="closeSettings">取消</button>
            <button type="button" class="btn-send compact" :disabled="saving" @click="saveConfig">
              <t-icon name="save" />
              <span>{{ saving ? '保存中' : '保存' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="showHistory" class="modal-mask">
        <div
          class="history-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gpt-image-history-title"
        >
          <div class="dialog-header">
            <div>
              <h3 id="gpt-image-history-title">历史记录</h3>
              <p>{{ historyItems.length }} 张图片</p>
            </div>
            <button
              type="button"
              class="icon-button"
              title="关闭"
              aria-label="关闭"
              @click="closeHistory"
            >
              <t-icon name="close" />
            </button>
          </div>

          <div class="history-toolbar">
            <button type="button" class="btn-ghost" :disabled="historyLoading" @click="loadHistory">
              <t-icon name="refresh" :class="{ spinning: historyLoading }" />
              <span>{{ historyLoading ? '加载中' : '刷新' }}</span>
            </button>
            <button
              type="button"
              class="btn-ghost danger"
              :disabled="historyItems.length === 0"
              @click="clearHistory"
            >
              <t-icon name="delete" />
              <span>清空历史</span>
            </button>
          </div>

          <div v-if="historyItems.length === 0" class="history-empty">
            <t-icon name="image" />
            <span>暂无生成记录</span>
          </div>

          <div v-else class="history-grid">
            <button
              type="button"
              v-for="item in historyItems"
              :key="item.id"
              class="history-card"
              @click="openHistoryItem(item)"
            >
              <img :src="item.imageUrl" alt="历史生成图片" />
              <div class="history-body">
                <strong>{{ item.prompt }}</strong>
                <span>{{ formatHistoryTime(item.createdAt) }}</span>
                <small>{{ formatHistoryMeta(item) }}</small>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { opsApi } from '../../api/opsApi.js'
import { computed, reactive, ref, nextTick, onMounted } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'

const config = reactive({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  hasApiKey: false,
  apiKeyMasked: '',
  model: 'gpt-image-1',
  size: '1024x1024',
  quality: 'auto'
})

const settingsConfig = reactive({ ...config })

const draft = ref('')
const messages = ref([])
const generating = ref(false)
const saving = ref(false)
const showSettings = ref(false)
const showHistory = ref(false)
const historyLoading = ref(false)
const downloadingMessageIds = ref(new Set())
const modelLoading = ref(false)
const modelOptions = ref([])
const modelError = ref('')
const clearApiKey = ref(false)
const useContext = ref(true)
const messagesEl = ref(null)
const historyItems = ref([])
const HISTORY_STORAGE_KEY = 'ops:gpt-image:history'
const MAX_HISTORY_ITEMS = 80
const promptSuggestions = [
  '生成一张极简风格的产品海报，白色背景，主体是一台桌面电脑',
  '画一个未来感运维控制台，深色界面，蓝绿色数据光效',
  '生成一张适合应用图标的插画：服务器、终端、闪电元素'
]

const selectableModels = computed(() => {
  const current = settingsConfig.model ? [settingsConfig.model] : []
  return [...new Set([...current, ...modelOptions.value])]
})

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// historyItems 会被 Vue 深度代理；所有进入 IPC 的数据都在这里重新构造为
// 纯字面量，避免 Electron structured clone 因 Proxy 报错。
function serializeImageConfig(source = {}) {
  return {
    baseUrl: String(source.baseUrl || '').trim(),
    apiKey: String(source.apiKey || '').trim(),
    model: String(source.model || '').trim(),
    size: String(source.size || '').trim(),
    quality: String(source.quality || '').trim()
  }
}

function normalizeHistoryItem(item = {}) {
  return {
    id: String(item.id || '').trim(),
    prompt: String(item.prompt || '').trim(),
    fullPrompt: String(item.fullPrompt || '').trim(),
    imageUrl: String(item.imageUrl || '').trim(),
    revisedPrompt: String(item.revisedPrompt || '').trim(),
    model: String(item.model || '').trim(),
    size: String(item.size || '').trim(),
    quality: String(item.quality || '').trim(),
    durationMs: Number(item.durationMs) || 0,
    createdAt: Number(item.createdAt) || Date.now()
  }
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .map(normalizeHistoryItem)
    .filter((item) => item.id && item.prompt && item.imageUrl)
    .slice(0, MAX_HISTORY_ITEMS)
}

function formatDuration(ms) {
  const value = Number(ms) || 0
  if (value < 1000) return `${Math.max(value, 0)}ms`
  const seconds = value / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

function imageToUrl(image) {
  if (image?.b64Json) {
    return `data:image/png;base64,${image.b64Json}`
  }
  return image?.url || ''
}

function buildPrompt(currentPrompt) {
  if (!useContext.value) return currentPrompt

  const recentMessages = messages.value.filter((item) => item.text || item.revisedPrompt).slice(-8)

  if (recentMessages.length === 0) return currentPrompt

  return [
    '这是一个连续图片生成对话。请参考最近对话延续画面设定，当前需求优先级最高。',
    ...recentMessages.map((item, index) => {
      if (item.role === 'user') {
        return `${index + 1}. 用户需求：${item.text}`
      }
      return `${index + 1}. 上次生成说明：${item.revisedPrompt || item.text}`
    }),
    `当前需求：${currentPrompt}`
  ].join('\n')
}

async function scrollToBottom() {
  await nextTick()
  if (messagesEl.value) {
    messagesEl.value.scrollTop = messagesEl.value.scrollHeight
  }
}

async function loadConfig() {
  try {
    const result = await opsApi.getGptImageConfig()
    if (result?.ok === false) throw new Error(result.error || '读取配置失败')
    const saved = result?.config || result
    Object.assign(config, saved || {})
    Object.assign(settingsConfig, config, { apiKey: '' })
  } catch (err) {
    MessagePlugin.error({ content: err?.message || '读取配置失败', placement: 'bottom-right' })
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    if (typeof opsApi?.getGptImageHistory === 'function') {
      historyItems.value = normalizeHistory(await opsApi.getGptImageHistory())
      return
    }

    const rawHistory = localStorage.getItem(HISTORY_STORAGE_KEY)
    historyItems.value = normalizeHistory(rawHistory ? JSON.parse(rawHistory) : [])
  } catch {
    historyItems.value = []
  } finally {
    historyLoading.value = false
  }
}

async function persistHistory() {
  const nextHistory = normalizeHistory(historyItems.value)
  historyItems.value = nextHistory

  if (typeof opsApi?.saveGptImageHistory === 'function') {
    // nextHistory 虽来自 normalizeHistory，但赋值到 ref 后会再次成为 Vue Proxy；
    // 再次规范化，确保 IPC 始终接收结构化克隆支持的普通对象。
    await opsApi.saveGptImageHistory(normalizeHistory(nextHistory))
    return
  }

  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory))
}

async function appendHistoryItem(item) {
  historyItems.value = normalizeHistory([
    item,
    ...historyItems.value.filter((historyItem) => historyItem.id !== item.id)
  ])
  await persistHistory()
}

async function saveConfig() {
  saving.value = true
  try {
    const nextConfig = {
      ...serializeImageConfig(settingsConfig),
      clearApiKey: clearApiKey.value
    }
    const result = await opsApi.saveGptImageConfig(nextConfig)
    if (result?.ok) {
      Object.assign(config, result.config || {}, { apiKey: '' })
      Object.assign(settingsConfig, config, { apiKey: '' })
      clearApiKey.value = false
      MessagePlugin.success({ content: '配置已保存', placement: 'bottom-right' })
      closeSettings()
    } else {
      MessagePlugin.error({ content: result?.error || '配置保存失败', placement: 'bottom-right' })
    }
  } finally {
    saving.value = false
  }
}

async function loadModels() {
  modelError.value = ''

  if (typeof opsApi?.listGptImageModels !== 'function') {
    modelError.value = '模型列表接口未加载，请重启 Electron 应用'
    MessagePlugin.error({ content: modelError.value, placement: 'bottom-right' })
    return
  }

  modelLoading.value = true

  try {
    const result = await opsApi.listGptImageModels(serializeImageConfig(settingsConfig))
    if (!result?.ok) {
      modelError.value = result?.error || '获取模型列表失败'
      MessagePlugin.error({ content: modelError.value, placement: 'bottom-right' })
      return
    }

    modelOptions.value = result.models || []
    if (modelOptions.value.length > 0 && !modelOptions.value.includes(settingsConfig.model)) {
      settingsConfig.model = modelOptions.value[0]
    }
    MessagePlugin.success({ content: '模型列表已更新', placement: 'bottom-right' })
  } catch (err) {
    modelError.value = err?.message || '获取模型列表失败'
    MessagePlugin.error({ content: modelError.value, placement: 'bottom-right' })
  } finally {
    modelLoading.value = false
  }
}

async function sendMessage() {
  const text = draft.value.trim()
  if (!text || generating.value) return

  if (!config.hasApiKey) {
    MessagePlugin.warning({ content: '请先在模型设置中填写 API Key', placement: 'bottom-right' })
    openSettings()
    return
  }

  const prompt = buildPrompt(text)
  const startedAt = Date.now()
  let timer = null
  draft.value = ''
  messages.value.push({
    id: createId(),
    role: 'user',
    text,
    time: nowTime()
  })

  const assistantMessage = reactive({
    id: createId(),
    role: 'assistant',
    text: '',
    time: nowTime(),
    loading: true,
    error: '',
    imageUrl: '',
    revisedPrompt: '',
    elapsedMs: 0,
    durationText: '0ms'
  })
  messages.value.push(assistantMessage)
  generating.value = true
  timer = window.setInterval(() => {
    assistantMessage.elapsedMs = Date.now() - startedAt
    assistantMessage.durationText = formatDuration(assistantMessage.elapsedMs)
  }, 300)
  await scrollToBottom()

  try {
    const imageConfig = serializeImageConfig(config)
    await opsApi.saveGptImageConfig(imageConfig)
    const result = await opsApi.generateGptImage({
      prompt: String(prompt),
      config: imageConfig
    })

    assistantMessage.loading = false
    assistantMessage.elapsedMs = Date.now() - startedAt
    assistantMessage.durationText = formatDuration(assistantMessage.elapsedMs)
    if (!result?.ok) {
      assistantMessage.error = result?.error || '生成失败'
      return
    }

    assistantMessage.imageUrl = imageToUrl(result.image)
    assistantMessage.revisedPrompt = result.image?.revisedPrompt || ''
    await appendHistoryItem({
      id: createId(),
      prompt: text,
      fullPrompt: prompt,
      imageUrl: assistantMessage.imageUrl,
      revisedPrompt: assistantMessage.revisedPrompt,
      model: config.model,
      size: config.size,
      quality: config.quality,
      durationMs: assistantMessage.elapsedMs,
      createdAt: Date.now()
    })
  } catch (err) {
    assistantMessage.loading = false
    assistantMessage.elapsedMs = Date.now() - startedAt
    assistantMessage.durationText = formatDuration(assistantMessage.elapsedMs)
    assistantMessage.error = err?.message || '生成失败'
  } finally {
    if (timer) window.clearInterval(timer)
    generating.value = false
    scrollToBottom()
  }
}

function isDownloading(messageId) {
  return downloadingMessageIds.value.has(messageId)
}

async function downloadImage(message) {
  const imageUrl = String(message?.imageUrl || '').trim()
  if (!imageUrl) {
    MessagePlugin.warning({ content: '没有可下载的图片', placement: 'bottom-right' })
    return
  }

  if (typeof opsApi?.saveGptImage !== 'function') {
    MessagePlugin.error({
      content: '图片保存接口未加载，请重启 Electron 应用',
      placement: 'bottom-right'
    })
    return
  }

  const messageId = String(message?.id || '')
  if (isDownloading(messageId)) return
  downloadingMessageIds.value = new Set([...downloadingMessageIds.value, messageId])

  try {
    const result = await opsApi.saveGptImage({
      imageUrl,
      fileName: `gpt-image-${Date.now()}`
    })
    if (result?.cancelled) return

    if (!result?.ok) {
      throw new Error(result?.error || '保存图片失败')
    }

    MessagePlugin.success({ content: '图片已保存', placement: 'bottom-right' })
  } catch (err) {
    MessagePlugin.error({ content: err?.message || '保存图片失败', placement: 'bottom-right' })
  } finally {
    const nextIds = new Set(downloadingMessageIds.value)
    nextIds.delete(messageId)
    downloadingMessageIds.value = nextIds
  }
}

function continueFromMessage() {
  draft.value = '基于上一张图继续调整：'
  scrollToBottom()
}

function useSuggestion(suggestion) {
  draft.value = suggestion
  scrollToBottom()
}

function openSettings() {
  Object.assign(settingsConfig, config, { apiKey: '' })
  clearApiKey.value = false
  showSettings.value = true
  loadModels()
}

function closeSettings() {
  showSettings.value = false
}

function clearConversation() {
  if (generating.value) return
  messages.value = []
}

async function clearHistory() {
  if (historyItems.value.length === 0) return
  historyItems.value = []

  if (typeof opsApi?.clearGptImageHistory === 'function') {
    await opsApi.clearGptImageHistory()
    return
  }

  localStorage.removeItem(HISTORY_STORAGE_KEY)
}

async function openHistory() {
  showHistory.value = true
  await loadHistory()
}

function closeHistory() {
  showHistory.value = false
}

function openHistoryItem(item) {
  messages.value = [
    {
      id: createId(),
      role: 'user',
      text: item.prompt,
      time: formatHistoryTime(item.createdAt)
    },
    {
      id: createId(),
      role: 'assistant',
      text: '',
      time: formatHistoryTime(item.createdAt),
      loading: false,
      error: '',
      imageUrl: item.imageUrl,
      revisedPrompt: item.revisedPrompt,
      elapsedMs: item.durationMs || 0,
      durationText: item.durationMs ? formatDuration(item.durationMs) : ''
    }
  ]
  closeHistory()
  scrollToBottom()
}

function formatHistoryTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatHistoryMeta(item) {
  return [
    item.model,
    item.size,
    item.quality,
    item.durationMs ? formatDuration(item.durationMs) : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

onMounted(() => {
  loadConfig()
})
</script>

<style scoped src="./styles.css"></style>
