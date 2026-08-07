const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, dialog, ipcMain } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { readJsonFile } = require('../utils/json-store')
const { normalizeMonitorSettings } = require('../utils/model-monitor')
const {
  eventSummary,
  listAutomationTasks,
  listOpsEvents,
  runAutomationTask,
  updateOpsEvent
} = require('../utils/ops-automation')
const { normalizeOpsDataChange, onOpsDataChange } = require('../utils/ops-data-change')
const { buildRunbookPlan, executeRunbook, listRunbookHistory } = require('../utils/ops-runbook')
const { buildOpsDiagnosticsBundle } = require('../utils/ops-diagnostics')
const { listAuditRecords } = require('../utils/security-audit')
const {
  buildOpsInsights,
  loadOpsInsightsSettings,
  saveOpsInsightsSettings
} = require('../utils/ops-insights')
const { getAutoBackupHealth } = require('../utils/app-data-backup')
const { listNodeServiceHistory, listWatchedNodeServices } = require('../utils/node-service-monitor')
const { loadEvaluationState, loadLogState } = require('../utils/ai-ops')
const { loadReleaseHistory } = require('../utils/release-store')
const { runScheduledInspection } = require('./model-test')
const { runNodeServiceMonitorCheck } = require('./ports')

let unsubscribeOpsDataChanges = null
let runtime = null

function userDataPath() {
  return runtime?.userDataPath || app.getPath('userData')
}

function modelHistory(currentUserDataPath = userDataPath()) {
  const value = readJsonFile(path.join(currentUserDataPath, 'model-test-history.json'), [])
  return Array.isArray(value) ? value.slice(0, 100) : []
}

function modelMonitorSettings(currentUserDataPath = userDataPath()) {
  return normalizeMonitorSettings(
    readJsonFile(path.join(currentUserDataPath, 'model-monitor-settings.json'), {})
  )
}

function findOpsEvent(eventId) {
  const normalizedId = String(eventId || '')
    .trim()
    .slice(0, 120)
  if (!normalizedId) throw new Error('缺少运维事件标识')
  const event = listOpsEvents(userDataPath(), { limit: 500 }).find(
    (item) => item.id === normalizedId
  )
  if (!event) throw new Error('运维事件不存在或已被清理')
  return event
}

function resultMessage(result, fallback) {
  return String(result?.message || result?.summary || result?.error || fallback || '')
    .trim()
    .slice(0, 500)
}

function modelResultForEvent(snapshot, event) {
  const providerId = String(event?.attributes?.providerId || '').trim()
  const model = String(event?.attributes?.model || '').trim()
  return (Array.isArray(snapshot?.results) ? snapshot.results : []).find(
    (item) => (!providerId || item?.providerId === providerId) && (!model || item?.model === model)
  )
}

function modelRecheckOutcome(snapshot, event) {
  const matched = modelResultForEvent(snapshot, event)
  if (!matched) {
    return {
      ok: false,
      message: '本次巡检未覆盖原事件目标，事件不会自动关闭'
    }
  }
  return {
    ok: matched.status === 'ok',
    message: `${matched.model || '目标模型'}：${matched.message || matched.status || '未知状态'}`
  }
}

