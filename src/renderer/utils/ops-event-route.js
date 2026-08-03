const SOURCE_ROUTES = {
  release: '/system-release',
  'model-monitor': '/model-test',
  model: '/model-test',
  automation: '/ops-control-center',
  log: '/ai-operations',
  copilot: '/ai-operations',
  'node-service': '/node-services',
  'data-backup': '/data-management'
}

function queryValue(input) {
  if (input === undefined || input === null || input === '') return undefined
  return String(input)
}

export function routeForOpsEvent(event = {}) {
  const sourceType = event.sourceType || event.category || 'system'
  const path = SOURCE_ROUTES[sourceType] || '/ops-control-center'
  const query = {
    event: queryValue(event.id),
    sourceId: queryValue(event.sourceId || event.relatedId)
  }
  if (sourceType === 'node-service') {
    query.protocol = queryValue(
      event.attributes?.protocol || String(event.sourceId || '').split(':')[0]
    )
    query.port = queryValue(event.attributes?.port || String(event.sourceId || '').split(':')[1])
  }
  return {
    path,
    query: Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined))
  }
}
