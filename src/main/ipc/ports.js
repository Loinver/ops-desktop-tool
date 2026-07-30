const { ipcMain } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const {
  getPortUsage,
  findPortUsage,
  killByPort,
  killByPid
} = require('../port-manager')

/**
 * 注册端口管理相关的 IPC 处理器
 */
function registerPortsHandlers() {
  ipcMain.handle(IPC_CHANNELS.PORTS_LIST, async () => getPortUsage())
  ipcMain.handle(IPC_CHANNELS.PORTS_FIND, async (_event, port) => findPortUsage(port))
  ipcMain.handle(IPC_CHANNELS.PORTS_KILL_PORT, async (_event, payload) => {
    return killByPort(payload?.port, payload?.signal)
  })
  ipcMain.handle(IPC_CHANNELS.PORTS_KILL_PID, async (_event, payload) => {
    return killByPid(payload?.pid, payload?.signal)
  })
}

module.exports = { registerPortsHandlers }
