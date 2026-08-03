const path = require('node:path')

const MAX_PATH_LENGTH = 4096

function assertStringPath(value, label = '路径') {
  if (typeof value !== 'string') throw new Error(`${label}无效`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label}不能为空`)
  if (trimmed.length > MAX_PATH_LENGTH || trimmed.includes('\0')) {
    throw new Error(`${label}无效`)
  }
  return trimmed
}

function normalizeRemotePath(value, { allowRoot = true } = {}) {
  const rawPath = assertStringPath(value, '远程路径').replace(/\\/g, '/')
  if (!rawPath.startsWith('/')) throw new Error('远程路径必须是绝对路径')

  const segments = rawPath.split('/')
  if (segments.some((segment) => segment === '..')) {
    throw new Error('远程路径不能包含上级目录跳转')
  }

  const normalized = path.posix.normalize(rawPath).replace(/\/{2,}/g, '/')
  if (!allowRoot && normalized === '/') {
    throw new Error('禁止对服务器根目录执行此操作')
  }
  return normalized
}

function assertLocalPath(value, label = '本地路径') {
  return assertStringPath(value, label)
}

module.exports = {
  assertLocalPath,
  normalizeRemotePath
}
