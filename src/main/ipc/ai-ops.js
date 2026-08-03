const path = require('node:path')
const fs = require('node:fs')
const { app, ipcMain, shell, dialog, BrowserWindow } = require('electron')
const { IPC_CHANNELS } = require('../../shared/ipc-channels')
const { readJsonFile } = require('../utils/json-store')
const { readQuickLaunchState } = require('../utils/quicklaunch-storage')
const { normalizeExternalUrl, openExternalUrl } = require('../utils/external-url')
const {
  redactSensitiveText,
  listProviderSources,
  listProviders,
  addProviderFromModelReliability,
  deleteProvider,
  activateProvider,
  runtimeProvider,
  askAiChat,
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
  saveWorkflowPlan
} = require('../utils/ai-ops')
const {
  addOpsEvent,
  deleteAutomationTask,
  eventSummary,
  listAutomationTasks,
  listOpsEvents,
  markOpsEventsRead,
  runAutomationTask,
  runDueAutomationTasks,
  saveAutomationTask,
  updateOpsEvent
} = require('../utils/ops-automation')

let automationTimer = null

function userDataPath() {
  return app.getPath('userData')
}
function success(value = {}) {
  return { ok: true, ...value }
}
function failure(error) {
  return { ok: false, error: error instanceof Error ? error.message : 'AI 运维操作失败' }
}

async function safeState() {
  return {
    providers: await listProviders({ userDataPath: userDataPath() }),
    evaluations: loadEvaluationState(userDataPath()),
    logs: loadLogState(userDataPath()),
    knowledge: loadKnowledgeState(userDataPath()),
    workflows: loadWorkflowState(userDataPath()),
    events: {
      items: listOpsEvents(userDataPath(), { limit: 100 }),
      summary: eventSummary(userDataPath())
    },
    automation: { tasks: listAutomationTasks(userDataPath()) }
  }
}

function startAutomationTimer() {
  if (automationTimer) return
  automationTimer = setInterval(() => {
    runDueAutomationTasks(userDataPath()).catch((error) => console.error('自动化巡检失败:', error))
  }, 60_000)
  automationTimer.unref?.()
}

function copilotContext(prompt) {
  const knowledge = searchKnowledge(userDataPath(), prompt, 5)
  const events = listOpsEvents(userDataPath(), { limit: 12 })
  const logs = loadLogState(userDataPath()).items.slice(0, 5)
  return {
    knowledge,
    text: [
      `近期事件：${events.map((item) => `[${item.level}/${item.status}] ${item.title}：${item.description}`).join('\n') || '无'}`,
      `近期日志分析：${logs.map((item) => `[${item.level}] ${item.title}：${item.headline}`).join('\n') || '无'}`,
      `知识证据：${knowledge.map((item, index) => `[${index + 1}] ${item.title}（第 ${item.startLine}-${item.endLine} 行）\n${item.content}`).join('\n\n') || '无'}`
    ]
      .join('\n\n')
      .slice(0, 30_000)
  }
}

async function generateOptionalAnalysis({ providerId, prompt }) {
  const provider = await runtimeProvider({ userDataPath: userDataPath(), providerId })
  const response = await requestCompletion(provider, {
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content:
          '你是谨慎的运维分析助手。仅根据给出的脱敏材料给出结论，区分事实、推测和建议；禁止输出密钥、密码或破坏性命令。'
      },
      { role: 'user', content: prompt }
    ]
  })
  return redactSensitiveText(response.content)
}

