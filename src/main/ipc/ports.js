const { app, ipcMain } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { getPortUsage, findPortUsage, killByPort, killByPid } = require('../port-manager')
const {
  checkWatchedNodeServices,
  listWatchedNodeServices,
  unwatchNodeService,
  watchNodeService
} = require('../utils/node-service-monitor')

let monitorTimer = null
let monitorChecking = false

function userDataPath() {
  return app.getPath('userData')
}

async function runNodeServiceMonitorCheck() {
  if (monitorChecking) return { ok: false, error: 'Node 服务关注检查正在运行' }
  monitorChecking = true
  try {
    const result = await getPortUsage()
    if (!result.ok) return result
    const monitor = checkWatchedNodeServices(userDataPath(), result.entries)
    return { ok: true, ...monitor, entries: result.entries }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Node 服务关注检查失败' }
  } finally {
    monitorChecking = false
  }
}

function startNodeServiceMonitor() {
  if (monitorTimer) return
  monitorTimer = setInterval(() => {
    runNodeServiceMonitorCheck().catch((error) => console.error('Node 服务关注检查失败:', error))
  }, 60_000)
  monitorTimer.unref?.()
  void runNodeServiceMonitorCheck()
}

function stopNodeServiceMonitor() {
  if (!monitorTimer) return
  clearInterval(monitorTimer)
  monitorTimer = null
}

/**
 * 注册端口管理相关的 IPC 处理器
 */
function registerPortsHandlers() {
  startNodeServiceMonitor()
  ipcMain.handle(IPC_CHANNELS.PORTS_LIST, async () => getPortUsage())
  ipcMain.handle(IPC_CHANNELS.PORTS_FIND, async (_event, port) => findPortUsage(port))
  ipcMain.handle(IPC_CHANNELS.PORTS_KILL_PORT, async (_event, payload) => {
    return killByPort(payload?.port, payload?.signal)
  })
  ipcMain.handle(IPC_CHANNELS.PORTS_KILL_PID, async (_event, payload) => {
    return killByPid(payload?.pid, payload?.signal)
  })
  ipcMain.handle(IPC_CHANNELS.NODE_MONITOR_GET, async () => {
    try {
      return { ok: true, items: listWatchedNodeServices(userDataPath()) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '读取关注服务失败' }
    }
  })
  ipcMain.handle(IPC_CHANNELS.NODE_MONITOR_WATCH, async (_event, payload) => {
    try {
      return { ok: true, item: watchNodeService(userDataPath(), payload) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '关注服务失败' }
    }
  })
  ipcMain.handle(IPC_CHANNELS.NODE_MONITOR_UNWATCH, async (_event, payload) => {
    try {
      return { ok: true, item: unwatchNodeService(userDataPath(), payload) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '取消关注服务失败' }
    }
  })
  ipcMain.handle(IPC_CHANNELS.NODE_MONITOR_CHECK, async () => runNodeServiceMonitorCheck())
}

module.exports = { registerPortsHandlers, runNodeServiceMonitorCheck, stopNodeServiceMonitor }
