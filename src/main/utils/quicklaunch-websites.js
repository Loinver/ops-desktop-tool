const { randomUUID } = require('node:crypto')
const { normalizeExternalUrl } = require('./external-url')

const MAX_BATCH_ITEMS = 200
const QUICK_LAUNCH_SCHEMA = 'ops-desktop.quick-launch.websites'
const DEFAULT_COLOR = '#6366f1'
const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/
const CONTROL_CHARACTER_RANGE = `${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}`
const CONTROL_CHARACTERS = new RegExp(`[${CONTROL_CHARACTER_RANGE}]`, 'g')

function normalizeText(value, fallback = '', maxLength = 120) {
  const text = typeof value === 'string' ? value.trim().replace(CONTROL_CHARACTERS, '') : ''
  return (text || fallback).slice(0, maxLength)
}

function getUrlName(target) {
  try {
    const url = new URL(target)
    return url.hostname || url.pathname || '网站快捷方式'
  } catch {
    return '网站快捷方式'
  }
}

function normalizeWebsiteItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('配置项必须是对象')
  }

  const target = normalizeExternalUrl(item.target || item.url)
  return {
    id: randomUUID(),
    name: normalizeText(item.name, getUrlName(target)),
    type: 'url',
    target,
    icon: normalizeText(item.icon, '', 4),
    color: SAFE_COLOR.test(item.color || '') ? item.color : DEFAULT_COLOR,
    quickOpen: item.quickOpen === true
  }
}

function parseWebsiteBatch(raw) {
  const parsed = JSON.parse(raw)
  const sourceItems = Array.isArray(parsed) ? parsed : parsed?.items
  if (!Array.isArray(sourceItems)) {
    throw new Error('JSON 顶层必须是网址数组，或包含 items 数组')
  }
  if (sourceItems.length > MAX_BATCH_ITEMS) {
    throw new Error(`单次最多导入 ${MAX_BATCH_ITEMS} 个网址`)
  }

  const items = []
  const errors = []
  const targets = new Set()
  sourceItems.forEach((item, index) => {
    try {
      const normalized = normalizeWebsiteItem(item)
      if (targets.has(normalized.target)) {
        errors.push(`第 ${index + 1} 项网址重复`)
        return
      }
      targets.add(normalized.target)
      items.push(normalized)
    } catch (error) {
      errors.push(`第 ${index + 1} 项：${error.message}`)
    }
  })

  if (sourceItems.length && !items.length) {
    throw new Error(errors[0] || '没有可导入的网址')
  }

  return { items, skipped: errors.length, errors: errors.slice(0, 5) }
}

function makeWebsiteExport(items) {
  const websites = []
  const targets = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.type !== 'url') continue
    try {
      const normalized = normalizeWebsiteItem(item)
      if (targets.has(normalized.target)) continue
      targets.add(normalized.target)
      const { id: _id, ...website } = normalized
      websites.push(website)
    } catch {
      // 导出时跳过历史中的无效网址；不影响其它可用项。
    }
  }

  return {
    schema: QUICK_LAUNCH_SCHEMA,
    version: 1,
    generatedAt: new Date().toISOString(),
    items: websites
  }
}

module.exports = {
  MAX_BATCH_ITEMS,
  QUICK_LAUNCH_SCHEMA,
  normalizeWebsiteItem,
  parseWebsiteBatch,
  makeWebsiteExport
}