function registerAiOpsHandlers() {
  startAutomationTimer()
  ipcMain.handle(IPC_CHANNELS.AI_OPS_GET_STATE, async () => {
    try {
      return success(await safeState())
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_SOURCE_LIST, async () => {
    try {
      return success({ sources: await listProviderSources({ userDataPath: userDataPath() }) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_SOURCE_ADD, async (_event, input) => {
    try {
      return success(await addProviderFromModelReliability({ userDataPath: userDataPath(), input }))
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_DELETE, async (_event, id) => {
    try {
      return success({ providers: await deleteProvider({ userDataPath: userDataPath(), id }) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_ACTIVATE, async (_event, id) => {
    try {
      return success({ providers: await activateProvider({ userDataPath: userDataPath(), id }) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_PROVIDER_TEST, async (_event, providerId) => {
    try {
      const provider = await runtimeProvider({ userDataPath: userDataPath(), providerId })
      const result = await requestCompletion(provider, {
        messages: [{ role: 'user', content: '回复“连接正常”。' }],
        temperature: 0
      })
      return success({
        model: result.model,
        content: redactSensitiveText(result.content).slice(0, 500),
        usage: result.usage
      })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_CHAT_ASK, async (_event, options = {}) => {
    try {
      return success(
        await askAiChat({
          userDataPath: userDataPath(),
          providerId: options.providerId,
          messages: options.messages,
          knowledgeResults: options.knowledgeResults
        })
      )
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_EVALUATION_SAVE_CASES, async (_event, cases) => {
    try {
      return success({ cases: saveEvaluationCases(userDataPath(), cases) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_EVALUATION_RUN, async (_event, options) => {
    try {
      const run = await runEvaluation({
        userDataPath: userDataPath(),
        providerId: options?.providerId,
        caseIds: options?.caseIds
      })
      addOpsEvent(userDataPath(), {
        sourceKey: `evaluation:${run.id}`,
        category: 'model',
        level: run.summary.failed ? 'warning' : 'info',
        status: run.summary.failed ? 'open' : 'resolved',
        title: run.summary.failed
          ? `模型评测发现 ${run.summary.failed} 项异常`
          : '模型评测全部通过',
        description: `${run.providerName} · ${run.model} · ${run.summary.passed}/${run.summary.total} 通过`,
        relatedId: run.id
      })
      return success({ run })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_LOG_ANALYZE, async (_event, options) => {
    try {
      const title = String(options?.title || '未命名日志')
      const local = analyzeLogText(options?.text)
      let aiSummary = ''
      if (options?.useAi) {
        aiSummary = await generateOptionalAnalysis({
          providerId: options?.providerId,
          prompt: `请分析以下日志的本地统计结果和节选，给出：1. 已确认事实；2. 最可能原因（标记为推测）；3. 不含破坏性命令的下一步检查建议。\n\n统计：${JSON.stringify(local.findings)}\n\n日志节选：\n${local.excerpt}`
        })
      }
      const item = saveLogAnalysis(userDataPath(), { title, text: options?.text, aiSummary })
      if (item.level === 'high' || item.level === 'medium') {
        addOpsEvent(userDataPath(), {
          sourceKey: `log:${item.id}`,
          category: 'log',
          level: item.level === 'high' ? 'critical' : 'warning',
          title: `日志分析发现风险：${item.title}`,
          description: item.headline,
          relatedId: item.id
        })
      }
      return success({ item })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_SAVE, async (_event, document) => {
    try {
      return success({ document: saveKnowledgeDocument(userDataPath(), document) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_IMPORT, async (_event, inputPath) => {
    try {
      const candidate = String(inputPath || '').trim()
      if (!candidate) throw new Error('请先选择要导入的文档')
      const stat = fs.statSync(candidate)
      if (!stat.isFile()) throw new Error('只能导入普通文件')
      if (stat.size > 1_000_000) throw new Error('单个知识文档不能超过 1 MB')
      const extension = path.extname(candidate).toLowerCase()
      if (!['.md', '.txt', '.log', '.json', '.yml', '.yaml', '.conf'].includes(extension))
        throw new Error('仅支持 Markdown、文本、日志、JSON、YAML 或配置文件')
      const content = fs.readFileSync(candidate, 'utf8')
      const document = saveKnowledgeDocument(userDataPath(), {
        title: path.basename(candidate, extension) || path.basename(candidate),
        tags: ['导入文档', extension.replace('.', '')].filter(Boolean),
        content,
        source: { type: 'file', name: path.basename(candidate), importedAt: Date.now() }
      })
      return success({ document })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_EXPORT, async (_event, document) => {
    try {
      const title = String(document?.title || '未命名知识').trim() || '未命名知识'
      const content = String(document?.content || '')
      if (!content.trim()) throw new Error('文档内容为空，无法导出')
      const tags = Array.isArray(document?.tags) ? document.tags : []
      const focused = BrowserWindow.getFocusedWindow()
      const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
      const result = await dialog.showSaveDialog(focused, {
        title: '导出知识文档',
        defaultPath: `${safeName}.md`,
        filters: [
          { name: 'Markdown 文件', extensions: ['md'] },
          { name: '文本文件', extensions: ['txt'] }
        ]
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      const header = tags.length
        ? `# ${title}\n\n> 标签：${tags.join(' · ')}\n\n`
        : `# ${title}\n\n`
      fs.writeFileSync(result.filePath, `${header}${content}\n`, { encoding: 'utf8', mode: 0o600 })
      return success({ filePath: result.filePath })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_DELETE, async (_event, id) => {
    try {
      return success({ documents: deleteKnowledgeDocument(userDataPath(), id) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_SEARCH, async (_event, query) => {
    try {
      return success({ results: searchKnowledge(userDataPath(), query) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_KNOWLEDGE_ANSWER, async (_event, options) => {
    try {
      const query = String(options?.query || '').trim()
      const results = searchKnowledge(userDataPath(), query)
      if (!results.length) return success({ results, answer: '本地知识库没有检索到相关内容。' })
      if (!options?.useAi) return success({ results, answer: '' })
      const context = results
        .map(
          (item, index) =>
            `[${index + 1}] ${item.title}（第 ${item.startLine}-${item.endLine} 行）\n${item.content}`
        )
        .join('\n\n')
      const answer = await generateOptionalAnalysis({
        providerId: options?.providerId,
        prompt: `只依据以下本地知识片段回答问题；每个结论用 [编号] 标注来源。没有依据时明确说不知道。\n问题：${query}\n\n知识片段：\n${context}`
      })
      return success({ results, answer })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_WORKFLOW_PLAN, async (_event, prompt) => {
    try {
      const quickLaunch = readQuickLaunchState(
        readJsonFile(path.join(userDataPath(), 'quick-launch.json'), null)
      )
      const plan = planWorkflow({ prompt, quickLaunchItems: quickLaunch.items })
      return success({ plan: saveWorkflowPlan(userDataPath(), plan) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.AI_WORKFLOW_EXECUTE, async (_event, options) => {
    try {
      const plan = options?.plan
      if (!plan || !Array.isArray(plan.steps)) throw new Error('工作流预览无效，请重新生成')
      if (plan.steps.some((step) => step.requiresConfirmation) && options?.confirmed !== true)
        throw new Error('包含外部打开操作，请确认后再执行')
      const completed = []
      for (const step of plan.steps.slice(0, 20)) {
        if (step.type === 'open-url') {
          const url = normalizeExternalUrl(step.target)
          await openExternalUrl(url, { shell })
          completed.push({ ...step, target: url, status: 'done' })
        } else if (step.type === 'navigate') {
          completed.push({ ...step, status: 'requires-user-navigation' })
        } else {
          completed.push({ ...step, status: 'guided' })
        }
      }
      return success({ completed })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.AI_COPILOT_ASK, async (_event, options = {}) => {
    try {
      const prompt = String(options.prompt || '')
        .trim()
        .slice(0, 4000)
      if (!prompt) throw new Error('请输入需要分析的运维问题')
      const context = copilotContext(prompt)
      const quickLaunch = readQuickLaunchState(
        readJsonFile(path.join(userDataPath(), 'quick-launch.json'), null)
      )
      const plan = saveWorkflowPlan(
        userDataPath(),
        planWorkflow({ prompt, quickLaunchItems: quickLaunch.items })
      )
      let answer = ''
      if (options.useAi) {
        answer = await generateOptionalAnalysis({
          providerId: options.providerId,
          prompt: `用户问题：${prompt}\n\n请仅依据以下本地材料回答。输出：1. 已确认事实；2. 推测（明确标注）；3. 建议的只读检查；4. 如有工作流，提醒用户确认后执行。每个知识结论标注 [编号]。\n\n${context.text}`
        })
      } else {
        answer = `已收集 ${context.knowledge.length} 条知识证据、${listOpsEvents(userDataPath(), { limit: 12 }).length} 条近期事件。请查看下方证据和确认式工作流；配置 Provider 后可生成 AI 总结。`
      }
      addOpsEvent(userDataPath(), {
        sourceKey: `copilot:${plan.id}`,
        category: 'copilot',
        level: 'info',
        status: 'resolved',
        title: 'AI Copilot 已生成运维建议',
        description: prompt.slice(0, 300),
        relatedId: plan.id
      })
      return success({ answer, sources: context.knowledge, plan })
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.OPS_EVENTS_GET, async (_event, options = {}) => {
    try {
      return success({
        items: listOpsEvents(userDataPath(), options),
        summary: eventSummary(userDataPath())
      })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_EVENT_UPDATE, async (_event, options = {}) => {
    try {
      return success({
        item: updateOpsEvent(userDataPath(), String(options.id || ''), options.status)
      })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_EVENTS_MARK_READ, async (_event, options = {}) => {
    try {
      const result = markOpsEventsRead(userDataPath(), options)
      return success({ ...result, summary: eventSummary(userDataPath()) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_AUTOMATION_GET, async () => {
    try {
      return success({ tasks: listAutomationTasks(userDataPath()) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_AUTOMATION_SAVE, async (_event, task) => {
    try {
      return success({ task: saveAutomationTask(userDataPath(), task) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_AUTOMATION_DELETE, async (_event, id) => {
    try {
      return success({ tasks: deleteAutomationTask(userDataPath(), String(id || '')) })
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(IPC_CHANNELS.OPS_AUTOMATION_RUN, async (_event, id) => {
    try {
      return success(await runAutomationTask(userDataPath(), String(id || '')))
    } catch (error) {
      return failure(error)
    }
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
        : '开发环境可使用 pnpm mcp，或使用上方 Electron 命令启动；服务只提供本机只读数据。'
    })
  })
}

module.exports = { registerAiOpsHandlers }
