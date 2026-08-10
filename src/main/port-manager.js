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
    .filter((line) => /^(TCP|UDP)(?:v[46])?\s+/i.test(line))
    .map((line) => {
      const columns = line.split(/\s+/)
      const rawProtocol = columns[0].toUpperCase()
      const protocol = rawProtocol.startsWith('UDP') ? 'UDP' : 'TCP'
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

function parsePsMetrics(output) {
  const metrics = new Map()
  for (const line of String(output || '').split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 3) continue
    const pid = Number.parseInt(columns[0], 10)
    const cpuPercent = Number.parseFloat(columns[1])
    const rssKb = Number.parseInt(columns[2], 10)
    if (!Number.isInteger(pid) || pid < 1) continue
    metrics.set(pid, {
      cpuPercent: Number.isFinite(cpuPercent) ? Math.max(0, cpuPercent) : 0,
      memoryBytes: Number.isFinite(rssKb) ? Math.max(0, rssKb) * 1024 : 0
    })
  }
  return metrics
}

function normalizeWindowsPidList(pids) {
  const values = Array.isArray(pids) ? pids : []
  const normalized = values.map((pid) => Number(pid))
  if (normalized.some((pid) => !Number.isSafeInteger(pid) || pid < 1 || pid > 0xffffffff)) {
    throw new Error('Windows Node 指标 PID 必须是有效的正整数。')
  }
  return [...new Set(normalized)]
}

function buildWindowsMetricsCommand(pids) {
  const normalizedPids = normalizeWindowsPidList(pids)
  const targetPids = normalizedPids.join(',')
  const script = `
$ErrorActionPreference = 'Stop'
$targetPids = @(${targetPids})
$performanceByPid = @{}
Get-CimInstance -ClassName Win32_PerfFormattedData_PerfProc_Process |
  Where-Object { $targetPids -contains [int]$_.IDProcess } |
  ForEach-Object { $performanceByPid[[int]$_.IDProcess] = $_ }
$results = @(
  Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $targetPids -contains [int]$_.ProcessId } |
    ForEach-Object {
      $process = $_
      $performance = $performanceByPid[[int]$process.ProcessId]
      $startedAt = $null
      if ($process.CreationDate) {
        $startedAt = ([datetime]$process.CreationDate).ToUniversalTime().ToString('o')
      }
      [pscustomobject]@{
        pid = [int]$process.ProcessId
        parentPid = if ($null -ne $process.ParentProcessId) { [int]$process.ParentProcessId } else { $null }
        memoryBytes = if ($null -ne $process.WorkingSetSize) { [int64]$process.WorkingSetSize } else { $null }
        startedAt = $startedAt
        cpuPercent = if ($performance -and $null -ne $performance.PercentProcessorTime) { [double]$performance.PercentProcessorTime } else { $null }
      }
    }
)
$results | ConvertTo-Json -Compress
`.trim()

  return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]
  }
}

function normalizeMetricNumber(value, { integer = false } = {}) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    return null
  }
  return number
}

function normalizeStartedAt(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const timestamp = Date.parse(String(value))
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function parseWindowsProcessMetrics(output) {
  const text = String(output || '')
    .replace(/^\uFEFF/, '')
    .trim()
  if (!text || text === 'null') {
    return new Map()
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`Windows Node 指标输出不是有效 JSON：${error.message}`, { cause: error })
  }

  const records = Array.isArray(parsed) ? parsed : [parsed]
  const metrics = new Map()
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const pid = normalizeMetricNumber(record.pid, { integer: true })
    if (!pid || pid > 0xffffffff) continue

    const cpuPercent = normalizeMetricNumber(record.cpuPercent)
    const memoryBytes = normalizeMetricNumber(record.memoryBytes, { integer: true })
    const parentPid = normalizeMetricNumber(record.parentPid, { integer: true })
    const startedAt = normalizeStartedAt(record.startedAt)
    const metricsAvailable =
      cpuPercent !== null && memoryBytes !== null && parentPid !== null && startedAt !== null

    metrics.set(pid, {
      cpuPercent,
      memoryBytes,
      startedAt,
      parentPid,
      metricsAvailable,
      metricsStatus: metricsAvailable ? 'available' : 'unavailable'
    })
  }
  return metrics
}

function unavailableWindowsMetrics(entry) {
  return {
    ...entry,
    cpuPercent: null,
    memoryBytes: null,
    startedAt: null,
    parentPid: null,
    metricsAvailable: false,
    metricsStatus: 'unavailable'
  }
}

async function collectWindowsProcessMetrics(
  pids,
  {
    runCommand = run,
    parseWindowsMetrics = parseWindowsProcessMetrics,
    buildCommand = buildWindowsMetricsCommand
  } = {}
) {
  const command = buildCommand(pids)
  const output = await runCommand(command.command, command.args)
  const metrics = parseWindowsMetrics(output)
  if (!(metrics instanceof Map)) {
    throw new Error('Windows Node 指标解析器必须返回 Map。')
  }
  return metrics
}

