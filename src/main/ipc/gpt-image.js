const path = require('node:path')
const fs = require('node:fs/promises')
const { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { readJsonFile, writeJsonFile } = require('../utils/json-store')
const { encryptSecret, maskSecret, readSecretField } = require('../utils/secure-secret')
const { latestModelTestStatuses } = require('../utils/ai-ops')
const { loadProviders } = require('../utils/ccswitch')
const {
  MAX_IMAGE_BYTES,
  buildImageFileName,
  detectImageExtension,
  decodeDataImageUrl,
  ensureImageExtension,
  extensionForContentType,
  normalizeContentType
} = require('../utils/gpt-image-file')
const {
  MAX_PREVIEW_DATA_URL_CHARS,
  findImageAsset,
  normalizeAssetId,
  removeImageAssets,
  removeOrphanImageAssets,
  storeImageAsset
} = require('../utils/gpt-image-assets')
const { fetchPublicResource } = require('../utils/safe-remote-resource')

const userDataPath = app.getPath('userData')
const configFile = path.join(userDataPath, 'gpt-image-config.json')
const historyFile = path.join(userDataPath, 'gpt-image-history.json')
const assetsDir = path.join(userDataPath, 'gpt-image-assets')
const MAX_HISTORY_ITEMS = 80
const MAX_HISTORY_FILE_BYTES = 8 * 1024 * 1024
const MAX_PROMPT_CHARS = 12_000

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

function limitText(value, maxLength) {
  return String(value || '')
    .trim()
    .slice(0, maxLength)
}

function sanitizePreviewUrl(value) {
  const previewUrl = String(value || '').trim()
  if (!previewUrl || previewUrl.length > MAX_PREVIEW_DATA_URL_CHARS) return ''
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(previewUrl)) return ''
  return previewUrl
}

function sanitizeHistoryItem(item = {}) {
  return {
    id: limitText(item.id, 128),
    prompt: limitText(item.prompt, 4_000),
    fullPrompt: limitText(item.fullPrompt, MAX_PROMPT_CHARS),
    assetId: normalizeAssetId(item.assetId),
    imageUrl: sanitizePreviewUrl(item.imageUrl || item.previewUrl),
    revisedPrompt: limitText(item.revisedPrompt, 4_000),
    model: limitText(item.model, 200),
    size: limitText(item.size, 64),
    quality: limitText(item.quality, 64),
    durationMs: Math.max(0, Math.min(Number(item.durationMs) || 0, 24 * 60 * 60 * 1000)),
    createdAt: Number(item.createdAt) || Date.now()
  }
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .map(sanitizeHistoryItem)
    .filter((item) => item.id && item.prompt && item.assetId && item.imageUrl)
    .slice(0, MAX_HISTORY_ITEMS)
}

function isValidHistoryItem(item) {
  return Boolean(item.id && item.prompt && item.assetId && item.imageUrl)
}

async function normalizeStoredHistory(rawHistory, storeAsset) {
  if (!Array.isArray(rawHistory)) return { history: [], changed: false }

  const persistAsset =
    storeAsset ||
    ((decoded) =>
      storeImageAsset({
        assetsDir,
        buffer: decoded.buffer,
        extension: decoded.extension,
        nativeImage
      }))
  let changed = rawHistory.length > MAX_HISTORY_ITEMS
  let normalized = []
  const removedAssetIds = new Set()

  // 1.0.6 及更早版本可能把完整 Base64 图片写入 JSON。逐项保留新格式记录并迁移
  // 旧格式 data URL；远程 URL 不会在读取历史时自动访问，避免后台网络请求与 SSRF。
  for (const item of rawHistory.slice(0, MAX_HISTORY_ITEMS)) {
    const safeItem = sanitizeHistoryItem(item)
    if (isValidHistoryItem(safeItem)) {
      if (!removedAssetIds.has(safeItem.assetId)) normalized.push(safeItem)
      continue
    }

    changed = true
    const source = String(item?.imageUrl || item?.previewUrl || '').trim()
    if (!source.startsWith('data:')) continue

    try {
      const decoded = decodeDataImageUrl(source)
      const stored = await persistAsset(decoded)
      for (const removedAssetId of stored.removedAssetIds || []) {
        removedAssetIds.add(removedAssetId)
      }
      if (removedAssetIds.size > 0) {
        normalized = normalized.filter((entry) => !removedAssetIds.has(entry.assetId))
      }
      const migrated = sanitizeHistoryItem({
        ...item,
        assetId: stored.assetId,
        imageUrl: stored.previewUrl
      })
      if (isValidHistoryItem(migrated) && !removedAssetIds.has(migrated.assetId)) {
        normalized.push(migrated)
      }
    } catch (error) {
      console.warn('迁移旧版 AI 生图历史失败:', error?.message || error)
    }
  }

  return { history: sanitizeHistory(normalized), changed }
}

