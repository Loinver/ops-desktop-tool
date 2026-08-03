#!/usr/bin/env node
/**
 * Ops Desktop MCP stdio server.
 * 仅公开本地只读运维数据，不读取或返回任何 Provider / SFTP 凭证。
 */
const readline = require('node:readline')
const { defaultUserDataPath, readMcpSnapshot, searchKnowledge } = require('./utils/ai-ops')

function tool(name, description, properties = {}, required = []) {
  return { name, description, inputSchema: { type: 'object', properties, required } }
}

const tools = [
  tool('get_release_history', '读取本机最近发布历史。可按环境名称筛选。', {
    environment: { type: 'string', description: '发布环境名称（可选）' },
    limit: { type: 'number', description: '返回数量，默认 10，最大 20' }
  }),
  tool('get_model_health', '读取本机最近模型巡检汇总。', {
    limit: { type: 'number', description: '返回数量，默认 10，最大 10' }
  }),
  tool(
    'search_ops_knowledge',
    '在本机 AI 运维知识库中检索。',
    {
      query: { type: 'string', description: '检索问题或关键词' },
      limit: { type: 'number', description: '返回片段数，默认 8，最大 20' }
    },
    ['query']
  )
]

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function callTool(userDataPath, name, args = {}) {
  const snapshot = readMcpSnapshot(userDataPath)
  if (name === 'get_release_history') {
    const env = String(args.environment || '')
      .trim()
      .toLowerCase()
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 10))
    const releases = snapshot.releases
      .filter(
        (item) =>
          !env ||
          String(item.profileName || '')
            .toLowerCase()
            .includes(env)
      )
      .slice(0, limit)
    return textResult({ releases })
  }
  if (name === 'get_model_health') {
    const limit = Math.max(1, Math.min(10, Number(args.limit) || 10))
    return textResult({ modelHealth: snapshot.modelHealth.slice(0, limit) })
  }
  if (name === 'search_ops_knowledge') {
    return textResult({
      results: searchKnowledge(userDataPath, String(args.query || ''), args.limit)
    })
  }
  throw new Error(`不支持的工具：${name}`)
}

function handleRequest(userDataPath, request) {
  if (request.method === 'initialize') {
    return {
      protocolVersion: request.params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'ops-desktop-tool', version: '1.0.0' },
      instructions:
        'Ops Desktop MCP server is local and read-only. Never returns credentials or executes deployments.'
    }
  }
  if (request.method === 'tools/list') return { tools }
  if (request.method === 'tools/call')
    return callTool(userDataPath, request.params?.name, request.params?.arguments)
  throw new Error(`不支持的方法：${request.method}`)
}

/**
 * 启动纯 stdio MCP 服务。该函数既可由 Node 直接运行，也可由已安装的 Electron 应用通过 --mcp 调用。
 */
function startMcpServer({
  userDataPath = defaultUserDataPath(),
  input = process.stdin,
  output = process.stdout
} = {}) {
  const send = (message) => output.write(`${JSON.stringify(message)}\n`)
  const reader = readline.createInterface({ input, crlfDelay: Infinity })
  reader.on('line', (line) => {
    let request
    try {
      request = JSON.parse(line)
    } catch {
      return
    }
    if (!Object.prototype.hasOwnProperty.call(request, 'id')) return
    try {
      send({ jsonrpc: '2.0', id: request.id, result: handleRequest(userDataPath, request) })
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'MCP server error'
        }
      })
    }
  })
  return reader
}

if (require.main === module) startMcpServer()

module.exports = { tools, callTool, handleRequest, startMcpServer }