async function enrichProcessMetrics(
  entries,
  {
    platform = os.platform(),
    runCommand = run,
    parseWindowsMetrics = parseWindowsProcessMetrics,
    buildWindowsCommand = buildWindowsMetricsCommand
  } = {}
) {
  const items = Array.isArray(entries) ? entries : []
  if (items.length === 0) return items
  const pids = [...new Set(items.map((entry) => Number(entry.pid)).filter((pid) => pid > 0))]
  if (!pids.length) return items

  if (platform === 'win32') {
    try {
      const metrics = await collectWindowsProcessMetrics(pids, {
        runCommand,
        parseWindowsMetrics,
        buildCommand: buildWindowsCommand
      })
      return items.map((entry) => {
        const metric = metrics.get(Number(entry.pid))
        return metric ? { ...entry, ...metric } : unavailableWindowsMetrics(entry)
      })
    } catch {
      return items.map(unavailableWindowsMetrics)
    }
  }

  try {
    const output = await runCommand('ps', ['-o', 'pid=,pcpu=,rss=', '-p', pids.join(',')])
    const metrics = parsePsMetrics(output)
    return items.map((entry) => ({ ...entry, ...(metrics.get(entry.pid) || {}) }))
  } catch {
    return items
  }
}

async function getPortUsage({
  platform = os.platform(),
  runCommand = run,
  parseWindowsMetrics = parseWindowsProcessMetrics,
  buildWindowsCommand = buildWindowsMetricsCommand
} = {}) {
  try {
    if (platform === 'win32') {
      const [netstatOutput, taskOutput] = await Promise.all([
        runCommand('netstat', ['-ano']),
        runCommand('tasklist', [])
      ])
      const names = parseTasklist(taskOutput)
      const entries = parseNetstatWindows(netstatOutput).map((entry) => ({
        ...entry,
        command: names.get(entry.pid) || entry.command
      }))

      return {
        ok: true,
        platform,
        entries: await enrichProcessMetrics(
          sortEntries(filterNodeEntries(uniqueEntries(entries))),
          {
            platform,
            runCommand,
            parseWindowsMetrics,
            buildWindowsCommand
          }
        ),
        scannedAt: new Date().toISOString()
      }
    }

    const [tcpOutput, udpOutput] = await Promise.allSettled([
      runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']),
      runCommand('lsof', ['-nP', '-iUDP'])
    ])

    const entries = []
    if (tcpOutput.status === 'fulfilled') {
      entries.push(...parseLsof(tcpOutput.value, 'TCP'))
    }
    if (udpOutput.status === 'fulfilled') {
      entries.push(...parseLsof(udpOutput.value, 'UDP'))
    }

    const nodeEntries = sortEntries(filterNodeEntries(uniqueEntries(entries)))
    return {
      ok: true,
      platform,
      entries: await enrichProcessMetrics(nodeEntries, {
        platform,
        runCommand,
        parseWindowsMetrics,
        buildWindowsCommand
      }),
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

async function terminateProcess(
  pid,
  signal,
  { platform = os.platform(), runCommand = run, killProcess = process.kill } = {}
) {
  if (platform === 'win32') {
    const args = ['/PID', String(pid), '/T']
    if (signal === 'SIGKILL') args.push('/F')
    await runCommand('taskkill', args)
    return { method: 'taskkill', processTree: true, forced: signal === 'SIGKILL' }
  }

  killProcess(pid, signal)
  return { method: 'signal', processTree: false, forced: signal === 'SIGKILL' }
}

async function killByPid(pid, signal = 'SIGTERM', options = {}) {
  const value = Number.parseInt(String(pid), 10)
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, error: 'PID 必须是正整数。' }
  }

  const normalizedSignal = normalizeSignal(signal)
  try {
    const termination = await terminateProcess(value, normalizedSignal, options)
    return {
      ok: true,
      killed: [{ pid: value, signal: normalizedSignal, ...termination }],
      message:
        termination.method === 'taskkill'
          ? `已结束 PID ${value} 的进程树。`
          : `已向 PID ${value} 发送 ${normalizedSignal}。`
    }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

async function killByPort(port, signal = 'SIGTERM', options = {}) {
  let normalizedPort
  try {
    normalizedPort = normalizePort(port)
  } catch (error) {
    return { ok: false, error: error.message }
  }

  const result = options.portUsageResult || (await findPortUsage(normalizedPort))
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
      const termination = await terminateProcess(pid, normalizedSignal, options)
      killed.push({ pid, signal: normalizedSignal, ...termination })
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
    return '缺少系统命令：当前系统未找到 lsof、netstat、tasklist 或 taskkill。'
  }

  return error.stderr?.trim() || error.message || String(error)
}

module.exports = {
  getPortUsage,
  findPortUsage,
  killByPort,
  killByPid,
  parseLsof,
  parseNetstatWindows,
  parsePsMetrics,
  parseWindowsProcessMetrics,
  __testables: {
    buildWindowsMetricsCommand,
    collectWindowsProcessMetrics,
    enrichProcessMetrics,
    normalizeSignal,
    terminateProcess
  }
}
