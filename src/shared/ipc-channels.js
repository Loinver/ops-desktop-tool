/**
 * IPC 通道名称常量
 * 统一管理主进程和渲染进程之间的通信通道
 */

const IPC_CHANNELS = {
  // 端口管理
  PORTS_LIST: 'ports:list',
  PORTS_FIND: 'ports:find',
  PORTS_KILL_PORT: 'ports:killPort',
  PORTS_KILL_PID: 'ports:killPid',
  NODE_MONITOR_GET: 'nodeMonitor:get',
  NODE_MONITOR_WATCH: 'nodeMonitor:watch',
  NODE_MONITOR_UNWATCH: 'nodeMonitor:unwatch',
  NODE_MONITOR_CHECK: 'nodeMonitor:check',

  // 系统信息
  SYSTEM_INFO: 'system:info',

  // 应用通用
  APP_INFO: 'app:info',
  APP_CONFIRM: 'app:confirm',
  APP_BROWSE_FILE: 'app:browseFile',

  // 快捷启动
  QUICKLAUNCH_GET: 'quicklaunch:get',
  QUICKLAUNCH_SAVE: 'quicklaunch:save',
  QUICKLAUNCH_LAUNCH: 'quicklaunch:launch',
  QUICKLAUNCH_LAUNCH_URLS: 'quicklaunch:launchUrls',
  QUICKLAUNCH_IMPORT_URLS: 'quicklaunch:importUrls',
  QUICKLAUNCH_PARSE_URLS: 'quicklaunch:parseUrls',
  QUICKLAUNCH_EXPORT_URLS: 'quicklaunch:exportUrls',

  // 剪贴板
  CLIPBOARD_GET_HISTORY: 'clipboard:getHistory',
  CLIPBOARD_SAVE_HISTORY: 'clipboard:saveHistory',
  CLIPBOARD_READ: 'clipboard:read',
  CLIPBOARD_WRITE: 'clipboard:write',

  // SFTP
  SFTP_CONFIG_GET: 'sftp:getConfig',
  SFTP_CONFIG_SAVE: 'sftp:saveConfig',
  SFTP_PATHS_GET: 'sftp:getPaths',
  SFTP_PATHS_SAVE: 'sftp:savePaths',
  SFTP_TEST: 'sftp:test',
  SFTP_LIST: 'sftp:list',
  SFTP_UPLOAD: 'sftp:upload',
  SFTP_DEPLOY_ZIP: 'sftp:deployZip',
  SFTP_DELETE: 'sftp:delete',
  SFTP_COMPARE: 'sftp:compare',
  SFTP_LOCAL_LIST: 'sftp:localList',
  SFTP_MKDIR: 'sftp:mkdir',
  SFTP_PREFLIGHT: 'sftp:preflight',
  SFTP_PROFILES_GET: 'sftp:getProfiles',
  SFTP_PROFILE_SAVE: 'sftp:saveProfile',
  SFTP_PROFILE_ACTIVATE: 'sftp:activateProfile',
  SFTP_PROFILE_DELETE: 'sftp:deleteProfile',
  SFTP_HISTORY_GET: 'sftp:getHistory',
  SFTP_ROLLBACK: 'sftp:rollback',

  // GPT Image
  GPT_IMAGE_CONFIG_GET: 'gptImage:getConfig',
  GPT_IMAGE_CONFIG_SAVE: 'gptImage:saveConfig',
  GPT_IMAGE_MODELS_LIST: 'gptImage:listModels',
  GPT_IMAGE_GENERATE: 'gptImage:generate',
  GPT_IMAGE_SAVE: 'gptImage:save',
  GPT_IMAGE_HISTORY_GET: 'gptImage:getHistory',
  GPT_IMAGE_HISTORY_SAVE: 'gptImage:saveHistory',
  GPT_IMAGE_HISTORY_CLEAR: 'gptImage:clearHistory',

  // 大模型测试
  MODEL_TEST_LIST_PROVIDERS: 'modelTest:listProviders',
  MODEL_TEST_RUN: 'modelTest:run',
  MODEL_TEST_CANCEL: 'modelTest:cancel',
  MODEL_TEST_LIST_MODELS: 'modelTest:listModels',
  MODEL_TEST_MODEL_LIST_SETTINGS_GET: 'modelTest:getModelListSettings',
  MODEL_TEST_MODEL_LIST_SETTINGS_SAVE: 'modelTest:saveModelListSettings',
  MODEL_TEST_COPY_PROVIDER_VALUE: 'modelTest:copyProviderValue',
  MODEL_TEST_HISTORY_GET: 'modelTest:getHistory',
  MODEL_TEST_HISTORY_SAVE: 'modelTest:saveHistory',
  MODEL_TEST_MONITOR_GET: 'modelTest:getMonitorSettings',
  MODEL_TEST_MONITOR_SAVE: 'modelTest:saveMonitorSettings',
  MODEL_TEST_MONITOR_RUN: 'modelTest:runInspection',
  OPS_DASHBOARD_GET: 'ops:getDashboard',

  // AI 运维中心
  AI_OPS_GET_STATE: 'aiOps:getState',
  AI_PROVIDER_SAVE: 'aiOps:saveProvider',
  AI_PROVIDER_DELETE: 'aiOps:deleteProvider',
  AI_PROVIDER_ACTIVATE: 'aiOps:activateProvider',
  AI_PROVIDER_TEST: 'aiOps:testProvider',
  AI_EVALUATION_SAVE_CASES: 'aiOps:saveEvaluationCases',
  AI_EVALUATION_RUN: 'aiOps:runEvaluation',
  AI_LOG_ANALYZE: 'aiOps:analyzeLog',
  AI_KNOWLEDGE_SAVE: 'aiOps:saveKnowledge',
  AI_KNOWLEDGE_DELETE: 'aiOps:deleteKnowledge',
  AI_KNOWLEDGE_SEARCH: 'aiOps:searchKnowledge',
  AI_KNOWLEDGE_ANSWER: 'aiOps:answerKnowledge',
  AI_WORKFLOW_PLAN: 'aiOps:planWorkflow',
  AI_WORKFLOW_EXECUTE: 'aiOps:executeWorkflow',
  AI_COPILOT_ASK: 'aiOps:askCopilot',
  AI_KNOWLEDGE_IMPORT: 'aiOps:importKnowledge',
  OPS_EVENTS_GET: 'ops:getEvents',
  OPS_EVENT_UPDATE: 'ops:updateEvent',
  OPS_EVENTS_MARK_READ: 'ops:markEventsRead',
  OPS_NOTIFICATION_PREFERENCES_GET: 'ops:getNotificationPreferences',
  OPS_NOTIFICATION_PREFERENCES_SAVE: 'ops:saveNotificationPreferences',
  OPS_NOTIFICATION_TEST: 'ops:testNotification',
  OPS_NOTIFICATION_OPEN: 'ops:openNotification',
  OPS_AUTOMATION_GET: 'ops:getAutomationTasks',
  OPS_AUTOMATION_SAVE: 'ops:saveAutomationTask',
  OPS_AUTOMATION_DELETE: 'ops:deleteAutomationTask',
  OPS_AUTOMATION_RUN: 'ops:runAutomationTask',
  AI_MCP_INFO: 'aiOps:getMcpInfo',
}

module.exports = { IPC_CHANNELS }
