<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-icon">
        <t-icon name="setting" />
      </div>
      <div class="brand-text">
        <h1>Ops Desktop</h1>
        <p>系统运维工具集</p>
      </div>
    </div>

    <nav class="nav">
      <button
        v-for="item in menuItems"
        :key="item.path"
        :class="['nav-item', { active: currentRoute === item.path }]"
        @click="handleMenuChange(item.path)"
      >
        <t-icon :name="item.icon" class="nav-icon" />
        <span class="nav-label">{{ item.name }}</span>
        <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <div class="platform-info">
        <span class="dot"></span>
        <span>{{ platform }}</span>
      </div>
      <span class="version">v{{ version }}</span>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNodeServicesStore } from '../../stores/nodeServices'

const route = useRoute()
const router = useRouter()
const nodeServicesStore = useNodeServicesStore()
const platform = ref('检测中...')
const version = ref('—')

const currentRoute = computed(() => route.path)

const menuItems = computed(() => [
  { path: '/ops-dashboard', name: '运维仪表盘', icon: 'dashboard' },
  { path: '/node-services', name: 'Node 服务', icon: 'code', badge: nodeServicesStore.services.length || null },
  { path: '/system-release', name: '系统发布', icon: 'folder-open' },
  { path: '/gpt-image', name: 'AI 生图', icon: 'image' },
  { path: '/model-test', name: '模型测试', icon: 'dashboard' },
  { path: '/quick-launch', name: '快捷启动', icon: 'rocket' },
  { path: '/clipboard-history', name: '剪贴板历史', icon: 'file-copy' },
  { path: '/system-info', name: '系统信息', icon: 'chart-bar' },
])

function handleMenuChange(path) {
  router.push(path)
}

onMounted(async () => {
  try {
    const appInfo = await window.opsApi.getAppInfo()
    version.value = appInfo?.version || '—'
  } catch {}

  try {
    const result = await window.opsApi.listPorts()
    if (result.ok) {
      platform.value = formatPlatform(result.platform)
      // 初始化 store 数据
      if (nodeServicesStore.services.length === 0) {
        nodeServicesStore.services = result.entries.map(entry => ({
          ...entry,
          id: `${entry.protocol}-${entry.port}-${entry.pid}`
        }))
      }
    }
  } catch {}
})

function formatPlatform(p) {
  const map = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
  return map[p] || p || '未知'
}
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-width);
  background: var(--sidebar-bg);
  display: flex;
  flex-direction: column;
  user-select: none;
}

/* 品牌区 */
.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 28px 20px 24px;
}

.brand-icon {
  width: 42px;
  height: 42px;
  background: var(--primary-gradient);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 20px;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.brand-text h1 {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.3px;
}

.brand-text p {
  font-size: 11px;
  color: var(--sidebar-text);
  margin-top: 3px;
}

/* 导航 */
.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* 与品牌区留出呼吸感，避免首个菜单紧贴顶部。 */
  padding: 12px 8px 0;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 14px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--sidebar-text);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
  text-align: left;
}

.nav-item:hover {
  background: var(--sidebar-hover);
  color: var(--sidebar-text-active);
}

.nav-item.active {
  background: var(--sidebar-active);
  color: var(--sidebar-text-active);
}

.nav-item.active .nav-icon {
  color: #818cf8;
}

.nav-icon {
  font-size: 18px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.nav-label {
  flex: 1;
}

.nav-badge {
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 10px;
  min-width: 20px;
  text-align: center;
  line-height: 18px;
}

/* 底部 */
.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.platform-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--sidebar-text);
}

.dot {
  width: 7px;
  height: 7px;
  background: var(--success);
  border-radius: 50%;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.version {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.25);
}
</style>
