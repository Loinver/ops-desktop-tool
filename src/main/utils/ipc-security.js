const path = require('node:path')
const { fileURLToPath } = require('node:url')

const INSTALL_SYMBOL = Symbol.for('ops-desktop.ipc-security-installed')

function string(value, max = 240) {
  return String(value || '')
    .trim()
    .slice(0, max)
}

function senderUrl(event) {
  return string(event?.senderFrame?.url || event?.sender?.getURL?.(), 4000)
}

function normalizedOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function isTrustedRendererUrl(
  rawUrl,
  { isPackaged = false, devServerUrl = 'http://localhost:5173', rendererEntryPath = '' } = {}
) {
  const url = string(rawUrl, 4000)
  if (!url) return false

  try {
    const parsed = new URL(url)
    if (!isPackaged) {
      const allowedOrigin = normalizedOrigin(devServerUrl)
      return Boolean(allowedOrigin) && parsed.origin === allowedOrigin
    }

    if (parsed.protocol !== 'file:' || !rendererEntryPath) return false
    const actualPath = path.resolve(fileURLToPath(parsed))
    return actualPath === path.resolve(rendererEntryPath)
  } catch {
    return false
  }
}

function createIpcSecurityError(message = 'IPC 请求来源不受信任') {
  const error = new Error(message)
  error.code = 'ERR_UNTRUSTED_IPC_SENDER'
  return error
}

function assertTrustedIpcSender(
  event,
  {
    getMainWindow,
    isPackaged = false,
    devServerUrl = 'http://localhost:5173',
    rendererEntryPath = ''
  } = {}
) {
  const window = typeof getMainWindow === 'function' ? getMainWindow() : null
  const trustedContents = window?.webContents
  const sender = event?.sender

  if (
    !window ||
    window.isDestroyed?.() ||
    !trustedContents ||
    trustedContents.isDestroyed?.() ||
    !sender ||
    sender !== trustedContents ||
    sender.isDestroyed?.()
  ) {
    throw createIpcSecurityError()
  }

  const senderFrame = event?.senderFrame
  const mainFrame = sender?.mainFrame
  if (senderFrame && mainFrame && senderFrame !== mainFrame) {
    throw createIpcSecurityError('IPC 请求必须来自主页面 Frame')
  }

  if (
    !isTrustedRendererUrl(senderUrl(event), {
      isPackaged,
      devServerUrl,
      rendererEntryPath
    })
  ) {
    throw createIpcSecurityError('IPC 请求页面地址不受信任')
  }

  return true
}

function resultFailed(result) {
  return Boolean(
    result &&
    typeof result === 'object' &&
    (result.ok === false || result.success === false || result.status === 'failed')
  )
}

function normalizedAuditTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const sensitiveKey =
    /(authorization|cookie|credential|password|secret|token|api[-_]?key|private[-_]?key)/i
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKey.test(String(key)))
      .slice(0, 20)
      .map(([key, item]) => {
        const safeKey = string(key, 80)
        if (!safeKey) return null
        if (typeof item === 'number' || typeof item === 'boolean') return [safeKey, item]
        if (Array.isArray(item))
          return [safeKey, item.slice(0, 20).map((entry) => string(entry, 120))]
        return [safeKey, string(item, 240)]
      })
      .filter(Boolean)
  )
}

async function safelyStartAudit(audit, payload, logger) {
  if (typeof audit?.start !== 'function') return null
  try {
    return await audit.start(payload)
  } catch (error) {
    logger?.warn?.('记录 IPC 审计开始状态失败', {
      channel: payload.channel,
      message: error?.message
    })
    return null
  }
}

async function safelyFinishAudit(audit, context, payload, logger) {
  if (!context || typeof audit?.finish !== 'function') return
  try {
    await audit.finish(context, payload)
  } catch (error) {
    logger?.warn?.('记录 IPC 审计完成状态失败', {
      channel: payload.channel,
      message: error?.message
    })
  }
}

function installIpcHandleSecurity({
  ipcMain,
  getMainWindow,
  isPackaged = false,
  devServerUrl = 'http://localhost:5173',
  rendererEntryPath = '',
  auditPolicies = {},
  audit = null,
  logger = null
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('安装 IPC 安全策略需要 ipcMain.handle')
  }
  if (ipcMain[INSTALL_SYMBOL]) return ipcMain[INSTALL_SYMBOL]

  const originalHandle = ipcMain.handle
  const restore = () => {
    if (ipcMain.handle !== guardedHandle) return false
    ipcMain.handle = originalHandle
    delete ipcMain[INSTALL_SYMBOL]
    return true
  }

  function guardedHandle(channel, handler) {
    if (typeof handler !== 'function') return originalHandle.call(ipcMain, channel, handler)
    return originalHandle.call(ipcMain, channel, async (event, ...args) => {
      assertTrustedIpcSender(event, {
        getMainWindow,
        isPackaged,
        devServerUrl,
        rendererEntryPath
      })

      const policy = auditPolicies[channel]
      const startedAt = Date.now()
      const auditContext = policy
        ? await safelyStartAudit(
            audit,
            {
              action: string(policy.action || channel, 120),
              category: string(policy.category || 'ipc', 80),
              channel: string(channel, 160),
              target: normalizedAuditTarget(
                typeof policy.target === 'function' ? policy.target(args) : policy.target
              ),
              startedAt
            },
            logger
          )
        : null

      try {
        const result = await handler(event, ...args)
        const failed = resultFailed(result)
        await safelyFinishAudit(
          audit,
          auditContext,
          {
            channel,
            status: failed ? 'failed' : 'succeeded',
            durationMs: Date.now() - startedAt,
            error: failed ? string(policy?.failureMessage || '操作返回失败', 160) : '',
            errorCode: failed ? string(result?.errorCode || result?.code, 80) : ''
          },
          logger
        )
        return result
      } catch (error) {
        await safelyFinishAudit(
          audit,
          auditContext,
          {
            channel,
            status: 'failed',
            durationMs: Date.now() - startedAt,
            error: string(policy?.failureMessage || '操作执行失败', 160),
            errorCode: string(error?.code, 80)
          },
          logger
        )
        throw error
      }
    })
  }

  ipcMain.handle = guardedHandle
  ipcMain[INSTALL_SYMBOL] = restore
  return restore
}

module.exports = {
  assertTrustedIpcSender,
  installIpcHandleSecurity,
  isTrustedRendererUrl,
  __testables: {
    normalizedAuditTarget,
    resultFailed,
    senderUrl
  }
}
