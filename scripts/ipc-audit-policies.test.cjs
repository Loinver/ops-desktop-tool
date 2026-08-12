const assert = require('node:assert/strict')
const test = require('node:test')
const { IPC_CHANNELS } = require('../src/shared/ipc-channels')
const { createIpcAuditPolicies } = require('../src/main/utils/ipc-audit-policies')

const sensitiveValues = [
  'prompt-secret-value',
  'https://secret.example.test/private?token=secret-token',
  '/Users/test/private/secret.txt',
  'remote/private/secret',
  'password-secret-value',
  'api-key-secret-value',
  'clipboard-secret-value',
  'profile-name-secret',
  'release-label-secret'
]

const requiredChannels = [
  {
    name: 'PORTS_KILL_PORT',
    channel: IPC_CHANNELS.PORTS_KILL_PORT,
    action: 'process.kill-port',
    category: 'process',
    args: [{ port: 3000, signal: 'SIGTERM', path: sensitiveValues[2] }],
    targetKeys: ['port', 'signal']
  },
  {
    name: 'PORTS_KILL_PID',
    channel: IPC_CHANNELS.PORTS_KILL_PID,
    action: 'process.kill-pid',
    category: 'process',
    args: [{ pid: 1234, signal: 'SIGKILL', password: sensitiveValues[4] }],
    targetKeys: ['pid', 'signal']
  },
  {
    name: 'NODE_MONITOR_WATCH',
    channel: IPC_CHANNELS.NODE_MONITOR_WATCH,
    action: 'node-monitor.watch',
    category: 'operations',
    args: [{ protocol: 'TCP', port: 8080, commandLabel: sensitiveValues[8] }],
    targetKeys: ['protocol', 'port']
  },
  {
    name: 'NODE_MONITOR_UNWATCH',
    channel: IPC_CHANNELS.NODE_MONITOR_UNWATCH,
    action: 'node-monitor.unwatch',
    category: 'operations',
    args: [{ protocol: 'UDP', port: 5353, address: sensitiveValues[1] }],
    targetKeys: ['protocol', 'port']
  },
  {
    name: 'SFTP_CONFIG_GET',
    channel: IPC_CHANNELS.SFTP_CONFIG_GET,
    action: 'release.config-get',
    category: 'release-config',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'SFTP_CONFIG_SAVE',
    channel: IPC_CHANNELS.SFTP_CONFIG_SAVE,
    action: 'release.config-save',
    category: 'release-config',
    args: [
      {
        host: sensitiveValues[1],
        username: 'user-secret',
        password: sensitiveValues[4],
        privateKey: '-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
        clearPassword: true
      }
    ],
    targetKeys: ['hasHost', 'hasUsername', 'hasPassword', 'clearPassword', 'hasPrivateKey']
  },
  {
    name: 'SFTP_PATHS_SAVE',
    channel: IPC_CHANNELS.SFTP_PATHS_SAVE,
    action: 'release.paths-save',
    category: 'release-config',
    args: [{ localPath: sensitiveValues[2], remotePath: sensitiveValues[3] }],
    targetKeys: ['pathCount']
  },
  {
    name: 'SFTP_TEST',
    channel: IPC_CHANNELS.SFTP_TEST,
    action: 'release.connection-test',
    category: 'release',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'SFTP_LIST',
    channel: IPC_CHANNELS.SFTP_LIST,
    action: 'release.list-remote',
    category: 'release',
    args: [sensitiveValues[3]],
    targetKeys: ['operation']
  },
  {
    name: 'SFTP_UPLOAD',
    channel: IPC_CHANNELS.SFTP_UPLOAD,
    action: 'release.upload-file',
    category: 'release',
    args: [{ localPath: sensitiveValues[2], remotePath: sensitiveValues[3] }],
    targetKeys: ['operation']
  },
  {
    name: 'SFTP_DEPLOY_ZIP',
    channel: IPC_CHANNELS.SFTP_DEPLOY_ZIP,
    action: 'release.deploy',
    category: 'release',
    args: [
      {
        label: sensitiveValues[8],
        entries: [{ localPath: sensitiveValues[2] }],
        clearRemotePaths: [sensitiveValues[3]],
        password: sensitiveValues[4]
      }
    ],
    targetKeys: ['entryCount', 'clearCount']
  },
  {
    name: 'SFTP_DELETE',
    channel: IPC_CHANNELS.SFTP_DELETE,
    action: 'release.delete-remote',
    category: 'release',
    args: [sensitiveValues[3]],
    targetKeys: ['operation']
  },
  {
    name: 'SFTP_COMPARE',
    channel: IPC_CHANNELS.SFTP_COMPARE,
    action: 'release.compare',
    category: 'release',
    args: [{ localDir: sensitiveValues[2], remoteDir: sensitiveValues[3] }],
    targetKeys: ['operation']
  },
  {
    name: 'SFTP_LOCAL_LIST',
    channel: IPC_CHANNELS.SFTP_LOCAL_LIST,
    action: 'release.list-local',
    category: 'release',
    args: [sensitiveValues[2]],
    targetKeys: ['operation']
  },
  {
    name: 'SFTP_MKDIR',
    channel: IPC_CHANNELS.SFTP_MKDIR,
    action: 'release.mkdir',
    category: 'release',
    args: [sensitiveValues[3]],
    targetKeys: ['hasRemotePath']
  },
  {
    name: 'SFTP_PREFLIGHT',
    channel: IPC_CHANNELS.SFTP_PREFLIGHT,
    action: 'release.preflight',
    category: 'release',
    args: [{ path: sensitiveValues[2], url: sensitiveValues[1] }],
    targetKeys: ['operation']
  },
  {
    name: 'SFTP_PROFILE_SAVE',
    channel: IPC_CHANNELS.SFTP_PROFILE_SAVE,
    action: 'release.profile-save',
    category: 'release-config',
    args: [{ id: 'profile-secret-id', name: sensitiveValues[7], password: sensitiveValues[4] }],
    targetKeys: ['hasProfileId', 'hasProfileName']
  },
  {
    name: 'SFTP_PROFILE_ACTIVATE',
    channel: IPC_CHANNELS.SFTP_PROFILE_ACTIVATE,
    action: 'release.profile-activate',
    category: 'release-config',
    args: ['profile-secret-id'],
    targetKeys: ['hasProfileId']
  },
  {
    name: 'SFTP_PROFILE_DELETE',
    channel: IPC_CHANNELS.SFTP_PROFILE_DELETE,
    action: 'release.profile-delete',
    category: 'release-config',
    args: ['profile-secret-id'],
    targetKeys: ['hasProfileId']
  },
  {
    name: 'SFTP_ROLLBACK',
    channel: IPC_CHANNELS.SFTP_ROLLBACK,
    action: 'release.rollback',
    category: 'release',
    args: ['release-secret-id'],
    targetKeys: ['hasReleaseId']
  },
  {
    name: 'DATA_BACKUP_EXPORT',
    channel: IPC_CHANNELS.DATA_BACKUP_EXPORT,
    action: 'backup.export',
    category: 'backup',
    args: [{ categories: ['operations', 'release'], password: sensitiveValues[4] }],
    targetKeys: ['categoryCount', 'hasPassword']
  },
  {
    name: 'DATA_BACKUP_RESTORE',
    channel: IPC_CHANNELS.DATA_BACKUP_RESTORE,
    action: 'backup.restore-import',
    category: 'backup',
    args: [{ password: sensitiveValues[4], path: sensitiveValues[2] }],
    targetKeys: ['source']
  },
  {
    name: 'DATA_BACKUP_AUTO_GET',
    channel: IPC_CHANNELS.DATA_BACKUP_AUTO_GET,
    action: 'backup.auto-config-get',
    category: 'backup',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'DATA_BACKUP_AUTO_SAVE',
    channel: IPC_CHANNELS.DATA_BACKUP_AUTO_SAVE,
    action: 'backup.auto-config-save',
    category: 'backup',
    args: [
      {
        enabled: true,
        interval: 'daily',
        retentionCount: 5,
        categories: ['operations', 'release'],
        outputDirectory: sensitiveValues[2],
        password: sensitiveValues[4]
      }
    ],
    targetKeys: [
      'enabled',
      'interval',
      'retentionCount',
      'categoryCount',
      'hasOutputDirectory',
      'hasPassword'
    ]
  },
  {
    name: 'DATA_BACKUP_AUTO_RUN',
    channel: IPC_CHANNELS.DATA_BACKUP_AUTO_RUN,
    action: 'backup.auto-run',
    category: 'backup',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'DATA_BACKUP_HISTORY_GET',
    channel: IPC_CHANNELS.DATA_BACKUP_HISTORY_GET,
    action: 'backup.history-get',
    category: 'backup',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'DATA_BACKUP_AUTO_INSPECT',
    channel: IPC_CHANNELS.DATA_BACKUP_AUTO_INSPECT,
    action: 'backup.inspect-auto',
    category: 'backup',
    args: [{ id: 'backup-secret-id', path: sensitiveValues[2] }],
    targetKeys: ['hasBackupId']
  },
  {
    name: 'DATA_BACKUP_AUTO_RESTORE',
    channel: IPC_CHANNELS.DATA_BACKUP_AUTO_RESTORE,
    action: 'backup.restore-auto',
    category: 'backup',
    args: [{ id: 'backup-secret-id', password: sensitiveValues[4] }],
    targetKeys: ['hasBackupId']
  },
  {
    name: 'DATA_BACKUP_RESTORE_POINT',
    channel: IPC_CHANNELS.DATA_BACKUP_RESTORE_POINT,
    action: 'backup.restore-point',
    category: 'backup',
    args: [{ id: 'restore-point-secret-id', path: sensitiveValues[2] }],
    targetKeys: ['hasRestorePointId']
  },
  {
    name: 'DATA_BACKUP_AUTO_DELETE',
    channel: IPC_CHANNELS.DATA_BACKUP_AUTO_DELETE,
    action: 'backup.delete-auto',
    category: 'backup',
    args: [{ id: 'backup-secret-id' }],
    targetKeys: ['hasBackupId']
  },
  {
    name: 'DATA_BACKUP_AUTO_OPEN_DIRECTORY',
    channel: IPC_CHANNELS.DATA_BACKUP_AUTO_OPEN_DIRECTORY,
    action: 'backup.open-auto-directory',
    category: 'backup',
    args: [{ id: 'backup-secret-id', path: sensitiveValues[2] }],
    targetKeys: ['hasBackupId']
  },
  {
    name: 'QUICKLAUNCH_GET',
    channel: IPC_CHANNELS.QUICKLAUNCH_GET,
    action: 'quicklaunch.get',
    category: 'desktop',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'QUICKLAUNCH_SAVE',
    channel: IPC_CHANNELS.QUICKLAUNCH_SAVE,
    action: 'quicklaunch.save',
    category: 'desktop',
    args: [[{ name: sensitiveValues[7], target: sensitiveValues[1] }]],
    targetKeys: ['itemCount']
  },
  {
    name: 'QUICKLAUNCH_LAUNCH',
    channel: IPC_CHANNELS.QUICKLAUNCH_LAUNCH,
    action: 'quicklaunch.launch',
    category: 'desktop',
    args: [{ type: 'url', target: sensitiveValues[1], path: sensitiveValues[2] }],
    targetKeys: ['itemType']
  },
  {
    name: 'QUICKLAUNCH_LAUNCH_URLS',
    channel: IPC_CHANNELS.QUICKLAUNCH_LAUNCH_URLS,
    action: 'quicklaunch.launch-urls',
    category: 'desktop',
    args: [[{ type: 'url', target: sensitiveValues[1], name: sensitiveValues[7] }]],
    targetKeys: ['itemCount', 'urlCount']
  },
  {
    name: 'QUICKLAUNCH_IMPORT_URLS',
    channel: IPC_CHANNELS.QUICKLAUNCH_IMPORT_URLS,
    action: 'quicklaunch.import-urls',
    category: 'desktop',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'QUICKLAUNCH_PARSE_URLS',
    channel: IPC_CHANNELS.QUICKLAUNCH_PARSE_URLS,
    action: 'quicklaunch.parse-urls',
    category: 'desktop',
    args: [sensitiveValues[1]],
    targetKeys: ['operation']
  },
  {
    name: 'QUICKLAUNCH_EXPORT_URLS',
    channel: IPC_CHANNELS.QUICKLAUNCH_EXPORT_URLS,
    action: 'quicklaunch.export-urls',
    category: 'desktop',
    args: [[{ target: sensitiveValues[1], name: sensitiveValues[7] }]],
    targetKeys: ['itemCount']
  },
  {
    name: 'CLIPBOARD_GET_HISTORY',
    channel: IPC_CHANNELS.CLIPBOARD_GET_HISTORY,
    action: 'clipboard.history-get',
    category: 'privacy',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'CLIPBOARD_SAVE_HISTORY',
    channel: IPC_CHANNELS.CLIPBOARD_SAVE_HISTORY,
    action: 'clipboard.history-save',
    category: 'privacy',
    args: [[{ content: sensitiveValues[6] }]],
    targetKeys: ['itemCount']
  },
  {
    name: 'CLIPBOARD_READ',
    channel: IPC_CHANNELS.CLIPBOARD_READ,
    action: 'clipboard.read',
    category: 'privacy',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'CLIPBOARD_WRITE',
    channel: IPC_CHANNELS.CLIPBOARD_WRITE,
    action: 'clipboard.write',
    category: 'privacy',
    args: [sensitiveValues[6]],
    targetKeys: ['contentType']
  },
  {
    name: 'AI_PROVIDER_ROUTING_SAVE',
    channel: IPC_CHANNELS.AI_PROVIDER_ROUTING_SAVE,
    action: 'ai-provider.routing-save',
    category: 'ai-config',
    args: [
      {
        enabled: true,
        preferLocal: false,
        maxAttempts: 3,
        cooldownMinutes: 10,
        apiKey: sensitiveValues[5],
        prompt: sensitiveValues[0]
      }
    ],
    targetKeys: ['enabled', 'preferLocal', 'maxAttempts', 'cooldownMinutes']
  },
  {
    name: 'AI_PROVIDER_ROUTING_RESET',
    channel: IPC_CHANNELS.AI_PROVIDER_ROUTING_RESET,
    action: 'ai-provider.routing-reset',
    category: 'ai-config',
    args: [{ apiKey: sensitiveValues[5], response: sensitiveValues[0] }],
    targetKeys: ['operation']
  },
  {
    name: 'GPT_IMAGE_CONFIG_GET',
    channel: IPC_CHANNELS.GPT_IMAGE_CONFIG_GET,
    action: 'ai-image.config-get',
    category: 'ai-config',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'GPT_IMAGE_CONFIG_SAVE',
    channel: IPC_CHANNELS.GPT_IMAGE_CONFIG_SAVE,
    action: 'ai-image.config-save',
    category: 'ai-config',
    args: [
      {
        sourceMode: 'manual',
        sourceProviderId: 'provider-secret-id',
        sourceAppType: 'openai',
        model: 'model-secret-name',
        baseUrl: sensitiveValues[1],
        apiKey: sensitiveValues[5],
        clearApiKey: true
      }
    ],
    targetKeys: [
      'sourceMode',
      'hasProviderId',
      'hasProviderAppType',
      'hasModel',
      'hasBaseUrl',
      'hasApiKey',
      'clearApiKey'
    ]
  },
  {
    name: 'GPT_IMAGE_MODELS_LIST',
    channel: IPC_CHANNELS.GPT_IMAGE_MODELS_LIST,
    action: 'ai-image.models-list',
    category: 'ai-config',
    args: [{ apiKey: sensitiveValues[5], baseUrl: sensitiveValues[1] }],
    targetKeys: ['sourceMode']
  },
  {
    name: 'GPT_IMAGE_GENERATE',
    channel: IPC_CHANNELS.GPT_IMAGE_GENERATE,
    action: 'ai-image.generate',
    category: 'ai-workflow',
    args: [
      {
        prompt: sensitiveValues[0],
        size: '1024x1024',
        quality: 'high',
        config: { apiKey: sensitiveValues[5], baseUrl: sensitiveValues[1] }
      }
    ],
    targetKeys: ['hasPrompt', 'sourceMode', 'size', 'quality']
  },
  {
    name: 'GPT_IMAGE_SAVE',
    channel: IPC_CHANNELS.GPT_IMAGE_SAVE,
    action: 'ai-image.save',
    category: 'ai-workflow',
    args: [{ imageUrl: sensitiveValues[1], fileName: sensitiveValues[2] }],
    targetKeys: ['operation']
  },
  {
    name: 'GPT_IMAGE_HISTORY_GET',
    channel: IPC_CHANNELS.GPT_IMAGE_HISTORY_GET,
    action: 'ai-image.history-get',
    category: 'ai-workflow',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'GPT_IMAGE_HISTORY_SAVE',
    channel: IPC_CHANNELS.GPT_IMAGE_HISTORY_SAVE,
    action: 'ai-image.history-save',
    category: 'ai-workflow',
    args: [[{ prompt: sensitiveValues[0], imageUrl: sensitiveValues[1] }]],
    targetKeys: ['itemCount']
  },
  {
    name: 'GPT_IMAGE_HISTORY_CLEAR',
    channel: IPC_CHANNELS.GPT_IMAGE_HISTORY_CLEAR,
    action: 'ai-image.history-clear',
    category: 'ai-workflow',
    args: [],
    targetKeys: ['operation']
  },
  {
    name: 'OPS_AUDIT_SETTINGS_SAVE',
    channel: IPC_CHANNELS.OPS_AUDIT_SETTINGS_SAVE,
    action: 'ops-audit.settings-save',
    category: 'security',
    args: [{ retentionDays: 180, path: sensitiveValues[2] }],
    targetKeys: ['retentionCount']
  },
  {
    name: 'OPS_AUDIT_EXPORT',
    channel: IPC_CHANNELS.OPS_AUDIT_EXPORT,
    action: 'ops-audit.export',
    category: 'security',
    args: [{ category: sensitiveValues[8], status: 'failed', path: sensitiveValues[2] }],
    targetKeys: ['status', 'scope', 'format', 'redacted']
  },
  {
    name: 'OPS_AUDIT_CLEAR',
    channel: IPC_CHANNELS.OPS_AUDIT_CLEAR,
    action: 'ops-audit.clear',
    category: 'security',
    args: [{ category: sensitiveValues[8], status: 'failed', confirmed: true }],
    targetKeys: ['status', 'scope', 'confirmed']
  }
]

