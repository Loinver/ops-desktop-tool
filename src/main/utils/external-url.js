const { execFile: defaultExecFile } = require('node:child_process')

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const HTTP_SCHEME_PATTERN = /^https?:\/\//i
const MAILTO_SCHEME_PATTERN = /^mailto:/i
const HOST_WITH_PORT_PATTERN = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\]|[a-z0-9.-]+):\d+(?:[/?#]|$)/i
const LOCAL_HOST_PATTERN = /^(?:localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[(?:::1|[0-9a-f:]+)\])(?:[/?#]|$)/i

/**
 * 为未填写协议的网址选择默认协议。
 * 本机地址和显式端口通常是开发服务，默认使用 http；普通域名默认使用 https。
 *
 * @param {string} value
 * @returns {string}
 */
function addDefaultProtocol(value) {
  const protocolRelativeValue = value.replace(/^\/\//, '')

  if (HOST_WITH_PORT_PATTERN.test(protocolRelativeValue) || LOCAL_HOST_PATTERN.test(protocolRelativeValue)) {
    return `http://${protocolRelativeValue}`
  }

  return `https://${protocolRelativeValue}`
}

/**
 * 将用户输入的网页地址转换为可由系统默认应用打开的安全 URL。
 * 普通域名默认使用 https，本机开发地址（如 localhost:3000）默认使用 http。
 *
 * @param {unknown} rawUrl
 * @returns {string}
 * @throws {Error} URL 无效或协议不受支持时抛出错误
 */
function normalizeExternalUrl(rawUrl) {
  const value = String(rawUrl ?? '').trim()
  if (!value) {
    throw new Error('请输入网址')
  }

  let candidate
  if (HTTP_SCHEME_PATTERN.test(value) || MAILTO_SCHEME_PATTERN.test(value)) {
    candidate = value
  } else if (HOST_WITH_PORT_PATTERN.test(value) || LOCAL_HOST_PATTERN.test(value) || value.startsWith('//')) {
    candidate = addDefaultProtocol(value)
  } else if (SCHEME_PATTERN.test(value)) {
    // 保留显式的未知协议，交给下方白名单给出清晰错误，避免将危险协议误当成域名。
    candidate = value
  } else {
    candidate = addDefaultProtocol(value)
  }

  let url
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('网址格式无效')
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol)) {
    throw new Error('仅支持 http、https 或 mailto 地址')
  }

  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) {
    throw new Error('网址缺少域名')
  }

  return url.toString()
}

/**
 * 用系统默认应用打开已规范化的网址。
 * macOS 上改用原生 `open`：在部分已安装 Electron 应用中，shell.openExternal 虽会
 * resolve，却可能没有将 URL 交给默认浏览器。`open` 会直接走 Launch Services。
 */
function openExternalUrl(url, { shell, platform = process.platform, execFile = defaultExecFile } = {}) {
  if (platform !== 'darwin') {
    if (!shell || typeof shell.openExternal !== 'function') {
      return Promise.reject(new Error('系统浏览器服务不可用'))
    }
    return shell.openExternal(url)
  }

  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', [url], { timeout: 15_000 }, (error) => {
      if (error) {
        reject(new Error(`无法使用系统默认浏览器打开网址：${error.message}`))
        return
      }
      resolve()
    })
  })
}

module.exports = { normalizeExternalUrl, openExternalUrl, ALLOWED_EXTERNAL_PROTOCOLS }
