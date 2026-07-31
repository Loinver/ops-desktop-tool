/**
 * 应用功能导航的唯一配置源。
 * 侧边栏、命令面板与顶部面包屑均从这里读取，避免页面入口分组不一致。
 */
export const FUNCTION_MENU_GROUPS = [
  {
    id: 'overview',
    name: '总览',
    items: [
      {
        id: 'ops-dashboard',
        path: '/ops-dashboard',
        name: '运维仪表盘',
        description: '统一查看发布、模型可靠性、自动化巡检与待处理事件',
        icon: 'dashboard',
      },
      {
        id: 'ops-control-center',
        path: '/ops-control-center',
        name: '运维中心',
        description: '集中处理事件、运行巡检并使用 AI Copilot 辅助排障',
        icon: 'chat',
      },
    ],
  },
  {
    id: 'operations',
    name: '核心运维',
    items: [
      {
        id: 'system-release',
        path: '/system-release',
        name: '系统发布',
        description: '管理环境、同步文件、健康检查与版本回滚',
        icon: 'folder-open',
      },
      {
        id: 'model-test',
        path: '/model-test',
        name: '模型可靠性',
        description: '测试模型可用性，管理范围、历史趋势与定时巡检',
        icon: 'api',
      },
      {
        id: 'node-services',
        path: '/node-services',
        name: 'Node 服务',
        description: '查看本机 Node.js 监听端口并安全结束占用进程',
        icon: 'code',
        badge: 'services',
      },
    ],
  },
  {
    id: 'intelligence',
    name: 'AI 与知识',
    items: [
      {
        id: 'ai-ops',
        path: '/ai-ops',
        name: 'AI 能力中心',
        description: '管理 Provider、模型评测、日志分析、知识库与安全工作流',
        icon: 'gesture-pray',
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
  {
    id: 'experiments',
    name: '实验功能',
    items: [
      {
        id: 'gpt-image',
        path: '/gpt-image',
        name: 'AI 图像实验',
        description: '调用兼容图像模型生成、管理和保存图片',
        icon: 'image',
      },
    ],
  },
]

export const FUNCTION_MENU_ITEMS = FUNCTION_MENU_GROUPS.flatMap(group => group.items.map(item => ({ ...item, groupId: group.id, groupName: group.name })))

export function getFunctionMenuItem(path) {
  return FUNCTION_MENU_ITEMS.find(item => item.path === path) || null
}