function createRunbookHandlers(event) {
  return {
    'automation.diagnose': () => {
      const task = listAutomationTasks(userDataPath()).find((item) => item.id === event.sourceId)
      if (!task) return { ok: false, message: '关联巡检任务已不存在' }
      return {
        ok: true,
        message: `已确认任务“${String(task.title || '未命名任务').slice(0, 100)}”及最近运行状态`
      }
    },
    'automation.recheck': async () => {
      const result = await runAutomationTask(userDataPath(), event.sourceId)
      return {
        ok: Boolean(result?.result?.ok),
        message: resultMessage(result?.result, '巡检任务复检完成')
      }
    },
    'model-monitor.diagnose': () => {
      const latest = modelHistory()[0]
      const matched = modelResultForEvent(latest, event)
      return {
        ok: true,
        message: matched
          ? `最近记录：${matched.model || '目标模型'} · ${matched.status || '未知状态'}`
          : '已读取最近模型巡检记录，下一步将执行已配置目标复检'
      }
    },
    'model-monitor.recheck': async () => {
      const snapshot = await runScheduledInspection()
      return modelRecheckOutcome(snapshot, event)
    },
    'node-service.diagnose': () => {
      const watch = listWatchedNodeServices(userDataPath()).find(
        (item) => item.id === event.sourceId
      )
      if (!watch) return { ok: false, message: '关联 Node 服务关注项已不存在' }
      return {
        ok: true,
        message: `当前记录：${watch.protocol} ${watch.port} · ${watch.lastState || 'unknown'}`
      }
    },
    'node-service.recheck': async () => {
      const result = await runNodeServiceMonitorCheck()
      const watch = (Array.isArray(result?.items) ? result.items : []).find(
        (item) => item.id === event.sourceId
      )
      return {
        ok: Boolean(result?.ok && watch?.lastState === 'online'),
        message: result?.ok
          ? watch
            ? `${watch.protocol} ${watch.port}：${watch.lastState}`
            : '复检完成，但关联关注项已不存在'
          : resultMessage(result, 'Node 服务复检失败')
      }
    },
    'backup.diagnose': () => {
      const health = getAutoBackupHealth(userDataPath())
      return { ok: true, message: `当前备份健康状态：${health.summary}` }
    },
    'backup.recheck': () => {
      const health = getAutoBackupHealth(userDataPath())
      return {
        ok: ['healthy', 'disabled'].includes(health.status),
        message: health.summary
      }
    },
    'release.diagnose': () => ({
      guided: true,
      message: '发布事件仅提供历史诊断，请前往系统发布页执行预检或人工回滚判断'
    }),
    'release.recheck': () => ({
      guided: true,
      message: '请在系统发布页完成健康检查后再手动关闭事件'
    }),
    'log.diagnose': () => ({
      guided: true,
      message: '请前往 AI 运维中心查看已脱敏日志分析，不会自动执行系统命令'
    }),
    'log.recheck': () => ({ guided: true, message: '日志类事件需要人工确认后关闭' }),
    'copilot.diagnose': () => ({
      guided: true,
      message: 'Copilot 事件只提供安全导航与建议，不自动执行外部命令'
    }),
    'copilot.recheck': () => ({ guided: true, message: '请人工确认建议执行结果' })
  }
}

function collectDiagnosticsBundle() {
  const currentUserDataPath = userDataPath()
  const events = listOpsEvents(currentUserDataPath, { limit: 100 })
  const auditRecords = listAuditRecords({ userDataPath: currentUserDataPath, limit: 100 })
  return buildOpsDiagnosticsBundle({
    generatedAt: Date.now(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      isPackaged: app.isPackaged,
      locale: app.getLocale(),
      startedAt: Date.now() - Math.round(process.uptime() * 1000),
      uptimeSeconds: Math.round(process.uptime())
    },
    system: {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpuCount: os.cpus().length,
      memoryTotalBytes: os.totalmem(),
      memoryFreeBytes: os.freemem(),
      uptimeSeconds: os.uptime(),
      loadAverage: os.loadavg()
    },
    events,
    eventSummary: eventSummary(currentUserDataPath),
    automationTasks: listAutomationTasks(currentUserDataPath),
    modelMonitor: modelMonitorSettings(currentUserDataPath),
    modelHistory: modelHistory(currentUserDataPath),
    nodeWatches: listWatchedNodeServices(currentUserDataPath),
    nodeHistory: listNodeServiceHistory(currentUserDataPath, { limit: 100 }),
    backupHealth: getAutoBackupHealth(currentUserDataPath),
    releaseHistory: loadReleaseHistory().slice(0, 50),
    auditRecords,
    logEntries: loadLogState(currentUserDataPath).items
  })
}

function diagnosticsPreview(bundle) {
  return {
    generatedAt: bundle.generatedAt,
    schema: bundle.schema,
    version: bundle.version,
    app: bundle.app,
    system: bundle.system,
    counts: {
      events: bundle.events?.items?.length || 0,
      automationTasks: bundle.automationTasks?.length || 0,
      modelHistory: bundle.modelHistory?.length || 0,
      nodeWatches: bundle.nodeWatches?.length || 0,
      nodeHistory: bundle.nodeHistory?.length || 0,
      releaseHistory: bundle.releaseHistory?.length || 0,
      auditRecords: bundle.auditRecords?.length || 0,
      logEntries: bundle.logEntries?.length || 0
    },
    redaction: '仅导出白名单字段，并自动移除凭证、提示词、路径、URL 与原始配置。'
  }
}

function collectInsights() {
  const currentUserDataPath = userDataPath()
  return buildOpsInsights({
    modelHistory: modelHistory(currentUserDataPath),
    evaluationState: loadEvaluationState(currentUserDataPath),
    releaseHistory: loadReleaseHistory(),
    nodeHistory: listNodeServiceHistory(currentUserDataPath),
    settings: loadOpsInsightsSettings(currentUserDataPath)
  })
}

