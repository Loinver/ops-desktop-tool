const dns = require('node:dns/promises')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_REDIRECTS = 3

function parseIpv4(address) {
  if (net.isIP(address) !== 4) return null
  return address.split('.').map((part) => Number(part))
}

function isBlockedIpv4(address) {
  const parts = parseIpv4(address)
  if (!parts) return true
  const [a, b, c] = parts

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function mappedIpv4FromIpv6(address) {
  const normalized = String(address || '')
    .trim()
    .toLowerCase()
    .split('%', 1)[0]
  const dotted = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
  if (dotted) return dotted[1]

  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized)
  if (!hex) return ''
  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

function isBlockedIpAddress(address) {
  const normalized = String(address || '')
    .trim()
    .toLowerCase()
    .split('%', 1)[0]
  const family = net.isIP(normalized)
  if (family === 4) return isBlockedIpv4(normalized)
  if (family !== 6) return true

  const mappedIpv4 = mappedIpv4FromIpv6(normalized)
  if (mappedIpv4) return isBlockedIpv4(mappedIpv4)

  return (
    normalized === '::' ||
    normalized === '::1' ||
    /^(fc|fd)/.test(normalized) ||
    /^fe[89a-f]/.test(normalized) ||
    /^ff/.test(normalized) ||
    /^64:ff9b(?::|$)/.test(normalized) ||
    /^100:(?::|0:)/.test(normalized) ||
    /^2001:(?::|0:)/.test(normalized) ||
    /^2001:2(?::|$)/.test(normalized) ||
    /^2001:db8(?::|$)/.test(normalized) ||
    /^2002(?::|$)/.test(normalized)
  )
}

function normalizeRemoteUrl(value) {
  let url
  try {
    url = new URL(String(value || '').trim())
  } catch {
    throw new Error('图片下载地址无效')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('图片下载地址仅支持 http 或 https')
  }
  if (url.username || url.password) {
    throw new Error('图片下载地址不能包含登录凭据')
  }
  if (
    (url.protocol === 'http:' && url.port && url.port !== '80') ||
    (url.protocol === 'https:' && url.port && url.port !== '443')
  ) {
    throw new Error('图片下载地址仅支持标准 HTTP/HTTPS 端口')
  }
  url.hash = ''
  return url
}

function isBlockedHostname(hostname) {
  const value = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
  return (
    !value ||
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value.endsWith('.local') ||
    value.endsWith('.internal') ||
    value.endsWith('.lan') ||
    value.endsWith('.home')
  )
}

function normalizeLookupAddresses(addresses) {
  if (!Array.isArray(addresses)) return []
  const unique = new Map()
  for (const entry of addresses) {
    const address = String(entry?.address || '').trim()
    const family = Number(entry?.family) || net.isIP(address)
    if (![4, 6].includes(family) || net.isIP(address) !== family) continue
    unique.set(`${family}:${address}`, { address, family })
  }
  return [...unique.values()]
}

async function resolvePublicRemoteUrl(value, options = {}) {
  const lookup = options.lookup || dns.lookup
  const url = normalizeRemoteUrl(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')

  if (isBlockedHostname(hostname)) {
    throw new Error('出于安全原因，不能访问本机或内网图片地址')
  }

  if (net.isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new Error('出于安全原因，不能访问本机或内网图片地址')
    }
    return { url, addresses: [{ address: hostname, family: net.isIP(hostname) }] }
  }

  let addresses
  try {
    addresses = normalizeLookupAddresses(await lookup(hostname, { all: true, verbatim: true }))
  } catch (error) {
    throw new Error('无法解析图片下载地址', { cause: error })
  }
  if (addresses.length === 0) {
    throw new Error('无法解析图片下载地址')
  }
  if (addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new Error('出于安全原因，不能访问本机或内网图片地址')
  }
  return { url, addresses }
}

async function assertPublicRemoteUrl(value, options = {}) {
  return (await resolvePublicRemoteUrl(value, options)).url
}

function createPinnedLookup(addresses) {
  const allowedAddresses = normalizeLookupAddresses(addresses)
  if (allowedAddresses.length === 0) throw new Error('图片下载地址没有可用的公网 IP')

  return (_hostname, options, callback) => {
    const lookupOptions = typeof options === 'object' && options ? options : {}
    const done = typeof options === 'function' ? options : callback
    const requestedFamily =
      typeof options === 'number' ? options : Number(lookupOptions.family) || 0
    const candidates = requestedFamily
      ? allowedAddresses.filter((entry) => entry.family === requestedFamily)
      : allowedAddresses

    if (candidates.length === 0) {
      const error = new Error('图片下载地址没有匹配的公网 IP')
      error.code = 'EAI_ADDRFAMILY'
      done(error)
      return
    }
    if (lookupOptions.all) {
      done(
        null,
        candidates.map((entry) => ({ ...entry }))
      )
      return
    }
    done(null, candidates[0].address, candidates[0].family)
  }
}

function requestPinnedResource(target, addresses, options = {}) {
  const transport = target.protocol === 'https:' ? https : http
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  return new Promise((resolve, reject) => {
    const request = transport.request(
      target,
      {
        method: 'GET',
        agent: false,
        autoSelectFamily: addresses.length > 1,
        headers: { Accept: 'image/*' },
        lookup: createPinnedLookup(addresses),
        servername: net.isIP(hostname) ? undefined : hostname,
        signal: options.signal
      },
      (response) => {
        const status = Number(response.statusCode) || 0
        resolve({
          body: response,
          status,
          ok: status >= 200 && status < 300,
          headers: {
            get(name) {
              const value = response.headers[String(name || '').toLowerCase()]
              return Array.isArray(value) ? value.join(', ') : value == null ? null : String(value)
            }
          }
        })
      }
    )
    request.once('error', reject)
    request.end()
  })
}

async function readResponseBody(response, maxBytes) {
  const chunks = []
  let totalBytes = 0
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error('图片文件超过 50 MB，无法保存')
    return buffer
  }

  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > maxBytes) {
      response.body.destroy?.()
      await response.body.cancel?.().catch(() => undefined)
      throw new Error('图片文件超过 50 MB，无法保存')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, totalBytes)
}

