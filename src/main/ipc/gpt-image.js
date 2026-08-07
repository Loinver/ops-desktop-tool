const path = require('node:path')
const fs = require('node:fs/promises')
const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { readJsonFile, writeJsonFile } = require('../utils/json-store')
const { encryptSecret, maskSecret, readSecretField } = require('../utils/secure-secret')
const { latestModelTestStatuses } = require('../utils/ai-ops')
const { loadProviders } = require('../utils/ccswitch')
const {
  MAX_IMAGE_BYTES,
  buildImageFileName,
  decodeDataImageUrl,
  ensureImageExtension,
  extensionForContentType,
  normalizeContentType
} = require('../utils/gpt-image-file')

const userDataPath = app.getPath('userData')
const configFile = path.join(userDataPath, 'gpt-image-config.json')
const historyFile = path.join(userDataPath, 'gpt-image-history.json')
const MAX_HISTORY_ITEMS = 80

const DEFAULT_CONFIG = {
  sourceMode: 'manual',
  sourceProviderId: '',
  sourceAppType: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-1',
  size: '1024x1024',
  quality: 'auto'
}

function sanitizeConfig(config = {}) {
  const sourceMode = config.sourceMode === 'model-reliability' ? 'model-reliability' : 'manual'
  return {
    sourceMode,
    sourceProviderId: String(config.sourceProviderId || '').trim(),
    sourceAppType: String(config.sourceAppType || '').trim(),
    baseUrl: String(config.baseUrl || DEFAULT_CONFIG.baseUrl).trim() || DEFAULT_CONFIG.baseUrl,
    apiKey: String(config.apiKey || '').trim(),
    model: String(config.model || DEFAULT_CONFIG.model).trim() || DEFAULT_CONFIG.model,
    size: String(config.size || DEFAULT_CONFIG.size).trim() || DEFAULT_CONFIG.size,
    quality: String(config.quality || DEFAULT_CONFIG.quality).trim() || DEFAULT_CONFIG.quality
  }
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || DEFAULT_CONFIG.baseUrl)
    .trim()
    .replace(/\/+$/, '')
  if (!value) return DEFAULT_CONFIG.baseUrl
  return value.endsWith('/v1') ? value : `${value}/v1`
}

function serializeConfigForStorage(config) {
  const normalized = sanitizeConfig(config)
  return {
    sourceMode: normalized.sourceMode,
    sourceProviderId: normalized.sourceProviderId,
    sourceAppType: normalized.sourceAppType,
    baseUrl: normalized.baseUrl,
    apiKeyEncrypted: encryptSecret(safeStorage, normalized.apiKey),
    model: normalized.model,
    size: normalized.size,
    quality: normalized.quality
  }
}

function writeConfig(config) {
  return writeJsonFile(configFile, serializeConfigForStorage(config))
}

function readConfig() {
  const stored = readJsonFile(configFile, DEFAULT_CONFIG)
  const secret = readSecretField({
    safeStorage,
    record: stored,
    encryptedKey: 'apiKeyEncrypted',
    legacyKey: 'apiKey'
  })
  const config = sanitizeConfig({ ...stored, apiKey: secret.value })

  if (secret.needsMigration) {
    try {
      if (!writeConfig(config)) throw new Error('写入迁移配置失败')
    } catch (error) {
      console.error('迁移 AI 生图 API Key 失败:', error)
    }
  }

  return config
}

function toSafeConfig(config) {
  const normalized = sanitizeConfig(config)
  return {
    sourceMode: normalized.sourceMode,
    sourceProviderId: normalized.sourceProviderId,
    sourceAppType: normalized.sourceAppType,
    baseUrl: normalized.baseUrl,
    apiKey: '',
    hasApiKey: Boolean(normalized.apiKey),
    isReady:
      normalized.sourceMode === 'model-reliability'
        ? Boolean(normalized.sourceProviderId && normalized.sourceAppType && normalized.model)
        : Boolean(normalized.apiKey),
    apiKeyMasked: maskSecret(normalized.apiKey),
    model: normalized.model,
    size: normalized.size,
    quality: normalized.quality
  }
}

function mergeRequestConfig(config = {}) {
  const stored = readConfig()
  const suppliedApiKey = String(config.apiKey || '').trim()
  return sanitizeConfig({
    ...stored,
    ...config,
    apiKey: suppliedApiKey || stored.apiKey
  })
}

function modelId(model) {
  if (typeof model === 'string') return model.trim()
  return String(model?.model || model?.key || model?.id || model?.name || '').trim()
}

