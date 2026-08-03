const fs = require('node:fs')
const path = require('node:path')

let logDir = ''
let initialized = false

const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5 MB per file before rolling
const MAX_LOG_AGE_DAYS = 14

/**
 * 初始化日志目录。在 app.whenReady() 后调用。
 * @param {{ userDataPath: string }} opts
 */
function initLogger({ userDataPath }) {
  logDir = path.join(userDataPath, 'logs')
  try {
    fs.mkdirSync(logDir, { recursive: true })
    initialized = true
    cleanupOldLogs()
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

/**
 * 删除超过 MAX_LOG_AGE_DAYS 天的日志文件。
 */
function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(logDir)
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000
    for (const file of files) {
      if (!file.startsWith('ops-desktop-') || !file.endsWith('.log')) continue
      const stat = fs.statSync(path.join(logDir, file))
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(path.join(logDir, file))
      }
    }
  } catch {
    // 清理失败不影响主流程
  }
}

/**
 * 当当前日志文件超过 MAX_LOG_SIZE 时滚动为 .1.log、.2.log（最多保留 3 份）。
 */
function maybeRoll(file) {
  try {
    const stat = fs.statSync(file)
    if (stat.size < MAX_LOG_SIZE) return
    for (let i = 3; i >= 1; i--) {
      const src = i === 1 ? file.replace(/\.log$/, '.1.log') : file.replace(/\.log$/, `.${i}.log`)
      const dst = file.replace(/\.log$/, `.${i + 1}.log`)
      if (fs.existsSync(src)) {
        if (i === 3) {
          fs.unlinkSync(src)
        } else {
          fs.renameSync(src, dst)
        }
      }
    }
    fs.renameSync(file, file.replace(/\.log$/, '.1.log'))
  } catch {
    // stat 失败说明文件还不存在，无需滚动
  }
}

function write(level, message, extra) {
  const entry = JSON.stringify({ ts: timestamp(), level, msg: message, ...(extra || {}) })
  if (initialized) {
    try {
      const file = logFile()
      maybeRoll(file)
      fs.appendFileSync(file, entry + '\n')
    } catch {
      /* 写入失败时忽略 */
    }
  }
  // 开发模式同时输出到控制台
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  fn(`[${level.toUpperCase()}] ${message}`, extra || '')
}

module.exports = {
  initLogger,
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra)
}
