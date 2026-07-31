/**
 * 应用功能导航的唯一配置源。
 * 侧边栏、命令面板与顶部面包屑均从这里读取，避免页面入口分组不一致。
 */
export const FUNCTION_MENU_GROUPS = [
  {
    id: 'operations',
    name: '核心运维',
    items: [
      {
        id: 'ops-dashboard',
        path: '/ops-dashboard',
        name: '运维仪表盘',
        description: '集中查看发布、模型、巡检与服务运行摘要',
        icon: 'dashboard',
      },
      {
        id: 'ops-control-center',
        path: '/ops-control-center',
        name: 'AI 运维指挥中心',
        description: '使用 Copilot 处理事件并编排自动化巡检',
        icon: 'chat',
      },
    ],
  },
  {
    id: 'delivery',
    name: '发布与服务',
    items: [
      {
        id: 'system-release',
        path: '/system-release',
        name: '系统发布',
        description: '管理环境、同步文件、健康检查与版本回滚',
        icon: 'folder-open',
      },
      {
        id: 'node-services',
        path: '/node-services',
        name: 'Node 服务',
        description: '查看本机端口占用和正在监听的服务',
        icon: 'code',
        badge: 'services',
      },
    ],
  },
  {
    id: 'ai',
    name: 'AI 能力',
    items: [
      {
        id: 'ai-ops',
        path: '/ai-ops',
        name: 'AI 运维中心',
        description: '配置 Provider、评测、日志分析、知识库与工作流',
        icon: 'chat',
      },
      {
        id: 'model-test',
        path: '/model-test',
        name: '模型测试',
        description: '验证模型可用性，并配置定时健康巡检',
        icon: 'api',
      },
      {
        id: 'gpt-image',
        path: '/gpt-image',
        name: 'AI 生图',
        description: '调用图像模型生成、管理和保存图片',
        icon: 'image',
      },
    ],
  },
  {
    id: 'desktop',
    name: '本机工具',
    items: [
      {
        id: 'quick-launch',
        path: '/quick-launch',
        name: '快捷启动',
        description: '快速打开常用应用、目录和网站',
        icon: 'rocket',
        hint: '启动',
      },
      {
        id: 'clipboard-history',
        path: '/clipboard-history',
        name: '剪贴板历史',
        description: '检索、复制和复用最近的剪贴板内容',
        icon: 'file-copy',
      },
      {
        id: 'system-info',
        path: '/system-info',
        name: '系统信息',
        description: '查看设备、运行环境与资源信息',
        icon: 'chart-area',
      },
    ],
  },
]

export const FUNCTION_MENU_ITEMS = FUNCTION_MENU_GROUPS.flatMap(group => group.items.map(item => ({ ...item, groupId: group.id, groupName: group.name })))

export function getFunctionMenuItem(path) {
  return FUNCTION_MENU_ITEMS.find(item => item.path === path) || null
}
