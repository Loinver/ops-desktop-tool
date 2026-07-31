<template>
  <div class="app-layout" :class="{ 'sidebar-is-collapsed': sidebarCollapsed }">
    <Sidebar :collapsed="sidebarCollapsed" @toggle="toggleSidebar" />
    <section class="app-shell">
      <Topbar @open-command="commandPaletteOpen = true" />
      <main class="workspace">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <keep-alive :include="['SystemRelease', 'ModelTest', 'AiOps']">
              <component :is="Component" />
            </keep-alive>
          </transition>
        </router-view>
      </main>
    </section>
    <CommandPalette :open="commandPaletteOpen" @close="commandPaletteOpen = false" @open-request="commandPaletteOpen = true" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import CommandPalette from './CommandPalette.vue'
import Sidebar from './Sidebar.vue'
import Topbar from './Topbar.vue'

const SIDEBAR_COLLAPSED_KEY = 'ops-desktop.sidebar-collapsed'
const sidebarCollapsed = ref(readSidebarPreference())
const commandPaletteOpen = ref(false)

function readSidebarPreference() {
  try { return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true' } catch { return false }
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed.value)) } catch {}
}
</script>

<style scoped>
.app-layout { width: 100vw; height: 100vh; display: flex; overflow: hidden; background: var(--shell-bg); }
.app-shell { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--shell-bg); }
.workspace { min-width: 0; min-height: 0; flex: 1; overflow: hidden; position: relative; }
.workspace::before { position: absolute; z-index: 0; inset: 0; pointer-events: none; content: ''; background-image: radial-gradient(circle at 83% -10%, rgba(99,102,241,.08), transparent 25%), radial-gradient(circle at 6% 100%, rgba(14,165,233,.055), transparent 23%); }
.workspace :deep(> *) { position: relative; z-index: 1; }
.page-fade-enter-active,.page-fade-leave-active { transition: opacity .18s ease, transform .18s ease; }.page-fade-enter-from { opacity: 0; transform: translateY(6px); }.page-fade-leave-to { opacity: 0; transform: translateY(-3px); }
</style>