function safeChangePayload(change = {}) {
  return normalizeOpsDataChange(change)
}

function startOpsDataBroadcast() {
  if (unsubscribeOpsDataChanges) return
  unsubscribeOpsDataChanges = onOpsDataChange((change) => {
    const win = runtime?.getMainWindow?.()
    if (!win || win.isDestroyed() || win.webContents?.isDestroyed()) return
    win.webContents.send(IPC_CHANNELS.OPS_DATA_CHANGED, safeChangePayload(change))
  })
}

function registerOpsPlatformHandlers({ getMainWindow } = {}) {
  runtime = { userDataPath: app.getPath('userData'), getMainWindow }
  startOpsDataBroadcast()

  ipcMain.handle(IPC_CHANNELS.OPS_AUDIT_GET, async (_event, filters = {}) => {
    try {
      return {
        ok: true,
        records: listAuditRecords({
          userDataPath: userDataPath(),
          ...(filters && typeof filters === 'object' ? filters : {}),
          limit: Math.min(200, Math.max(1, Number(filters?.limit) || 100))
        })
      }
    } catch (error) {
      return { ok: false, error: error?.message || '读取操作审计失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPS_RUNBOOK_PLAN, async (_event, payload = {}) => {
    try {
      const event = findOpsEvent(payload?.eventId)
      return { ok: true, plan: buildRunbookPlan(event) }
    } catch (error) {
      return { ok: false, error: error?.message || '生成 Runbook 失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPS_RUNBOOK_EXECUTE, async (_event, payload = {}) => {
    try {
      const event = findOpsEvent(payload?.eventId)
      const result = await executeRunbook({
        userDataPath: userDataPath(),
        event,
        plan: payload?.plan,
        confirmed: payload?.confirmed === true,
        handlers: createRunbookHandlers(event)
      })
      if (result.status === 'succeeded' && event.status !== 'resolved') {
        updateOpsEvent(userDataPath(), event.id, 'resolved', 'Runbook 复检通过，事件已自动关闭')
      }
      return { ok: result.status !== 'failed', result }
    } catch (error) {
      return { ok: false, error: error?.message || '执行 Runbook 失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPS_RUNBOOK_HISTORY_GET, async () => {
    try {
      return { ok: true, runs: listRunbookHistory(userDataPath(), { limit: 50 }) }
    } catch (error) {
      return { ok: false, error: error?.message || '读取 Runbook 历史失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPS_DIAGNOSTICS_PREVIEW, async () => {
    try {
      const bundle = collectDiagnosticsBundle()
      return { ok: true, preview: diagnosticsPreview(bundle) }
    } catch (error) {
      return { ok: false, error: error?.message || '生成诊断预览失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPS_DIAGNOSTICS_EXPORT, async () => {
    try {
      const bundle = collectDiagnosticsBundle()
      const defaultName = `ops-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      const win = runtime?.getMainWindow?.()
      const result = await dialog.showSaveDialog(win || undefined, {
        title: '导出脱敏诊断包',
        defaultPath: defaultName,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { ok: true, canceled: true }
      const content = `${JSON.stringify(bundle, null, 2)}\n`
      fs.writeFileSync(result.filePath, content, { encoding: 'utf8', mode: 0o600 })
      return {
        ok: true,
        canceled: false,
        fileName: path.basename(result.filePath),
        sizeBytes: Buffer.byteLength(content)
      }
    } catch (error) {
      return { ok: false, error: error?.message || '导出诊断包失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPS_INSIGHTS_GET, async () => {
    try {
      return { ok: true, data: collectInsights() }
    } catch (error) {
      return { ok: false, error: error?.message || '读取运维洞察失败' }
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPS_INSIGHTS_SETTINGS_SAVE, async (_event, settings = {}) => {
    try {
      const saved = saveOpsInsightsSettings(userDataPath(), settings)
      return { ok: true, settings: saved, data: collectInsights() }
    } catch (error) {
      return { ok: false, error: error?.message || '保存模型价格配置失败' }
    }
  })
}

function stopOpsPlatformService() {
  unsubscribeOpsDataChanges?.()
  unsubscribeOpsDataChanges = null
  runtime = null
}

module.exports = {
  registerOpsPlatformHandlers,
  stopOpsPlatformService,
  __testables: {
    createRunbookHandlers,
    diagnosticsPreview,
    modelRecheckOutcome,
    modelResultForEvent,
    safeChangePayload
  }
}
