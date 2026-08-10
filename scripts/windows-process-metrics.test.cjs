const assert = require('node:assert/strict')
const test = require('node:test')

const {
  getPortUsage,
  parseWindowsProcessMetrics,
  __testables: { buildWindowsMetricsCommand, enrichProcessMetrics }
} = require('../src/main/port-manager')

const netstatSample = `  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:5173        0.0.0.0:0              LISTENING       4242
  TCP    127.0.0.1:8080        0.0.0.0:0              LISTENING       5151`

const tasklistSample = `
INFO: tasklist sample
Image Name                     PID Session Name        Session#    Mem Usage
========================= ======== ================ =========== ============
node.exe                    4242 Console                    1     12,000 K
node.exe                    5151 Console                    1     18,000 K`

function baseEntry(pid = 4242) {
  return {
    command: 'node.exe',
    pid,
    user: '',
    protocol: 'TCP',
    port: 5173,
    address: '127.0.0.1:5173',
    state: 'LISTENING'
  }
}

test('Windows Node metrics use an injectable PowerShell/CIM command and preserve real zeroes', async () => {
  const calls = []
  const result = await getPortUsage({
    platform: 'win32',
    runCommand: async (command, args) => {
      calls.push({ command, args })
      if (command === 'netstat') return netstatSample
      if (command === 'tasklist') return tasklistSample
      assert.equal(command, 'powershell.exe')
      assert.ok(args.includes('-NoProfile'))
      assert.match(args.at(-1), /Get-CimInstance -ClassName Win32_Process/)
      return JSON.stringify([
        {
          pid: 4242,
          cpuPercent: 0,
          memoryBytes: 0,
          startedAt: '2026-08-10T01:02:03.0000000Z',
          parentPid: 1000
        },
        {
          pid: 5151,
          cpuPercent: 4.5,
          memoryBytes: 65_536,
          startedAt: '2026-08-10T02:03:04.0000000Z',
          parentPid: 1001
        }
      ])
    }
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.entries, [
    {
      ...baseEntry(4242),
      cpuPercent: 0,
      memoryBytes: 0,
      startedAt: '2026-08-10T01:02:03.000Z',
      parentPid: 1000,
      metricsAvailable: true,
      metricsStatus: 'available'
    },
    {
      ...baseEntry(5151),
      port: 8080,
      address: '127.0.0.1:8080',
      cpuPercent: 4.5,
      memoryBytes: 65_536,
      startedAt: '2026-08-10T02:03:04.000Z',
      parentPid: 1001,
      metricsAvailable: true,
      metricsStatus: 'available'
    }
  ])
  assert.deepEqual(
    calls.map(({ command }) => command),
    ['netstat', 'tasklist', 'powershell.exe']
  )
})

test('Windows metrics failures retain Node port entries and mark metrics unavailable', async () => {
  const result = await getPortUsage({
    platform: 'win32',
    runCommand: async (command) => {
      if (command === 'netstat') return netstatSample
      if (command === 'tasklist') return tasklistSample
      throw new Error('CIM unavailable')
    }
  })

  assert.equal(result.ok, true)
  assert.equal(result.entries.length, 2)
  assert.deepEqual(result.entries[0], {
    ...baseEntry(4242),
    cpuPercent: null,
    memoryBytes: null,
    startedAt: null,
    parentPid: null,
    metricsAvailable: false,
    metricsStatus: 'unavailable'
  })
  assert.equal(result.entries[1].metricsAvailable, false)
  assert.equal(result.entries[1].metricsStatus, 'unavailable')
})

test('Windows parser and command builder reject unsafe input without invoking arbitrary commands', () => {
  const command = buildWindowsMetricsCommand([4242, '5151'])
  assert.equal(command.command, 'powershell.exe')
  assert.deepEqual(command.args.slice(0, 4), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command'
  ])
  assert.match(command.args[4], /\$targetPids = @\(4242,5151\)/)
  assert.match(command.args[4], /Get-CimInstance/)
  assert.throws(() => buildWindowsMetricsCommand(['4242; Write-Host injected']), /有效的正整数/)
  assert.deepEqual(parseWindowsProcessMetrics('null'), new Map())
})

test('macOS/Linux process metrics keep the existing ps-compatible output', async () => {
  const calls = []
  const entries = [baseEntry()]
  const result = await enrichProcessMetrics(entries, {
    platform: 'darwin',
    runCommand: async (command, args) => {
      calls.push({ command, args })
      return '4242 0.0 512'
    }
  })

  assert.deepEqual(result, [{ ...baseEntry(), cpuPercent: 0, memoryBytes: 512 * 1024 }])
  assert.deepEqual(calls, [{ command: 'ps', args: ['-o', 'pid=,pcpu=,rss=', '-p', '4242'] }])
})
