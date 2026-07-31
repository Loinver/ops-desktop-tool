import { createRouter, createWebHashHistory } from 'vue-router'
import AppLayout from '../components/layout/AppLayout.vue'

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
        path: 'node-services',
        name: 'NodeServices',
        component: () => import('../views/node-services/index.vue'),
        meta: { title: 'Node 服务' }
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
        path: 'system-release',
        name: 'SystemRelease',
        component: () => import('../views/system-release/index.vue'),
        meta: { title: '系统发布', keepAlive: true }
      },
      {
        path: 'gpt-image',
        name: 'GptImage',
        component: () => import('../views/gpt-image/index.vue'),
        meta: { title: 'AI 生图' }
      },
      {
        path: 'model-test',
        name: 'ModelTest',
        component: () => import('../views/model-test/index.vue'),
        meta: { title: '模型测试', keepAlive: true }
      },
      {
        path: 'ops-control-center',
        name: 'OpsControlCenter',
        component: () => import('../views/ops-control-center/index.vue'),
        meta: { title: 'AI 运维指挥中心', keepAlive: true }
      },
      {
        path: 'ai-ops',
        name: 'AiOps',
        component: () => import('../views/ai-ops/index.vue'),
        meta: { title: 'AI 运维中心', keepAlive: true }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router
