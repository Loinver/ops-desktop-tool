import { createRouter, createWebHashHistory } from 'vue-router'
import AppLayout from '../components/layout/AppLayout.vue'

const loadAiOpsView = () => import('../views/ai-ops/index.vue')

const routes = [
  {
    path: '/',
    component: AppLayout,
    redirect: '/ops-dashboard',
    children: [
      {
        path: 'ops-dashboard',
        name: 'OpsDashboard',
        component: () => import('../views/ops-dashboard/index.vue'),
        meta: { title: '运维仪表盘' }
      },
      {
        path: 'ops-control-center',
        name: 'OpsControlCenter',
        component: () => import('../views/ops-control-center/index.vue'),
        meta: { title: '运维中心', keepAlive: true }
      },
      {
        path: 'system-release',
        name: 'SystemRelease',
        component: () => import('../views/system-release/index.vue'),
        meta: { title: '系统发布', keepAlive: true }
      },
      {
        path: 'model-test',
        name: 'ModelTest',
        component: () => import('../views/model-test/index.vue'),
        meta: { title: '模型可靠性', keepAlive: true }
      },
      {
        path: 'node-services',
        name: 'NodeServices',
        component: () => import('../views/node-services/index.vue'),
        meta: { title: 'Node 服务' }
      },
      {
        path: 'ai-ops',
        redirect: (to) => {
          const tab = String(to.query.tab || '')
          const target =
            {
              providers: '/ai-models',
              evaluation: '/ai-models',
              logs: '/ai-operations',
              workflow: '/ai-operations',
              knowledge: '/knowledge-base',
              mcp: '/ai-integrations'
            }[tab] || '/ai-models'
          return { path: target, query: to.query }
        }
      },
      {
        path: 'ai-models',
        name: 'AiModels',
        component: loadAiOpsView,
        props: { section: 'models' },
        meta: { title: '模型中心' }
      },
      {
        path: 'knowledge-base',
        name: 'KnowledgeBase',
        component: loadAiOpsView,
        props: { section: 'knowledge' },
        meta: { title: '知识库' }
      },
      {
        path: 'ai-operations',
        name: 'AiOperations',
        component: loadAiOpsView,
        props: { section: 'operations' },
        meta: { title: 'AI 运维工具' }
      },
      {
        path: 'ai-integrations',
        name: 'AiIntegrations',
        component: loadAiOpsView,
        props: { section: 'integrations' },
        meta: { title: 'AI 集成' }
      },
      {
        path: 'ai-chat',
        name: 'AiChat',
        component: () => import('../views/ai-chat/index.vue'),
        meta: { title: 'AI 对话', keepAlive: true }
      },
      {
        path: 'quick-launch',
        name: 'QuickLaunch',
        component: () => import('../views/quick-launch/index.vue'),
        meta: { title: '快捷启动' }
      },
      {
        path: 'clipboard-history',
        name: 'ClipboardHistory',
        component: () => import('../views/clipboard-history/index.vue'),
        meta: { title: '剪贴板历史' }
      },
      {
        path: 'system-info',
        name: 'SystemInfo',
        component: () => import('../views/system-info/index.vue'),
        meta: { title: '系统信息' }
      },
      {
        path: 'app-update',
        name: 'AppUpdate',
        component: () => import('../views/app-update/index.vue'),
        meta: { title: '应用更新' }
      },
      {
        path: 'data-management',
        name: 'DataManagement',
        component: () => import('../views/data-management/index.vue'),
        meta: { title: '本地数据管理' }
      },
      {
        path: 'gpt-image',
        name: 'GptImage',
        component: () => import('../views/gpt-image/index.vue'),
        meta: { title: '图像生成' }
      },
      {
        path: ':pathMatch(.*)*',
        name: 'NotFound',
        component: () => import('../views/not-found/index.vue'),
        meta: { title: '页面不存在' }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

const BASE_TITLE = 'Ops Desktop'

router.afterEach((to) => {
  const pageTitle = to.meta?.title
  document.title = pageTitle ? `${pageTitle} - ${BASE_TITLE}` : BASE_TITLE
})

export default router
