<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-safe-area">
      <div class="brand" :title="collapsed ? 'Ops Desktop' : ''">
        <div class="brand-icon"><t-icon name="setting" /></div>
        <div v-show="!collapsed" class="brand-text">
          <h1>Ops Desktop</h1>
          <p>本机 AI 运维工作台</p>
        </div>
      </div>
      <button class="collapse-button" type="button" :title="collapsed ? '展开菜单' : '收起菜单'" :aria-label="collapsed ? '展开菜单' : '收起菜单'" @click="$emit('toggle')">
        <t-icon :name="collapsed ? 'menu-unfold' : 'menu-fold'" />
      </button>
    </div>

    <nav class="nav" aria-label="主导航">
      <section v-for="group in menuGroups" :key="group.name" class="nav-group">
        <p v-show="!collapsed" class="nav-group-title">{{ group.name }}</p>
        <button
          v-for="item in group.items"
          :key="item.path"
          :class="['nav-item', { active: currentRoute === item.path }]"
          type="button"
          :title="collapsed ? item.name : ''"
          :aria-label="item.name"
          @click="handleMenuChange(item.path)"
        >
          <t-icon :name="item.icon" class="nav-icon" />
          <span v-show="!collapsed" class="nav-label">{{ item.name }}</span>
          <span v-if="!collapsed && item.badge" class="nav-badge">{{ item.badge }}</span>
        </button>
      </section>
    </nav>

    <div class="sidebar-footer" :title="collapsed ? `${platform} · v${version}` : ''">
      <div class="platform-info">
        <span class="dot"></span>
        <span v-show="!collapsed">{{ platform }}</span>
      </div>
      <span v-show="!collapsed" class="version">v{{ version }}</span>
    </div>
  </aside>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNodeServicesStore } from '../../stores/nodeServices'
import { FUNCTION_MENU_GROUPS } from '../../config/function-menu'

const props = defineProps({ collapsed: { type: Boolean, default: false } })
defineEmits(['toggle'])

const route = useRoute()
const router = useRouter()
const nodeServicesStore = useNodeServicesStore()
const platform = ref('检测中…')
const version = ref('—')
const currentRoute = computed(() => route.path)

const menuGroups = computed(() => FUNCTION_MENU_GROUPS.map(group => ({
  ...group,
  items: group.items.map(item => ({
    ...item,
    badge: item.badge === 'services' ? nodeServicesStore.services.length || null : null,
  })),
})))

function handleMenuChange(path) {
  if (path !== route.path) router.push(path)
}

onMounted(async () => {
  try {
    const appInfo = await window.opsApi.getAppInfo()
    version.value = appInfo?.version || '—'
    platform.value = formatPlatform(appInfo?.platform)
  } catch {}

  try {
    const result = await window.opsApi.listPorts()
    if (result?.ok) {
      platform.value = formatPlatform(result.platform)
      if (nodeServicesStore.services.length === 0) {
        nodeServicesStore.services = (result.entries || []).map(entry => ({ ...entry, id: `${entry.protocol}-${entry.port}-${entry.pid}` }))
      }
    }
  } catch {}
})

function formatPlatform(value) {
  return ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' })[value] || value || '本机环境'
}
</script>

<style scoped>
.sidebar { width: var(--sidebar-width); min-width: var(--sidebar-width); height: 100%; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid rgba(255,255,255,.055); background: var(--sidebar-bg); color: #fff; user-select: none; transition: width var(--transition-slow), min-width var(--transition-slow); }
.sidebar.collapsed { width: var(--sidebar-collapsed-width); min-width: var(--sidebar-collapsed-width); }
.sidebar-safe-area { position: relative; padding: var(--window-safe-top) 14px 10px; }
.brand { min-height: 58px; display: flex; align-items: center; gap: 11px; padding: 0 7px; overflow: hidden; white-space: nowrap; }
.brand-icon { width: 38px; height: 38px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid rgba(255,255,255,.16); border-radius: 11px; background: linear-gradient(135deg, #7180ee, #5663ca); color: #fff; font-size: 18px; box-shadow: 0 8px 20px rgba(67, 83, 187, .35); }
.brand-text { min-width: 0; }.brand-text h1 { color: #fff; font-size: 15px; font-weight: 700; letter-spacing: -.25px; }.brand-text p { margin-top: 3px; color: var(--sidebar-text); font-size: 10px; letter-spacing: .02em; }
.collapse-button { position: absolute; right: 8px; bottom: -6px; width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #17223b; color: var(--sidebar-text); cursor: pointer; opacity: 0; transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast); }
.sidebar:hover .collapse-button,.sidebar:focus-within .collapse-button { opacity: 1; }.collapse-button:hover { background: #223052; color: #fff; }.sidebar.collapsed .collapse-button { right: 4px; bottom: 2px; }
.nav { flex: 1; min-height: 0; padding: 22px 8px 12px; overflow-x: hidden; overflow-y: auto; }.nav-group + .nav-group { margin-top: 17px; }.nav-group-title { padding: 0 12px 7px; color: rgba(203,213,225,.5); font-size: 10px; font-weight: 700; letter-spacing: .11em; line-height: 14px; text-transform: uppercase; }
.nav-item { width: 100%; min-height: 40px; display: flex; align-items: center; gap: 11px; padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: var(--sidebar-text); font: inherit; font-size: 13px; font-weight: 500; text-align: left; cursor: pointer; transition: background var(--transition-fast), color var(--transition-fast), transform var(--transition-fast); }.nav-item + .nav-item { margin-top: 2px; }.nav-item:hover { background: var(--sidebar-hover); color: var(--sidebar-text-active); }.nav-item.active { background: var(--sidebar-active); color: #fff; box-shadow: inset 2px 0 0 #818cf8; }.nav-item:active { transform: scale(.985); }.nav-icon { width: 18px; flex: 0 0 18px; color: currentColor; font-size: 17px; text-align: center; }.nav-item.active .nav-icon { color: #9eabff; }.nav-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.nav-badge { min-width: 19px; padding: 1px 6px; border-radius: 10px; background: rgba(129,140,248,.9); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
.sidebar.collapsed .sidebar-safe-area { padding-right: 9px; padding-left: 9px; }.sidebar.collapsed .brand { justify-content: center; padding: 0; }.sidebar.collapsed .nav { padding: 22px 8px 12px; }.sidebar.collapsed .nav-group + .nav-group { margin-top: 12px; }.sidebar.collapsed .nav-item { justify-content: center; padding: 0; border-radius: 10px; }.sidebar.collapsed .nav-item.active { box-shadow: inset 2px 0 0 #818cf8; }.sidebar.collapsed .nav-icon { font-size: 18px; }
.sidebar-footer { min-height: 51px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 20px; border-top: 1px solid rgba(255,255,255,.065); color: var(--sidebar-text); }.platform-info { display: inline-flex; align-items: center; gap: 7px; min-width: 0; font-size: 11px; }.dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 4px rgba(16,185,129,.1), 0 0 10px rgba(16,185,129,.45); }.version { color: rgba(255,255,255,.3); font-size: 10px; }.sidebar.collapsed .sidebar-footer { justify-content: center; padding: 0; }
</style>