const passiveReadChannels = [
  IPC_CHANNELS.PORTS_LIST,
  IPC_CHANNELS.PORTS_FIND,
  IPC_CHANNELS.NODE_MONITOR_GET,
  IPC_CHANNELS.SFTP_CONFIG_GET,
  IPC_CHANNELS.SFTP_PATHS_GET,
  IPC_CHANNELS.SFTP_LOCAL_LIST,
  IPC_CHANNELS.SFTP_PROFILES_GET,
  IPC_CHANNELS.SFTP_HISTORY_GET,
  IPC_CHANNELS.DATA_BACKUP_OVERVIEW,
  IPC_CHANNELS.DATA_BACKUP_AUTO_GET,
  IPC_CHANNELS.DATA_BACKUP_HISTORY_GET,
  IPC_CHANNELS.DATA_BACKUP_AUTO_HEALTH_GET,
  IPC_CHANNELS.DATA_BACKUP_RESTORE_POINTS_GET,
  IPC_CHANNELS.QUICKLAUNCH_GET,
  IPC_CHANNELS.QUICKLAUNCH_PARSE_URLS,
  IPC_CHANNELS.GPT_IMAGE_CONFIG_GET,
  IPC_CHANNELS.GPT_IMAGE_HISTORY_GET,
  IPC_CHANNELS.OPS_AUDIT_GET,
  IPC_CHANNELS.OPS_AUDIT_SETTINGS_GET
]
const passiveReadChannelSet = new Set(passiveReadChannels)
const highRiskRequiredChannels = requiredChannels.filter(
  ({ channel }) => !passiveReadChannelSet.has(channel)
)

