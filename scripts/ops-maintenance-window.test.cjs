const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  activeMaintenanceWindow,
  loadMaintenanceWindow,
  saveMaintenanceWindow
} = require('../src/main/utils/ops-maintenance-window')

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-maintenance-window-'))
}

test('维护窗口持久化并区分未开始、进行中和过期状态', () => {
  const userDataPath = createTempDir()
  try {
    const saved = saveMaintenanceWindow(
      userDataPath,
      { enabled: true, startAt: 2_000, endAt: 8_000, reason: '  planned change  ' },
      { now: 1_000 }
    )
    assert.equal(saved.status, 'upcoming')
    assert.equal(saved.reason, 'planned change')
    assert.equal(loadMaintenanceWindow(userDataPath, { now: 3_000 }).status, 'active')
    assert.equal(activeMaintenanceWindow(userDataPath, { now: 3_000 }).resumeAt, 8_000)
    assert.equal(loadMaintenanceWindow(userDataPath, { now: 9_000 }).status, 'expired')
    assert.equal(activeMaintenanceWindow(userDataPath, { now: 9_000 }), null)
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})

test('维护窗口拒绝无效、过长和过远的时间范围', () => {
  const userDataPath = createTempDir()
  try {
    assert.throws(
      () =>
        saveMaintenanceWindow(
          userDataPath,
          { enabled: true, startAt: 2_000, endAt: 2_000 },
          { now: 1_000 }
        ),
      /结束时间必须晚于开始时间/
    )
    assert.throws(
      () =>
        saveMaintenanceWindow(
          userDataPath,
          { enabled: true, startAt: 1_000, endAt: 8 * 24 * 60 * 60_000 },
          { now: 1_000 }
        ),
      /最长为 7 天/
    )
    assert.throws(
      () =>
        saveMaintenanceWindow(
          userDataPath,
          { enabled: true, startAt: 31 * 24 * 60 * 60_000, endAt: 32 * 24 * 60 * 60_000 },
          { now: 1_000 }
        ),
      /提前 30 天/
    )
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
})