function reliabilityModelKey(providerId, appType, model) {
  return `${String(providerId || '').trim()}::${String(appType || '').trim()}::${String(model || '').trim()}`
}

async function resolveModelReliabilityConfig(config, options = {}) {
  const providerLoader = options.providerLoader || loadProviders
  const statusLoader = options.statusLoader || latestModelTestStatuses
  const providerResult = await providerLoader()
  if (!providerResult?.ok) {
    throw new Error(`无法读取模型可靠性 Provider：${providerResult?.message || '未知错误'}`)
  }

  const provider = (Array.isArray(providerResult.providers) ? providerResult.providers : []).find(
    (item) => item.id === config.sourceProviderId && item.appType === config.sourceAppType
  )
  if (!provider) throw new Error('所选 Provider 已不在模型可靠性中，请刷新后重新选择')
  if (provider.protocol !== 'openai') {
    throw new Error('图像生成仅支持模型可靠性中的 OpenAI 兼容 Provider')
  }
  if (!provider.testable || !provider.baseUrl || !provider.apiKey) {
    throw new Error('所选 Provider 尚未在模型可靠性中完成可用配置')
  }

  const models = (Array.isArray(provider.models) ? provider.models : [])
    .map(modelId)
    .filter(Boolean)
  if (!models.includes(config.model)) {
    throw new Error('所选模型不属于当前 Provider，请刷新后重新选择')
  }

  const statuses = statusLoader(userDataPath)
  if (
    statuses.get(
      reliabilityModelKey(config.sourceProviderId, config.sourceAppType, config.model)
    ) !== 'ok'
  ) {
    throw new Error('所选模型尚未通过最近一次模型测试，请先前往模型可靠性完成测试')
  }

  return sanitizeConfig({
    ...config,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey
  })
}

async function resolveRequestConfig(config = {}, options = {}) {
  const merged = mergeRequestConfig(config)
  if (merged.sourceMode !== 'model-reliability') return merged
  if (!merged.sourceProviderId || !merged.sourceAppType || !merged.model) {
    throw new Error('请选择模型可靠性 Provider 和模型')
  }
  return resolveModelReliabilityConfig(merged, options)
}

function sanitizeHistoryItem(item = {}) {
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

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .map(sanitizeHistoryItem)
    .filter((item) => item.id && item.prompt && item.imageUrl)
    .slice(0, MAX_HISTORY_ITEMS)
}

function buildErrorMessage(status, data) {
  if (data?.error?.message) return data.error.message
  if (typeof data === 'string' && data) return data
  return `图片生成失败，HTTP ${status}`
}

function normalizeModelList(data) {
  const rawModels = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data)
        ? data
        : []

  const modelIds = rawModels
    .map((item) => {
      if (typeof item === 'string') return item
      return item?.id || item?.name || ''
    })
    .map((id) => String(id).trim())
    .filter(Boolean)

  return [...new Set(modelIds)].sort((a, b) => {
    const aImage = /image|dall-e/i.test(a)
    const bImage = /image|dall-e/i.test(b)
    if (aImage !== bImage) return aImage ? -1 : 1
    return a.localeCompare(b)
  })
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return await response.json()
  }
  return await response.text()
}

