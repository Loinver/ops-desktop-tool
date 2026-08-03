const os = require('node:os')
const { ipcMain } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')

/**
 * 注册系统信息相关的 IPC 处理器
 */
function registerSystemHandlers() {
  ipcMain.handle(IPC_CHANNELS.SYSTEM_INFO, async () => {
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memPercent = Math.round((usedMem / totalMem) * 100)

    const cpus = os.cpus()
    const cpuModel = cpus.length > 0 ? cpus[0].model : '未知'

    const uptime = os.uptime()
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)

    return {
      platform:
        os.platform() === 'darwin' ? 'macOS' : os.platform() === 'win32' ? 'Windows' : 'Linux',
      arch: os.arch(),
      nodeVersion: process.version,
      uptime: `${hours} 小时 ${minutes} 分钟`,
      memory: `${Math.round((usedMem / 1024 / 1024 / 1024) * 10) / 10} GB / ${Math.round((totalMem / 1024 / 1024 / 1024) * 10) / 10} GB (${memPercent}%)`,
      cpu: cpuModel.length > 40 ? cpuModel.substring(0, 40) + '...' : cpuModel,
      hostname: os.hostname()
    }
  })
}

module.exports = { registerSystemHandlers }