async function readHistoryFile() {
  try {
    const stat = await fs.stat(historyFile)
    if (stat.size > MAX_HISTORY_FILE_BYTES) {
      console.warn('AI 生图历史文件过大，已重置以避免应用内存异常')
      writeJsonFile(historyFile, [])
      return []
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('读取 AI 生图历史大小失败:', error)
  }

  const rawHistory = readJsonFile(historyFile, [])
  const result = await normalizeStoredHistory(rawHistory)
  if (result.changed) writeJsonFile(historyFile, result.history)
  return result.history
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
  const { response, buffer } = await fetchPublicResource(imageUrl, { maxBytes: MAX_IMAGE_BYTES })
  const contentType = normalizeContentType(response.headers.get('content-type'))
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error('下载地址未返回图片文件')
  }
  const declaredExtension = contentType ? extensionForContentType(contentType) : ''
  return {
    buffer,
    contentType,
    extension: detectImageExtension(buffer, declaredExtension)
  }
}

async function resolveImageForSave(payload = {}) {
  const assetId = normalizeAssetId(payload.assetId)
  if (assetId) {
    const asset = await findImageAsset(assetsDir, assetId)
    return {
      buffer: await fs.readFile(asset.filePath),
      extension: path.extname(asset.filePath).slice(1) || 'png'
    }
  }

  const source = String(payload.imageUrl || '').trim()
  if (!source) throw new Error('没有可保存的图片')
  return source.startsWith('data:') ? decodeDataImageUrl(source) : readRemoteImage(source)
}

async function persistGeneratedImage(image) {
  const decoded = image?.b64_json
    ? decodeDataImageUrl(`data:image/png;base64,${image.b64_json}`)
    : await readRemoteImage(image?.url)
  const stored = await storeImageAsset({
    assetsDir,
    buffer: decoded.buffer,
    extension: decoded.extension,
    nativeImage
  })

  if (stored.removedAssetIds.length > 0) {
    const removed = new Set(stored.removedAssetIds)
    const retainedHistory = sanitizeHistory(readJsonFile(historyFile, [])).filter(
      (item) => !removed.has(item.assetId)
    )
    writeJsonFile(historyFile, retainedHistory)
  }
  return stored
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
    return readHistoryFile()
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_HISTORY_SAVE, async (_event, history) => {
    try {
      const nextHistory = sanitizeHistory(history)
      if (!writeJsonFile(historyFile, nextHistory)) throw new Error('历史记录保存失败')
      await removeOrphanImageAssets(
        assetsDir,
        nextHistory.map((item) => item.assetId)
      )
      return { ok: true, history: nextHistory }
    } catch (error) {
      return { ok: false, error: error?.message || '历史记录保存失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_HISTORY_CLEAR, async () => {
    try {
      if (!writeJsonFile(historyFile, [])) throw new Error('历史记录清理失败')
      await removeImageAssets(assetsDir)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error?.message || '历史记录清理失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GPT_IMAGE_SAVE, async (event, payload = {}) => {
    try {
      const image = await resolveImageForSave(payload)
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
    if (prompt.length > MAX_PROMPT_CHARS) {
      return { ok: false, error: `绘图描述不能超过 ${MAX_PROMPT_CHARS} 个字符` }
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

      const storedImage = await persistGeneratedImage(image)

      return {
        ok: true,
        image: {
          assetId: storedImage.assetId,
          previewUrl: storedImage.previewUrl,
          removedAssetIds: storedImage.removedAssetIds,
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
    resolveRequestConfig,
    normalizeStoredHistory,
    sanitizeHistory,
    sanitizeHistoryItem,
    sanitizePreviewUrl
  }
}