async function readRemoteImage(imageUrl) {
  const url = new URL(String(imageUrl || '').trim())
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('图片下载地址仅支持 http 或 https')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`下载图片失败，HTTP ${response.status}`)
    }

    const contentType = normalizeContentType(response.headers.get('content-type'))
    if (contentType && !contentType.startsWith('image/')) {
      throw new Error('下载地址未返回图片文件')
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      throw new Error('图片文件超过 50 MB，无法保存')
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) {
      throw new Error('下载到的图片数据为空')
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error('图片文件超过 50 MB，无法保存')
    }

    return {
      buffer,
      contentType,
      extension: extensionForContentType(contentType)
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('下载图片超时，请稍后重试', { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveImageForSave(imageUrl) {
  const source = String(imageUrl || '').trim()
  if (!source) {
    throw new Error('没有可保存的图片')
  }

  return source.startsWith('data:') ? decodeDataImageUrl(source) : readRemoteImage(source)
}

function registerGptImageHandlers() {
  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_CONFIG_GET, async () => {
    try {
      return { ok: true, config: toSafeConfig(readConfig()) }
    } catch (err) {
      return { ok: false, error: err?.message || '读取配置失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_CONFIG_SAVE, async (_event, config = {}) => {
    try {
      const currentConfig = readConfig()
      const suppliedApiKey = String(config.apiKey || '').trim()
      const nextConfig = sanitizeConfig({
        ...currentConfig,
        ...config,
        apiKey: config.clearApiKey ? '' : suppliedApiKey || currentConfig.apiKey
      })
      if (!writeConfig(nextConfig)) throw new Error('配置保存失败')
      return { ok: true, config: toSafeConfig(nextConfig) }
    } catch (err) {
      return { ok: false, error: err?.message || '配置保存失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_HISTORY_GET, async () => {
    return sanitizeHistory(readJsonFile(historyFile, []))
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_HISTORY_SAVE, async (_event, history) => {
    return writeJsonFile(historyFile, sanitizeHistory(history))
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_HISTORY_CLEAR, async () => {
    return writeJsonFile(historyFile, [])
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_SAVE, async (event, payload = {}) => {
    try {
      const image = await resolveImageForSave(payload.imageUrl)
      const defaultName = buildImageFileName(payload.fileName, image.extension)
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showSaveDialog(ownerWindow, {
        title: '保存 AI 生图',
        defaultPath: path.join(app.getPath('downloads'), defaultName),
        filters: [
          { name: 'PNG 图片', extensions: ['png'] },
          { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
          { name: 'WebP 图片', extensions: ['webp'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return { ok: false, cancelled: true }
      }

      const filePath = ensureImageExtension(result.filePath, image.extension)
      await fs.writeFile(filePath, image.buffer)
      return { ok: true, filePath }
    } catch (err) {
      return { ok: false, error: err?.message || '保存图片失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_MODELS_LIST, async (_event, config = {}) => {
    let requestConfig
    try {
      requestConfig = await resolveRequestConfig(config)
    } catch (err) {
      return { ok: false, error: err?.message || '读取配置失败' }
    }

    if (!requestConfig.apiKey) {
      return { ok: false, error: '请先填写 API Key' }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(`${normalizeBaseUrl(requestConfig.baseUrl)}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${requestConfig.apiKey}`
        },
        signal: controller.signal
      })

      const data = await parseResponse(response)

      if (!response.ok) {
        return { ok: false, error: buildErrorMessage(response.status, data) }
      }

      const models = normalizeModelList(data)
      if (models.length === 0) {
        return { ok: false, error: '接口未返回可用模型' }
      }

      return { ok: true, models }
    } catch (err) {
      const message =
        err?.name === 'AbortError' ? '获取模型列表超时' : err?.message || '获取模型列表失败'
      return { ok: false, error: message }
    } finally {
      clearTimeout(timeout)
    }
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_GENERATE, async (_event, payload = {}) => {
    let config
    try {
      config = await resolveRequestConfig(payload.config || {})
    } catch (err) {
      return { ok: false, error: err?.message || '读取配置失败' }
    }
    const prompt = String(payload.prompt || '').trim()

    if (!config.apiKey) {
      return { ok: false, error: '请先填写 API Key' }
    }

    if (!prompt) {
      return { ok: false, error: '请输入绘图描述' }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)

    try {
      const requestBody = {
        model: config.model,
        prompt,
        n: 1
      }

      if (config.size && config.size !== 'auto') {
        requestBody.size = config.size
      }

      if (config.quality && config.quality !== 'auto') {
        requestBody.quality = config.quality
      }

      const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })

      const data = await parseResponse(response)

      if (!response.ok) {
        return { ok: false, error: buildErrorMessage(response.status, data) }
      }

      const image = Array.isArray(data?.data) ? data.data[0] : null
      if (!image?.b64_json && !image?.url) {
        return { ok: false, error: '接口未返回图片数据' }
      }

      return {
        ok: true,
        image: {
          b64Json: image.b64_json || '',
          url: image.url || '',
          revisedPrompt: image.revised_prompt || ''
        },
        usage: data?.usage || null
      }
    } catch (err) {
      const message =
        err?.name === 'AbortError' ? '请求超时，请稍后重试' : err?.message || '图片生成失败'
      return { ok: false, error: message }
    } finally {
      clearTimeout(timeout)
    }
  })
}

module.exports = {
  registerGptImageHandlers,
  __testables: {
    DEFAULT_CONFIG,
    sanitizeConfig,
    serializeConfigForStorage,
    readConfig,
    toSafeConfig,
    modelId,
    reliabilityModelKey,
    resolveModelReliabilityConfig,
    resolveRequestConfig
  }
}
