const fs = require('node:fs')
const path = require('node:path')

let logDir = ''
let initialized = false

/**
 * 初始化日志目录。在 app.whenReady() 后调用。
 * @param {{ userDataPath: string }} opts
 */
function initLogger({ userDataPath }) {
  logDir = path.join(userDataPath, 'logs')
  try {
    fs.mkdirSync(logDir, { recursive: true })
    initialized = true
  } catch {
    // 创建失败时仅输出到控制台
  }
}

function timestamp() {
  return new Date().toISOString()
}

function logFile() {
  const day = new Date().toISOString().slice(0, 10)
  return path.join(logDir, `ops-desktop-${day}.log`)
}

function write(level, message, extra) {
  const entry = JSON.stringify({ ts: timestamp(), level, msg: message, ...(extra || {}) })
  if (initialized) {
    try { fs.appendFileSync(logFile(), entry + '\n') } catch { /* 写入失败时忽略 */ }
  }
  // 开发模式同时输出到控制台
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(`[${level.toUpperCase()}] ${message}`, extra || '')
}

module.exports = {
  initLogger,
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
}
