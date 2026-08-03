const fs = require('node:fs')
const path = require('node:path')

/**
 * 读取 JSON 文件
 * @param {string} filePath - 文件路径
 * @param {*} defaultValue - 默认值
 * @returns {*}
 */
function readJsonFile(filePath, defaultValue = []) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch (err) {
    console.error('读取文件失败:', err)
  }
  return defaultValue
}

/**
 * 原子写入 JSON 文件，并限制为仅当前用户可读写。
 * @param {string} filePath - 文件路径
 * @param {*} data - 要写入的数据
 * @returns {boolean}
 */
function writeJsonFile(filePath, data) {
  const tempPath = `${filePath}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    })
    fs.renameSync(tempPath, filePath)
    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      // Windows 等平台可能不支持 POSIX 权限，忽略即可。
    }
    return true
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    } catch {}
    console.error('写入文件失败:', err)
    return false
  }
}

module.exports = { readJsonFile, writeJsonFile }
