const { execFile } = require('node:child_process')
const os = require('node:os')

const ALLOWED_SIGNALS = new Set(['SIGTERM', 'SIGKILL'])

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 12000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr
        error.stdout = stdout
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}

function normalizeSignal(signal) {
  return ALLOWED_SIGNALS.has(signal) ? signal : 'SIGTERM'
}

function normalizePort(port) {
  const value = Number.parseInt(String(port), 10)
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('端口号必须是 1 到 65535 之间的整数。')
  }
  return value
}

function parseLsof(output, protocolHint) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const columns = line.split(/\s+/)
      if (columns.length < 9) {
        return null
      }

      const command = columns[0]
      const pid = Number.parseInt(columns[1], 10)
      const user = columns[2]
      const protocol = protocolHint || columns[7] || ''
      const name = columns.slice(8).join(' ')
      const portMatch = name.match(/:(\d+)(?:\s|\(|$)/)

      if (!Number.isInteger(pid) || !portMatch) {
        return null
      }

      return {
        command,
        pid,
        user,
        protocol: protocol.toUpperCase(),
        port: Number.parseInt(portMatch[1], 10),
        address: name.replace(/\s+\(LISTEN\)$/i, ''),
        state: /\(LISTEN\)/i.test(name) ? 'LISTEN' : protocol.toUpperCase() === 'UDP' ? 'UDP' : ''
      }
    })
    .filter(Boolean)
}

function parseNetstatWindows(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(TCP|UDP)\s+/i.test(line))
    .map((line) => {
      const columns = line.split(/\s+/)
      const protocol = columns[0].toUpperCase()
      const local = columns[1] || ''
      const pidText = columns[protocol === 'UDP' ? 3 : 4]
      const pid = Number.parseInt(pidText, 10)
      const portMatch = local.match(/:(\d+)$/)

      if (!Number.isInteger(pid) || !portMatch) {
        return null
      }

      return {
        command: 'PID ' + pid,
        pid,
        user: '',
        protocol,
        port: Number.parseInt(portMatch[1], 10),
        address: local,
        state: protocol === 'UDP' ? 'UDP' : columns[3] || ''
      }
    })
    .filter(Boolean)
}

function parseTasklist(output) {
  const map = new Map()

  output
    .split(/\r?\n/)
    .slice(3)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^(.+?)\s+(\d+)\s+/)
      if (match) {
        map.set(Number.parseInt(match[2], 10), match[1].trim())
      }
    })

  return map
}

function uniqueEntries(entries) {
  const seen = new Set()
  return entries.filter((entry) => {
    const key = [entry.protocol, entry.port, entry.pid, entry.address].join('|')
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function sortEntries(entries) {
  return entries.sort((a, b) => {
    if (a.port !== b.port) {
      return a.port - b.port
    }
    if (a.protocol !== b.protocol) {
      return a.protocol.localeCompare(b.protocol)
    }
    return a.pid - b.pid
  })
}

function isNodeProcess(command) {
  if (!command) {
    return false
  }

  const lower = command.toLowerCase()
  const basename = lower.split('/').pop().split('\\').pop()

  // 精确匹配 node 可执行文件
  if (basename === 'node' || basename === 'node.exe') {
    return true
  }

  // 匹配 node 的完整路径
  if (lower.endsWith('/node') || lower.endsWith('\\node') || lower.endsWith('/node.exe')) {
    return true
  }

  return false
}

function filterNodeEntries(entries) {
  return entries.filter((entry) => isNodeProcess(entry.command))
}

async function getPortUsage() {
  const platform = os.platform()

  try {
    if (platform === 'win32') {
      const [netstatOutput, taskOutput] = await Promise.all([
        run('netstat', ['-ano']),
        run('tasklist', [])
      ])
      const names = parseTasklist(taskOutput)
      const entries = parseNetstatWindows(netstatOutput).map((entry) => ({
        ...entry,
        command: names.get(entry.pid) || entry.command
      }))

      return {
        ok: true,
        platform,
        entries: sortEntries(filterNodeEntries(uniqueEntries(entries))),
        scannedAt: new Date().toISOString()
      }
    }

    const [tcpOutput, udpOutput] = await Promise.allSettled([
      run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']),
      run('lsof', ['-nP', '-iUDP'])
    ])

    const entries = []
    if (tcpOutput.status === 'fulfilled') {
      entries.push(...parseLsof(tcpOutput.value, 'TCP'))
    }
    if (udpOutput.status === 'fulfilled') {
      entries.push(...parseLsof(udpOutput.value, 'UDP'))
    }

    return {
      ok: true,
      platform,
      entries: sortEntries(filterNodeEntries(uniqueEntries(entries))),
      scannedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      ok: false,
      platform,
      entries: [],
      error: formatError(error)
    }
  }
}

async function findPortUsage(port) {
  const normalizedPort = normalizePort(port)
  const result = await getPortUsage()
  if (!result.ok) {
    return result
  }

  return {
    ...result,
    entries: result.entries.filter((entry) => entry.port === normalizedPort)
  }
}

async function killByPid(pid, signal = 'SIGTERM') {
  const value = Number.parseInt(String(pid), 10)
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, error: 'PID 必须是正整数。' }
  }

  try {
    process.kill(value, normalizeSignal(signal))
    return {
      ok: true,
      killed: [{ pid: value, signal: normalizeSignal(signal) }],
      message: `已向 PID ${value} 发送 ${normalizeSignal(signal)}。`
    }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

async function killByPort(port, signal = 'SIGTERM') {
  let normalizedPort
  try {
    normalizedPort = normalizePort(port)
  } catch (error) {
    return { ok: false, error: error.message }
  }

  const result = await findPortUsage(normalizedPort)
  if (!result.ok) {
    return result
  }

  const pids = [...new Set(result.entries.map((entry) => entry.pid))]
  if (pids.length === 0) {
    return { ok: false, error: `未找到占用端口 ${normalizedPort} 的进程。` }
  }

  const killed = []
  const failed = []
  const normalizedSignal = normalizeSignal(signal)

  for (const pid of pids) {
    try {
      process.kill(pid, normalizedSignal)
      killed.push({ pid, signal: normalizedSignal })
    } catch (error) {
      failed.push({ pid, error: formatError(error) })
    }
  }

  return {
    ok: failed.length === 0,
    killed,
    failed,
    message:
      failed.length === 0
        ? `已结束占用端口 ${normalizedPort} 的 ${killed.length} 个进程。`
        : `部分进程未能结束：成功 ${killed.length} 个，失败 ${failed.length} 个。`
  }
}

function formatError(error) {
  if (!error) {
    return '未知错误。'
  }

  if (error.code === 'EPERM') {
    return '权限不足，无法结束该进程。请以管理员权限运行应用后重试。'
  }
  if (error.code === 'ESRCH') {
    return '进程不存在，可能已经退出。'
  }
  if (error.code === 'ENOENT') {
    return '缺少系统命令：当前系统未找到 lsof、netstat 或 tasklist。'
  }

  return error.stderr?.trim() || error.message || String(error)
}

module.exports = {
  getPortUsage,
  findPortUsage,
  killByPort,
  killByPid,
  parseLsof,
  parseNetstatWindows
}
