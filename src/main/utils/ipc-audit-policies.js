const { IPC_CHANNELS } = require('../../shared/ipc-channels')

const QUICKLAUNCH_ITEM_TYPES = ['url', 'app', 'file', 'folder']
const BACKUP_INTERVALS = ['daily', 'weekly']
const GPT_IMAGE_SOURCE_MODES = ['manual', 'model-reliability']
const GPT_IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536']
const GPT_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high']
const NODE_MONITOR_PROTOCOLS = ['TCP', 'UDP']
const PROCESS_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGQUIT']

function first(args) {
  return Array.isArray(args) ? args[0] : undefined
}

function objectArg(args) {
  const value = first(args)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function hasValue(value) {
  if (typeof value === 'string') return value.trim().length > 0
  return value !== undefined && value !== null
}

function countArray(value) {
  return Array.isArray(value) ? Math.min(value.length, 10_000) : 0
}

function enumValue(value, allowed) {
  return allowed.includes(value) ? value : 'other'
}

function integerValue(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) return 0
  return number
}

function createIpcAuditPolicies() {
  return {
    [IPC_CHANNELS.PORTS_KILL_PORT]: {
      action: 'process.kill-port',
      category: 'process',
      target: (args) => ({
        port: integerValue(objectArg(args).port, 1, 65535),
        signal: enumValue(objectArg(args).signal, PROCESS_SIGNALS)
      })
    },
    [IPC_CHANNELS.PORTS_KILL_PID]: {
      action: 'process.kill-pid',
      category: 'process',
      target: (args) => ({
        pid: integerValue(objectArg(args).pid),
        signal: enumValue(objectArg(args).signal, PROCESS_SIGNALS)
      })
    },
    [IPC_CHANNELS.NODE_MONITOR_WATCH]: {
      action: 'node-monitor.watch',
      category: 'operations',
      target: (args) => ({
        protocol: enumValue(objectArg(args).protocol, NODE_MONITOR_PROTOCOLS),
        port: integerValue(objectArg(args).port, 1, 65535)
      })
    },
    [IPC_CHANNELS.NODE_MONITOR_UNWATCH]: {
      action: 'node-monitor.unwatch',
      category: 'operations',
      target: (args) => ({
        protocol: enumValue(objectArg(args).protocol, NODE_MONITOR_PROTOCOLS),
        port: integerValue(objectArg(args).port, 1, 65535)
      })
    },
    [IPC_CHANNELS.NODE_MONITOR_CHECK]: {
      action: 'node-monitor.check',
      category: 'operations',
      target: () => ({ operation: 'service-check' })
    },
    [IPC_CHANNELS.SFTP_UPLOAD]: {
      action: 'release.upload-file',
      category: 'release',
      target: () => ({ operation: 'upload' })
    },
    [IPC_CHANNELS.SFTP_DEPLOY_ZIP]: {
      action: 'release.deploy',
      category: 'release',
      target: (args) => ({
        entryCount: countArray(objectArg(args).entries),
        clearCount: countArray(objectArg(args).clearRemotePaths)
      })
    },
    [IPC_CHANNELS.SFTP_DELETE]: {
      action: 'release.delete-remote',
      category: 'release',
      target: () => ({ operation: 'remote-delete' })
    },
    [IPC_CHANNELS.SFTP_CONFIG_SAVE]: {
      action: 'release.config-save',
      category: 'release-config',
      target: (args) => ({
        hasHost: hasValue(objectArg(args).host),
        hasUsername: hasValue(objectArg(args).username),
        hasPassword: hasValue(objectArg(args).password),
        clearPassword: objectArg(args).clearPassword === true,
        hasPrivateKey: hasValue(objectArg(args).privateKey)
      })
    },
    [IPC_CHANNELS.SFTP_PATHS_SAVE]: {
      action: 'release.paths-save',
      category: 'release-config',
      target: (args) => ({ pathCount: countArray(first(args)) })
    },
    [IPC_CHANNELS.SFTP_TEST]: {
      action: 'release.connection-test',
      category: 'release',
      target: () => ({ operation: 'connection-test' })
    },
    [IPC_CHANNELS.SFTP_LIST]: {
      action: 'release.list-remote',
      category: 'release',
      target: () => ({ operation: 'remote-list' })
    },
    [IPC_CHANNELS.SFTP_COMPARE]: {
      action: 'release.compare',
      category: 'release',
      target: () => ({ operation: 'compare' })
    },
    [IPC_CHANNELS.SFTP_MKDIR]: {
      action: 'release.mkdir',
      category: 'release',
      target: (args) => ({ hasRemotePath: hasValue(first(args)) })
    },
    [IPC_CHANNELS.SFTP_PREFLIGHT]: {
      action: 'release.preflight',
      category: 'release',
      target: () => ({ operation: 'preflight' })
    },
    [IPC_CHANNELS.SFTP_PROFILE_SAVE]: {
      action: 'release.profile-save',
      category: 'release-config',
      target: (args) => ({
        hasProfileId: hasValue(objectArg(args).id),
        hasProfileName: hasValue(objectArg(args).name)
      })
    },
    [IPC_CHANNELS.SFTP_PROFILE_ACTIVATE]: {
      action: 'release.profile-activate',
      category: 'release-config',
      target: (args) => ({ hasProfileId: hasValue(first(args)) })
    },
    [IPC_CHANNELS.SFTP_PROFILE_DELETE]: {
      action: 'release.profile-delete',
      category: 'release-config',
      target: (args) => ({ hasProfileId: hasValue(first(args)) })
    },
    [IPC_CHANNELS.SFTP_ROLLBACK]: {
      action: 'release.rollback',
      category: 'release',
      target: (args) => ({ hasReleaseId: hasValue(first(args)) })
    },
    [IPC_CHANNELS.DATA_BACKUP_RESTORE]: {
      action: 'backup.restore-import',
      category: 'backup',
      target: () => ({ source: 'import-preview' })
    },
    [IPC_CHANNELS.DATA_BACKUP_INSPECT]: {
      action: 'backup.inspect-import',
      category: 'backup',
      target: () => ({ operation: 'import-inspect' })
    },
    [IPC_CHANNELS.DATA_BACKUP_EXPORT]: {
      action: 'backup.export',
      category: 'backup',
      target: (args) => ({
        categoryCount: countArray(objectArg(args).categories),
        hasPassword: hasValue(objectArg(args).password)
      })
    },
    [IPC_CHANNELS.DATA_BACKUP_AUTO_SAVE]: {
      action: 'backup.auto-config-save',
      category: 'backup',
      target: (args) => ({
        enabled: objectArg(args).enabled === true,
        interval: enumValue(objectArg(args).interval, BACKUP_INTERVALS),
        retentionCount: integerValue(objectArg(args).retentionCount, 1, 30),
        categoryCount: countArray(objectArg(args).categories),
        hasOutputDirectory: hasValue(objectArg(args).outputDirectory),
        hasPassword: hasValue(objectArg(args).password)
      })
    },
    [IPC_CHANNELS.DATA_BACKUP_AUTO_RUN]: {
      action: 'backup.auto-run',
      category: 'backup',
      target: () => ({ operation: 'auto-run' })
    },
    [IPC_CHANNELS.DATA_BACKUP_AUTO_INSPECT]: {
      action: 'backup.inspect-auto',
      category: 'backup',
      target: (args) => ({ hasBackupId: hasValue(objectArg(args).id) })
    },
    [IPC_CHANNELS.DATA_BACKUP_AUTO_RESTORE]: {
      action: 'backup.restore-auto',
      category: 'backup',
      target: (args) => ({ hasBackupId: hasValue(objectArg(args).id) })
    },
    [IPC_CHANNELS.DATA_BACKUP_RESTORE_POINT]: {
      action: 'backup.restore-point',
      category: 'backup',
      target: (args) => ({ hasRestorePointId: hasValue(objectArg(args).id) })
    },
    [IPC_CHANNELS.DATA_BACKUP_AUTO_DELETE]: {
      action: 'backup.delete-auto',
      category: 'backup',
      target: (args) => ({ hasBackupId: hasValue(objectArg(args).id) })
    },
    [IPC_CHANNELS.DATA_BACKUP_AUTO_OPEN_DIRECTORY]: {
      action: 'backup.open-auto-directory',
      category: 'backup',
      target: (args) => ({ hasBackupId: hasValue(objectArg(args).id) })
    },
    [IPC_CHANNELS.APP_UPDATE_INSTALL]: {
      action: 'app-update.install',
      category: 'application',
      target: () => ({ operation: 'install-downloaded-update' })
    },
    [IPC_CHANNELS.QUICKLAUNCH_SAVE]: {
      action: 'quicklaunch.save',
      category: 'desktop',
      target: (args) => ({ itemCount: countArray(first(args)) })
    },
    [IPC_CHANNELS.QUICKLAUNCH_LAUNCH]: {
      action: 'quicklaunch.launch',
      category: 'desktop',
      target: (args) => ({ itemType: enumValue(objectArg(args).type, QUICKLAUNCH_ITEM_TYPES) })
    },
    [IPC_CHANNELS.QUICKLAUNCH_LAUNCH_URLS]: {
      action: 'quicklaunch.launch-urls',
      category: 'desktop',
      target: (args) => ({
        itemCount: countArray(first(args)),
        urlCount: Array.isArray(first(args))
          ? countArray(first(args).filter((item) => item?.type === 'url'))
          : 0
      })
    },
    [IPC_CHANNELS.QUICKLAUNCH_IMPORT_URLS]: {
      action: 'quicklaunch.import-urls',
      category: 'desktop',
      target: () => ({ operation: 'import-urls' })
    },
    [IPC_CHANNELS.QUICKLAUNCH_EXPORT_URLS]: {
      action: 'quicklaunch.export-urls',
      category: 'desktop',
      target: (args) => ({ itemCount: countArray(first(args)) })
    },
    [IPC_CHANNELS.CLIPBOARD_GET_HISTORY]: {
      action: 'clipboard.history-get',
      category: 'privacy',
      target: () => ({ operation: 'history-read' })
    },
    [IPC_CHANNELS.CLIPBOARD_SAVE_HISTORY]: {
      action: 'clipboard.history-save',
      category: 'privacy',
      target: (args) => ({ itemCount: countArray(first(args)) })
    },
    [IPC_CHANNELS.CLIPBOARD_READ]: {
      action: 'clipboard.read',
      category: 'privacy',
      target: () => ({ operation: 'read' })
    },
    [IPC_CHANNELS.CLIPBOARD_WRITE]: {
      action: 'clipboard.write',
      category: 'privacy',
      target: (args) => ({
        contentType:
          typeof first(args) !== 'string'
            ? 'other'
            : first(args).startsWith('data:image')
              ? 'image'
              : 'text'
      })
    },
    [IPC_CHANNELS.GPT_IMAGE_CONFIG_SAVE]: {
      action: 'ai-image.config-save',
      category: 'ai-config',
      target: (args) => ({
        sourceMode: enumValue(objectArg(args).sourceMode, GPT_IMAGE_SOURCE_MODES),
        hasProviderId: hasValue(objectArg(args).sourceProviderId),
        hasProviderAppType: hasValue(objectArg(args).sourceAppType),
        hasModel: hasValue(objectArg(args).model),
        hasBaseUrl: hasValue(objectArg(args).baseUrl),
        hasApiKey: hasValue(objectArg(args).apiKey),
        clearApiKey: objectArg(args).clearApiKey === true
      })
    },
    [IPC_CHANNELS.GPT_IMAGE_MODELS_LIST]: {
      action: 'ai-image.models-list',
      category: 'ai-config',
      target: (args) => ({
        sourceMode: enumValue(objectArg(args).sourceMode, GPT_IMAGE_SOURCE_MODES)
      })
    },
    [IPC_CHANNELS.GPT_IMAGE_GENERATE]: {
      action: 'ai-image.generate',
      category: 'ai-workflow',
      target: (args) => ({
        hasPrompt: hasValue(objectArg(args).prompt),
        sourceMode: enumValue(objectArg(args).config?.sourceMode, GPT_IMAGE_SOURCE_MODES),
        size: enumValue(objectArg(args).size || objectArg(args).config?.size, GPT_IMAGE_SIZES),
        quality: enumValue(
          objectArg(args).quality || objectArg(args).config?.quality,
          GPT_IMAGE_QUALITIES
        )
      })
    },
    [IPC_CHANNELS.GPT_IMAGE_SAVE]: {
      action: 'ai-image.save',
      category: 'ai-workflow',
      target: () => ({ operation: 'save-image' })
    },
    [IPC_CHANNELS.GPT_IMAGE_HISTORY_SAVE]: {
      action: 'ai-image.history-save',
      category: 'ai-workflow',
      target: (args) => ({ itemCount: countArray(first(args)) })
    },
    [IPC_CHANNELS.GPT_IMAGE_HISTORY_CLEAR]: {
      action: 'ai-image.history-clear',
      category: 'ai-workflow',
      target: () => ({ operation: 'history-clear' })
    },
    [IPC_CHANNELS.AI_PROVIDER_SOURCE_ADD]: {
      action: 'ai-provider.add',
      category: 'ai-config',
      target: (args) => ({
        hasProviderId: hasValue(objectArg(args).sourceProviderId),
        hasAppType: hasValue(objectArg(args).sourceAppType),
        hasModel: hasValue(objectArg(args).model)
      })
    },
    [IPC_CHANNELS.AI_PROVIDER_DELETE]: {
      action: 'ai-provider.delete',
      category: 'ai-config',
      target: (args) => ({ hasProviderId: hasValue(first(args)) })
    },
    [IPC_CHANNELS.AI_PROVIDER_ACTIVATE]: {
      action: 'ai-provider.activate',
      category: 'ai-config',
      target: (args) => ({ hasProviderId: hasValue(first(args)) })
    },
    [IPC_CHANNELS.AI_PROVIDER_ROUTING_SAVE]: {
      action: 'ai-provider.routing-save',
      category: 'ai-config',
      target: (args) => ({
        enabled: objectArg(args).enabled === true,
        preferLocal: objectArg(args).preferLocal !== false,
        maxAttempts: integerValue(objectArg(args).maxAttempts, 1, 3),
        cooldownMinutes: integerValue(objectArg(args).cooldownMinutes, 1, 60)
      })
    },
    [IPC_CHANNELS.AI_PROVIDER_ROUTING_RESET]: {
      action: 'ai-provider.routing-reset',
      category: 'ai-config',
      target: () => ({ operation: 'reset-health' })
    },
    [IPC_CHANNELS.AI_WORKFLOW_EXECUTE]: {
      action: 'ai-workflow.execute',
      category: 'ai-workflow',
      target: (args) => ({
        hasPlanId: hasValue(objectArg(args).planId || objectArg(args).plan?.id),
        selectedStepCount: countArray(objectArg(args).stepIds),
        confirmed: objectArg(args).confirmed === true
      })
    },
    [IPC_CHANNELS.OPS_RUNBOOK_EXECUTE]: {
      action: 'ops-runbook.execute',
      category: 'operations',
      target: (args) => ({
        hasEventId: hasValue(objectArg(args).eventId),
        stepCount: countArray(objectArg(args).plan?.steps),
        confirmed: objectArg(args).confirmed === true
      })
    },
    [IPC_CHANNELS.OPS_MAINTENANCE_SAVE]: {
      action: 'ops-maintenance.save',
      category: 'operations',
      target: (args) => ({
        enabled: objectArg(args).enabled === true,
        confirmed: objectArg(args).confirmed === true,
        hasReason: hasValue(objectArg(args).reason)
      })
    },
    [IPC_CHANNELS.OPS_TASK_BATCH]: {
      action: 'ops-task.batch',
      category: 'operations',
      target: (args) => ({
        operation: enumValue(objectArg(args).action, ['run', 'pause', 'resume']),
        itemCount: countArray(objectArg(args).taskIds),
        confirmed: objectArg(args).confirmed === true
      })
    },
    [IPC_CHANNELS.OPS_AUDIT_SETTINGS_SAVE]: {
      action: 'ops-audit.settings-save',
      category: 'security',
      target: (args) => ({
        retentionCount: integerValue(objectArg(args).retentionDays, 1, 3650)
      })
    },
    [IPC_CHANNELS.OPS_AUDIT_EXPORT]: {
      action: 'ops-audit.export',
      category: 'security',
      target: (args) => ({
        status: enumValue(objectArg(args).status, ['started', 'succeeded', 'failed']),
        scope: hasValue(objectArg(args).category) ? 'filtered-category' : 'all-categories',
        format: 'json',
        redacted: true
      })
    },
    [IPC_CHANNELS.OPS_AUDIT_CLEAR]: {
      action: 'ops-audit.clear',
      category: 'security',
      target: (args) => ({
        status: enumValue(objectArg(args).status, ['started', 'succeeded', 'failed']),
        scope: hasValue(objectArg(args).category) ? 'filtered-category' : 'all-categories',
        confirmed: objectArg(args).confirmed === true
      })
    },
    [IPC_CHANNELS.OPS_DIAGNOSTICS_EXPORT]: {
      action: 'ops-diagnostics.export',
      category: 'diagnostics',
      target: () => ({ format: 'json', redacted: true })
    },
    [IPC_CHANNELS.OPS_INSIGHTS_SETTINGS_SAVE]: {
      action: 'ops-insights.pricing-save',
      category: 'ai-config',
      target: (args) => ({
        hasProviderId: hasValue(objectArg(args).providerId),
        hasModel: hasValue(objectArg(args).model)
      })
    }
  }
}

module.exports = { createIpcAuditPolicies }
