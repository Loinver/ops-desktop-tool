export function validateProviderForm(input = {}) {
  if (!String(input.name || '').trim()) return '请输入 Provider 名称'
  if (!String(input.baseUrl || '').trim()) return '请输入 AI 接口地址'
  if (!String(input.model || '').trim()) return '请输入默认模型'
  if (!String(input.id || '').trim() && !String(input.apiKey || '').trim()) return '新建 Provider 时请输入 API Key'
  return ''
}