function assertTargetIsBounded(target, requirement) {
  assert.ok(target && typeof target === 'object' && !Array.isArray(target))
  assert.deepEqual(Object.keys(target).sort(), requirement.targetKeys.slice().sort())
  const serialized = JSON.stringify(target)
  for (const value of sensitiveValues) {
    assert.equal(serialized.includes(value), false, `${requirement.name} leaked ${value}`)
  }
}

test('required high-risk IPC channels have explicit audit policies', () => {
  const policies = createIpcAuditPolicies()

  for (const requirement of highRiskRequiredChannels) {
    const policy = policies[requirement.channel]
    assert.ok(policy, `${requirement.name} is missing an audit policy`)
    assert.equal(policy.action, requirement.action, `${requirement.name} action changed`)
    assert.equal(policy.category, requirement.category, `${requirement.name} category changed`)
    assertTargetIsBounded(policy.target(requirement.args), requirement)
  }
})

test('passive renderer reads do not create high-risk audit policies', () => {
  const policies = createIpcAuditPolicies()

  for (const channel of passiveReadChannels) {
    assert.equal(policies[channel], undefined, `${channel} should not create routine audit noise`)
  }
})

test('sensitive IPC inputs are represented only by bounded metadata', () => {
  const policies = createIpcAuditPolicies()

  const deployTarget = policies[IPC_CHANNELS.SFTP_DEPLOY_ZIP].target([
    {
      label: 'production-secret-label',
      entries: [{ localPath: '/secret/path' }],
      clearRemotePaths: ['/remote/private'],
      password: 'not-allowed'
    }
  ])
  assert.deepEqual(deployTarget, { entryCount: 1, clearCount: 1 })

  const profileTarget = policies[IPC_CHANNELS.SFTP_PROFILE_SAVE].target([
    { id: 'profile-secret-id', name: 'profile-name-secret', password: 'not-allowed' }
  ])
  assert.deepEqual(profileTarget, { hasProfileId: true, hasProfileName: true })

  const configTarget = policies[IPC_CHANNELS.SFTP_CONFIG_SAVE].target([
    {
      host: 'sftp.secret.example.test',
      username: 'deploy-user',
      password: 'password-secret-value',
      privateKey: 'private-key-secret',
      clearPassword: true
    }
  ])
  assert.deepEqual(configTarget, {
    hasHost: true,
    hasUsername: true,
    hasPassword: true,
    clearPassword: true,
    hasPrivateKey: true
  })

  const imageTarget = policies[IPC_CHANNELS.GPT_IMAGE_GENERATE].target([
    {
      prompt: 'prompt-secret-value',
      config: { apiKey: 'api-key-secret-value', baseUrl: 'https://secret.example.test' }
    }
  ])
  assert.deepEqual(imageTarget, {
    hasPrompt: true,
    sourceMode: 'other',
    size: 'other',
    quality: 'other'
  })

  for (const target of [deployTarget, profileTarget, configTarget, imageTarget]) {
    const serialized = JSON.stringify(target)
    for (const value of sensitiveValues) {
      assert.equal(serialized.includes(value), false)
    }
  }
})
