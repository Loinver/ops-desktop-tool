const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  checkWatchedNodeServices,
  listNodeServiceHistory,
  listWatchedNodeServices,
  unwatchNodeService,
  watchNodeService
} = require('../src/main/utils/node-service-monitor')
const { listOpsEvents } = require('../src/main/utils/ops-automation')

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'node-service-monitor-test-'))
}

const service = {
  protocol: 'TCP',
  port: 3000,
  pid: 1200,
  command: 'node server.js',
  address: '*:3000'
}

test('仅关注的 Node 服务离线时创建事件，并在恢复后自动关闭', () => {
  const userDataPath = createTempDir()
  try {
    const watched = watchNodeService(userDataPath, service)
    assert.equal(watched.id, 'TCP:3000')
    assert.equal(listWatchedNodeServices(userDataPath).length, 1)

    const online = checkWatchedNodeServices(userDataPath, [service], { now: 100 })
    assert.equal(online.changes.length, 0)
    assert.equal(listOpsEvents(userDataPath).length, 0)

    const offline = checkWatchedNodeServices(userDataPath, [], { now: 200 })
    assert.deepEqual(offline.changes, [{ id: 'TCP:3000', type: 'offline' }])
    let [event] = listOpsEvents(userDataPath)
    assert.equal(event.fingerprint, 'node-service:tcp:3000')
    assert.equal(event.sourceType, 'node-service')
    assert.equal(event.sourceId, 'TCP:3000')
    assert.equal(event.status, 'open')
    assert.equal(event.attributes.port, 3000)

    const stillOffline = checkWatchedNodeServices(userDataPath, [], { now: 300 })
    assert.equal(stillOffline.changes.length, 0)
    ;[event] = listOpsEvents(userDataPath)
    assert.equal(event.occurrenceCount, 1)

    const recovered = checkWatchedNodeServices(userDataPath, [{ ...service, pid: 1300 }], {
      now: 400
    })
    assert.deepEqual(recovered.changes, [{ id: 'TCP:3000', type: 'recovered' }])
    ;[event] = listOpsEvents(userDataPath)
    assert.equal(event.status, 'resolved')
    assert.equal(event.recoveredAt, 400)
    assert.equal(event.attributes.previousPid, 1200)
    assert.equal(event.attributes.currentPid, 1300)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('未关注服务不会产生事件，取消关注会关闭现有异常', () => {
  const userDataPath = createTempDir()
  try {
    checkWatchedNodeServices(userDataPath, [], { now: 100 })
    assert.equal(listOpsEvents(userDataPath).length, 0)

    watchNodeService(userDataPath, { ...service, protocol: 'udp', port: 5353 })
    checkWatchedNodeServices(userDataPath, [], { now: 200 })
    assert.equal(listOpsEvents(userDataPath, { status: 'open' }).length, 1)

    const removed = unwatchNodeService(userDataPath, { protocol: 'UDP', port: 5353 })
    assert.equal(removed.id, 'UDP:5353')
    assert.equal(listWatchedNodeServices(userDataPath).length, 0)
    const [event] = listOpsEvents(userDataPath)
    assert.equal(event.status, 'resolved')
    assert.match(event.resolutionNote, /取消关注/)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('记录有界 Node 服务状态与资源采样历史，并跳过短时间内未变化样本', () => {
  const userDataPath = createTempDir()
  try {
    watchNodeService(userDataPath, service)
    checkWatchedNodeServices(userDataPath, [{ ...service, cpuPercent: 12.5, memoryBytes: 1024 }], {
      now: 100
    })
    checkWatchedNodeServices(userDataPath, [{ ...service, cpuPercent: 12.5, memoryBytes: 1024 }], {
      now: 200
    })
    checkWatchedNodeServices(userDataPath, [], { now: 300 })
    checkWatchedNodeServices(
      userDataPath,
      [{ ...service, pid: 1300, cpuPercent: 8, memoryBytes: 2048 }],
      { now: 400 }
    )

    const history = listNodeServiceHistory(userDataPath, { serviceId: 'TCP:3000' })
    assert.equal(history.length, 3)
    assert.deepEqual(
      history.map((item) => [item.state, item.pid, item.memoryBytes]),
      [
        ['online', 1300, 2048],
        ['offline', 0, 0],
        ['online', 1200, 1024]
      ]
    )
    assert.equal(listNodeServiceHistory(userDataPath, { since: 350 }).length, 1)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})
