/**
 * 格式化文件大小
 * @param {number} size - 字节数
 * @returns {string}
 */
function formatSize(size) {
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let formattedSize = size
  while (formattedSize >= 1024 && unitIndex < units.length - 1) {
    formattedSize /= 1024
    unitIndex++
  }
  return `${formattedSize.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

/**
 * 格式化时间戳
 * @param {number} timestamp - Unix 时间戳（秒或毫秒，自动判断）
 * @returns {string}
 */
function formatTime(timestamp) {
  if (!timestamp) return '-'
  // ssh2-sftp-client 返回的是毫秒级时间戳，如果是秒级（10位数）则转换
  const ts = timestamp > 1e12 ? timestamp : timestamp * 1000
  const date = new Date(ts)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

/**
 * 格式化文件权限
 * @param {object} rights - 权限对象
 * @returns {string}
 */
function formatPermissions(rights) {
  if (!rights) return '-'
  return rights.user + rights.group + rights.other
}

/**
 * 获取文件类型图标（TDesign 图标名称）
 * @param {object} item - 文件项
 * @returns {string}
 */
function getFileTypeIcon(item) {
  if (item.type === 'd') return 'folder'
  const path = require('node:path')
  const ext = path.extname(item.name).toLowerCase()
  const iconMap = {
    '.js': 'code',
    '.ts': 'code',
    '.vue': 'code',
    '.jsx': 'code',
    '.tsx': 'code',
    '.json': 'file',
    '.md': 'file',
    '.txt': 'file',
    '.log': 'file',
    '.html': 'earth',
    '.css': 'image',
    '.scss': 'image',
    '.png': 'image',
    '.jpg': 'image',
    '.jpeg': 'image',
    '.gif': 'image',
    '.svg': 'image',
    '.zip': 'folder-zip',
    '.tar': 'folder-zip',
    '.gz': 'folder-zip',
    '.sh': 'setting',
    '.conf': 'setting',
    '.yml': 'setting',
    '.sql': 'object-storage',
    '.db': 'object-storage'
  }
  return iconMap[ext] || 'file'
}

module.exports = { formatSize, formatTime, formatPermissions, getFileTypeIcon }