function disposeResponse(response) {
  response?.body?.destroy?.()
  const cancelled = response?.body?.cancel?.()
  cancelled?.catch?.(() => undefined)
}

async function fetchPublicResource(value, options = {}) {
  const fetchImpl = options.fetchImpl
  const lookup = options.lookup || dns.lookup
  const maxBytes = Number(options.maxBytes)
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS
  const maxRedirects = Number.isInteger(options.maxRedirects)
    ? options.maxRedirects
    : DEFAULT_MAX_REDIRECTS
  if (fetchImpl !== undefined && typeof fetchImpl !== 'function') {
    throw new Error('当前运行环境不支持远程图片下载')
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('远程资源大小限制无效')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let resolved = await resolvePublicRemoteUrl(value, { lookup })

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = fetchImpl
        ? await fetchImpl(resolved.url, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: { Accept: 'image/*' }
          })
        : await requestPinnedResource(resolved.url, resolved.addresses, {
            signal: controller.signal
          })

      if (response.status >= 300 && response.status < 400) {
        disposeResponse(response)
        if (redirectCount === maxRedirects) throw new Error('图片下载重定向次数过多')
        const location = response.headers.get('location')
        if (!location) throw new Error('图片下载重定向地址无效')
        resolved = await resolvePublicRemoteUrl(new URL(location, resolved.url), { lookup })
        continue
      }

      if (!response.ok) {
        disposeResponse(response)
        throw new Error(`下载图片失败，HTTP ${response.status}`)
      }
      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        disposeResponse(response)
        throw new Error('图片文件超过 50 MB，无法保存')
      }

      const buffer = await readResponseBody(response, maxBytes)
      if (buffer.length === 0) throw new Error('下载到的图片数据为空')
      return { response, buffer, url: resolved.url }
    }
    throw new Error('图片下载重定向次数过多')
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
      throw new Error('下载图片超时，请稍后重试', { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = {
  DEFAULT_MAX_REDIRECTS,
  assertPublicRemoteUrl,
  createPinnedLookup,
  fetchPublicResource,
  isBlockedIpAddress,
  normalizeRemoteUrl,
  requestPinnedResource,
  resolvePublicRemoteUrl
}
