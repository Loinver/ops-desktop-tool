const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const {
  redactSensitiveText,
  listProviderSources,
  listProviders,
  addProviderFromModelReliability,
  activateProvider,
  runtimeProvider,
  saveEvaluationCases,
  loadEvaluationState,
  analyzeLogText,
  saveKnowledgeDocument,
  searchKnowledge,
  planWorkflow,
} = require('../src/main/utils/ai-ops')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ops-ai-'))
}

function sourceProviderLoader() {
  return async () => ({
    ok: true,
    providers: [{
      id: 'cc-switch-test-provider',
      appType: 'codex',
      appLabel: 'Codex',
      name: '模型可靠性测试 Provider',
      protocol: 'openai',
      wireApi: 'chat',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: 'local-secret-key-123',
      apiKeyMasked: 'local-***-123',
      testable: true,
      models: [{ model: 'qwen3', label: 'qwen3' }],
    }],
  })
}

function writeModelTestHistory(directory, entries) {
  fs.writeFileSync(
    path.join(directory, 'model-test-history.json'),
    JSON.stringify(entries.map((entry, index) => ({
      id: `model-test-${index + 1}`,
      finishedAt: index + 1,
      results: [],
      ...entry,
    }))),
  )
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true })
}

test('敏感信息在保存与分析前会被脱敏', () => {
  const output = redactSensitiveText([
    'Authorization: Bearer this-is-a-long-token-12345',
    'api_key=sk-proj-abcdefghijklmnopqrstuv',
    'password=very-secret-password',
    '-----BEGIN PRIVATE KEY-----\nprivate-key-content\n-----END PRIVATE KEY-----',
  ].join('\n'))

  assert.doesNotMatch(output, /this-is-a-long-token|very-secret-password|private-key-content|sk-proj-abc/)
  assert.match(output, /\[已脱敏/) 
})

test('AI Provider 只保存模型可靠性引用，运行时读取最新凭证', async () => {
  const directory = makeTempDir()
  try {
    const providerLoader = sourceProviderLoader()
    writeModelTestHistory(directory, [{
      results: [{ providerId: 'cc-switch-test-provider', appType: 'codex', model: 'qwen3', status: 'ok' }],
    }])
    const sources = await listProviderSources({ userDataPath: directory, providerLoader })
    assert.equal(sources.length, 1)
    assert.equal(Object.hasOwn(sources[0], 'apiKey'), false)

    const saved = await addProviderFromModelReliability({
      userDataPath: directory,
      input: { sourceProviderId: 'cc-switch-test-provider', sourceAppType: 'codex', model: 'qwen3' },
      providerLoader,
    })
    await addProviderFromModelReliability({
      userDataPath: directory,
      input: { sourceProviderId: 'cc-switch-test-provider', sourceAppType: 'codex', model: 'qwen3' },
      providerLoader,
    })
    assert.equal(saved.provider.hasApiKey, true)
    assert.doesNotMatch(JSON.stringify(saved.provider), /local-secret-key-123/)

    const stored = fs.readFileSync(path.join(directory, 'ai-providers.json'), 'utf8')
    assert.doesNotMatch(stored, /local-secret-key-123|apiKeyEncrypted|baseUrl/)

    const listed = await listProviders({ userDataPath: directory, providerLoader })
    assert.equal(listed.activeProviderId, saved.provider.id)
    assert.equal(listed.providers.length, 1)
    assert.equal(Object.hasOwn(listed.providers[0], 'apiKey'), false)

    const runtime = await runtimeProvider({ userDataPath: directory, providerLoader })
    assert.equal(runtime.apiKey, 'local-secret-key-123')
  } finally {
    cleanup(directory)
  }
})

test('不可用的模型可靠性 Provider 不能被设为 AI 默认 Provider', async () => {
  const directory = makeTempDir()
  try {
    const readyLoader = sourceProviderLoader()
    writeModelTestHistory(directory, [{
      results: [{ providerId: 'cc-switch-test-provider', appType: 'codex', model: 'qwen3', status: 'ok' }],
    }])
    const saved = await addProviderFromModelReliability({
      userDataPath: directory,
      input: { sourceProviderId: 'cc-switch-test-provider', sourceAppType: 'codex', model: 'qwen3' },
      providerLoader: readyLoader,
    })
    const unavailableLoader = async () => ({
      ok: true,
      providers: [{
        ...((await readyLoader()).providers[0]),
        testable: false,
      }],
    })

    await assert.rejects(
      () => activateProvider({ userDataPath: directory, id: saved.provider.id, providerLoader: unavailableLoader }),
      /不可用|检查配置/,
    )
  } finally {
    cleanup(directory)
  }
})

test('模型评测用例会规范化关键词且日志规则可识别风险', () => {
  const directory = makeTempDir()
  try {
    const cases = saveEvaluationCases(directory, [{
      name: 'JSON 用例',
      prompt: '请返回 JSON，api_key=sk-proj-abcdefghijklmnopqrstuv',
      expectedKeywords: 'ok, ok， status',
      expectJson: true,
    }])
    assert.deepEqual(cases[0].expectedKeywords, ['ok', 'status'])
    assert.equal(loadEvaluationState(directory).cases.length, 1)
    assert.doesNotMatch(JSON.stringify(cases), /sk-proj/)

    const analysis = analyzeLogText('ERROR request timeout\npassword=not-for-storage\nNo space left on device')
    assert.equal(analysis.level, 'high')
    assert.ok(analysis.findings.some(item => item.type === 'error'))
    assert.ok(analysis.findings.some(item => item.type === 'timeout'))
    assert.ok(analysis.findings.some(item => item.type === 'disk'))
    assert.doesNotMatch(analysis.excerpt, /not-for-storage/)
  } finally {
    cleanup(directory)
  }
})

test('知识库支持脱敏、按行号检索，本地工作流不会生成危险命令', () => {
  const directory = makeTempDir()
  try {
    saveKnowledgeDocument(directory, {
      title: '正式环境发布 SOP',
      tags: '发布, 正式环境',
      content: '第一步：确认审批完成。\n第二步：如失败，按发布历史选择对应版本回滚。\ntoken=should-not-leak',
    })
    const results = searchKnowledge(directory, '如何回滚正式环境', 5)
    assert.equal(results.length, 1)
    assert.equal(results[0].title, '正式环境发布 SOP')
    assert.equal(results[0].startLine, 1)
    assert.doesNotMatch(results[0].content, /should-not-leak/)

    const plan = planWorkflow({
      prompt: '打开测试环境后台，然后进入发布页面',
      quickLaunchItems: [{ type: 'url', name: '测试环境后台', target: 'https://staging.example.com' }],
    })
    assert.match(plan.summary, /安全步骤/)
    assert.ok(plan.steps.some(step => step.type === 'open-url' && step.requiresConfirmation))
    assert.ok(plan.steps.some(step => step.type === 'navigate' && step.target === '/system-release'))
    assert.ok(plan.steps.every(step => step.id && step.description === step.label))
    assert.ok(plan.steps.every(step => step.type !== 'shell' && step.type !== 'deploy' && step.type !== 'delete'))
  } finally {
    cleanup(directory)
  }
})

test('MCP 服务仅公开只读工具', async () => {
  const directory = makeTempDir()
  const serverPath = path.join(__dirname, '../src/main/mcp-server.js')
  try {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, OPS_USER_DATA: directory },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    const response = new Promise((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('MCP tools/list 超时')), 3000)
      child.stdout.on('data', chunk => {
        output += chunk
        const line = output.split('\n').find(Boolean)
        if (!line) return
        clearTimeout(timer)
        try { resolve(JSON.parse(line)) } catch (error) { reject(error) }
      })
      child.once('error', reject)
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`)

    await response.then(message => {
      const names = message.result.tools.map(item => item.name)
      assert.deepEqual(names, ['get_release_history', 'get_model_health', 'search_ops_knowledge'])
      assert.ok(message.result.tools.every(item => !/deploy|delete|rollback/i.test(item.name)))
    })
    child.kill()
  } finally {
    cleanup(directory)
  }
})

test('模型可靠性中的 Responses、Anthropic 和 Gemini Provider 都可一键接入且不暴露密钥', async () => {
  const directory = makeTempDir()
  const providerLoader = async () => ({
    ok: true,
    providers: [
      { id: 'responses', appType: 'codex', name: 'Responses 网关', protocol: 'openai', wireApi: 'responses', baseUrl: 'https://responses.example.com/v1', apiKey: 'responses-secret', apiKeyMasked: 'res***', testable: true, models: [{ model: 'gpt-test' }] },
      { id: 'anthropic', appType: 'claude', name: 'Claude 网关', protocol: 'anthropic', baseUrl: 'https://claude.example.com', apiKey: 'claude-secret', apiKeyMasked: 'cla***', anthropicAuthType: 'bearer', anthropicBeta: 'feature-a', testable: true, models: [{ model: 'claude-test', beta1m: true }] },
      { id: 'gemini', appType: 'gemini', name: 'Gemini 网关', protocol: 'gemini', baseUrl: 'https://gemini.example.com', apiKey: 'gemini-secret', apiKeyMasked: 'gem***', testable: true, models: [{ model: 'gemini-test' }] },
    ],
  })
  try {
    writeModelTestHistory(directory, [{
      results: [
        { providerId: 'responses', appType: 'codex', model: 'gpt-test', status: 'ok' },
        { providerId: 'anthropic', appType: 'claude', model: 'claude-test', status: 'ok' },
        { providerId: 'gemini', appType: 'gemini', model: 'gemini-test', status: 'ok' },
      ],
    }])
    const sources = await listProviderSources({ userDataPath: directory, providerLoader })
    assert.deepEqual(sources.map(item => item.protocolLabel), ['OpenAI Responses', 'Anthropic Messages', 'Gemini generateContent'])
    assert.doesNotMatch(JSON.stringify(sources), /responses-secret|claude-secret|gemini-secret/)

    const saved = await addProviderFromModelReliability({
      userDataPath: directory,
      input: { sourceProviderId: 'anthropic', sourceAppType: 'claude', model: 'claude-test' },
      providerLoader,
    })
    assert.equal(saved.provider.protocol, 'anthropic')
    assert.equal(saved.provider.protocolLabel, 'Anthropic Messages')
    assert.equal(saved.provider.beta1m, undefined)

    const runtime = await runtimeProvider({ userDataPath: directory, providerLoader })
    assert.equal(runtime.protocol, 'anthropic')
    assert.equal(runtime.anthropicAuthType, 'bearer')
    assert.equal(runtime.beta1m, true)
    assert.equal(runtime.apiKey, 'claude-secret')
  } finally {
    cleanup(directory)
  }
})

test('AI Provider 仅展示最近一次模型测试通过的模型，失败后不可接入', async () => {
  const directory = makeTempDir()
  const providerLoader = async () => ({
    ok: true,
    providers: [{
      id: 'filtered-provider',
      appType: 'codex',
      name: '筛选测试 Provider',
      protocol: 'openai',
      wireApi: 'chat',
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-secret',
      testable: true,
      models: [
        { model: 'passed-model' },
        { model: 'failed-model' },
        { model: 'untested-model' },
      ],
    }],
  })
  try {
    writeModelTestHistory(directory, [
      {
        finishedAt: 100,
        results: [
          { providerId: 'filtered-provider', appType: 'codex', model: 'passed-model', status: 'ok' },
          { providerId: 'filtered-provider', appType: 'codex', model: 'failed-model', status: 'ok' },
        ],
      },
      {
        finishedAt: 200,
        results: [{ providerId: 'filtered-provider', appType: 'codex', model: 'failed-model', status: 'error' }],
      },
    ])

    const sources = await listProviderSources({ userDataPath: directory, providerLoader })
    assert.equal(sources.length, 1)
    assert.deepEqual(sources[0].models.map(item => item.model), ['passed-model'])

    await assert.rejects(
      () => addProviderFromModelReliability({
        userDataPath: directory,
        input: { sourceProviderId: 'filtered-provider', sourceAppType: 'codex', model: 'failed-model' },
        providerLoader,
      }),
      /尚未通过最近一次模型测试/,
    )
    await assert.rejects(
      () => addProviderFromModelReliability({
        userDataPath: directory,
        input: { sourceProviderId: 'filtered-provider', sourceAppType: 'codex', model: 'untested-model' },
        providerLoader,
      }),
      /尚未通过最近一次模型测试/,
    )

    const saved = await addProviderFromModelReliability({
      userDataPath: directory,
      input: { sourceProviderId: 'filtered-provider', sourceAppType: 'codex', model: 'passed-model' },
      providerLoader,
    })
    assert.equal(saved.provider.model, 'passed-model')

    writeModelTestHistory(directory, [{
      finishedAt: 300,
      results: [{ providerId: 'filtered-provider', appType: 'codex', model: 'passed-model', status: 'error' }],
    }])
    const listed = await listProviders({ userDataPath: directory, providerLoader })
    assert.equal(listed.providers[0].available, false)
    assert.match(listed.providers[0].issue, /尚未通过最近一次模型测试/)
    await assert.rejects(
      () => activateProvider({ userDataPath: directory, id: saved.provider.id, providerLoader }),
      /尚未通过最近一次模型测试/,
    )
    await assert.rejects(
      () => runtimeProvider({ userDataPath: directory, providerId: saved.provider.id, providerLoader }),
      /尚未通过最近一次模型测试/,
    )
  } finally {
    cleanup(directory)
  }
})
