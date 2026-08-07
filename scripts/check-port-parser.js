const assert = require('node:assert/strict')
const { parseLsof, parseNetstatWindows, parsePsMetrics } = require('../src/main/port-manager')

const lsofSample = `COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node    10123 testuser  23u  IPv6 0x123456789abcdef0      0t0  TCP *:5173 (LISTEN)
Google   2048 testuser  10u  IPv4 0x223456789abcdef0      0t0  UDP *:5353`

const netstatSample = `  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1112
  UDP    0.0.0.0:1900           *:*                                    2224`

const lsofEntries = parseLsof(lsofSample)
assert.equal(lsofEntries.length, 2)
assert.equal(lsofEntries[0].port, 5173)
assert.equal(lsofEntries[0].pid, 10123)
assert.equal(lsofEntries[1].protocol, 'UDP')

const winEntries = parseNetstatWindows(netstatSample)
assert.equal(winEntries.length, 2)
assert.equal(winEntries[0].port, 135)
assert.equal(winEntries[1].pid, 2224)

const metrics = parsePsMetrics(`10123 12.5 2048
invalid row
2048 0.0 512`)
assert.deepEqual(metrics.get(10123), { cpuPercent: 12.5, memoryBytes: 2097152 })
assert.deepEqual(metrics.get(2048), { cpuPercent: 0, memoryBytes: 524288 })

console.log('port parser checks passed')
