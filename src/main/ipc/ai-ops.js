const path = require('node:path')
const { app, ipcMain, safeStorage, shell } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { readJsonFile } = require('../utils/json-store')
const { readQuickLaunchState } = require('../utils/quicklaunch-storage')
const { normalizeExternalUrl, openExternalUrl } = require('../utils/external-url')
const {
  redactSensitiveText,
  listProviders,
  saveProvider,
  deleteProvider,
  activateProvider,
  runtimeProvider,
  requestCompletion,
  loadEvaluationState,
  saveEvaluationCases,
  runEvaluation,
  analyzeLogText,
  loadLogState,
  saveLogAnalysis,
  loadKnowledgeState,
  saveKnowledgeDocument,
  deleteKnowledgeDocument,
  searchKnowledge,
  loadWorkflowState,
  planWorkflow,
  saveWorkflowPlan,
} = require('../utils/ai-ops')

function userDataPath() { return app.getPath('userData') }
function success(value = {}) { return { ok: true, ...value } }
function failure(error) { return { ok: false, error: error instanceof Error ? error.message : 'AI 运维操作失败' } }

function safeState() {
  return {
    providers: listProviders({ userDataPath: userDataPath(), safeStorage }),
    evaluations: loadEvaluationState(userDataPath()),
    logs: loadLogState(userDataPath()),
    knowledge: loadKnowledgeState(userDataPath()),
    workflows: loadWorkflowState(userDataPath()),
  }
}

async function generateOptionalAnalysis({ providerId, prompt }) {
  const provider = runtimeProvider({ userDataPath: userDataPath(), safeStorage, providerId })
  const response = await requestCompletion(provider, {
    temperature: 0.1,
    messages: [
      { role: 'system', content: '你是谨慎的运维分析助手。仅根据给出的脱敏材料给出结论，区分事实、推测和建议；禁止输出密钥、密码或破坏性命令。' },
      { role: 'user', content: prompt },
    ],
  })
  return redactSensitiveText(response.content)
}

function registerAiOpsHandlers() {
  ipcMain.handle(IPC_CHANNELS.AI_OPS_GET_STATE, async () => {
    try { return success(safeState()) } catch (error) { return failure(error) }
  })

  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_SAVE, async (_event, input) => {
    try { return success(saveProvider({ userDataPath: userDataPath(), safeStorage, input })) } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_DELETE, async (_event, id) => {
    try { return success({ providers: deleteProvider({ userDataPath: userDataPath(), safeStorage, id }) }) } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_ACTIVATE, async (_event, id) => {
    try { return success({ providers: activateProvider({ userDataPath: userDataPath(), safeStorage, id }) }) } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_TEST, async (_event, providerId) => {
    try {
      const provider = runtimeProvider({ userDataPath: userDataPath(), safeStorage, providerId })
      const result = await requestCompletion(provider, { messages: [{ role: 'user', content: '回复“连接正常”。' }], temperature: 0 })
      return success({ model: result.model, content: redactSensitiveText(result.content).slice(0, 500), usage: result.usage })
    } catch (error) { return failure(error) }
  })

  ipcMain.handle(IPC_CHANNELS.AI_EVALUATION_SAVE_CASES, async (_event, cases) => {
    try { return success({ cases: saveEvaluationCases(userDataPath(), cases) }) } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.AI_EVALUATION_RUN, async (_event, options) => {
    try { return success({ run: await runEvaluation({ userDataPath: userDataPath(), safeStorage, providerId: options?.providerId, caseIds: options?.caseIds }) }) } catch (error) { return failure(error) }
  })

  ipcMain.handle(IPC_CHANNELS.AI_LOG_ANALYZE, async (_event, options) => {
    try {
      const title = String(options?.title || '未命名日志')
      const local = analyzeLogText(options?.text)
      let aiSummary = ''
      if (options?.useAi) {
        aiSummary = await generateOptionalAnalysis({
          providerId: options?.providerId,
          prompt: `请分析以下日志的本地统计结果和节选，给出：1. 已确认事实；2. 最可能原因（标记为推测）；3. 不含破坏性命令的下一步检查建议。\n\n统计：${JSON.stringify(local.findings)}\n\n日志节选：\n${local.excerpt}`,
        })
      }
      return success({ item: saveLogAnalysis(userDataPath(), { title, text: options?.text, aiSummary }) })
    } catch (error) { return failure(error) }
  })

  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_SAVE, async (_event, document) => {
    try { return success({ document: saveKnowledgeDocument(userDataPath(), document) }) } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_DELETE, async (_event, id) => {
    try { return success({ documents: deleteKnowledgeDocument(userDataPath(), id) }) } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_SEARCH, async (_event, query) => {
    try { return success({ results: searchKnowledge(userDataPath(), query) }) } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_ANSWER, async (_event, options) => {
    try {
      const query = String(options?.query || '').trim()
      const results = searchKnowledge(userDataPath(), query)
      if (!results.length) return success({ results, answer: '本地知识库没有检索到相关内容。' })
      if (!options?.useAi) return success({ results, answer: '' })
      const context = results.map((item, index) => `[${index + 1}] ${item.title}（第 ${item.startLine}-${item.endLine} 行）\n${item.content}`).join('\n\n')
      const answer = await generateOptionalAnalysis({
        providerId: options?.providerId,
        prompt: `只依据以下本地知识片段回答问题；每个结论用 [编号] 标注来源。没有依据时明确说不知道。\n问题：${query}\n\n知识片段：\n${context}`,
      })
      return success({ results, answer })
    } catch (error) { return failure(error) }
  })

  ipcMain.handle(IPC_CHANNELS.AI_WORKFLOW_PLAN, async (_event, prompt) => {
    try {
      const quickLaunch = readQuickLaunchState(readJsonFile(path.join(userDataPath(), 'quick-launch.json'), null))
      const plan = planWorkflow({ prompt, quickLaunchItems: quickLaunch.items })
      return success({ plan: saveWorkflowPlan(userDataPath(), plan) })
    } catch (error) { return failure(error) }
  })
  ipcMain.handle(IPC_CHANNELS.AI_WORKFLOW_EXECUTE, async (_event, options) => {
    try {
      const plan = options?.plan
      if (!plan || !Array.isArray(plan.steps)) throw new Error('工作流预览无效，请重新生成')
      if (plan.steps.some(step => step.requiresConfirmation) && options?.confirmed !== true) throw new Error('包含外部打开操作，请确认后再执行')
      const completed = []
      for (const step of plan.steps.slice(0, 20)) {
        if (step.type === 'open-url') {
          const url = normalizeExternalUrl(step.target)
          await openExternalUrl(url, { shell })
          completed.push({ ...step, target: url, status: 'done' })
        } else {
          completed.push({ ...step, status: 'previewed' })
        }
      }
      return success({ completed })
    } catch (error) { return failure(error) }
  })

  ipcMain.handle(IPC_CHANNELS.AI_MCP_INFO, async () => {
    const packaged = app.isPackaged
    return success({
      mode: 'stdio',
      readOnly: true,
      command: process.execPath,
      args: packaged ? ['--mcp'] : [app.getAppPath(), '--mcp'],
      script: path.join(app.getAppPath(), 'src', 'main', 'mcp-server.js'),
      tools: ['get_release_history', 'get_model_health', 'search_ops_knowledge'],
      note: packaged
        ? '当前安装包可通过上方命令以 stdio 模式启动 MCP；服务只提供本机只读数据。'
        : '开发环境可使用 pnpm mcp，或使用上方 Electron 命令启动；服务只提供本机只读数据。',
    })
  })
}

module.exports = { registerAiOpsHandlers }
