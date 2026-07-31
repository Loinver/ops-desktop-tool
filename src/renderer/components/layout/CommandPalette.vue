<template>
  <transition name="palette-fade">
    <div v-if="open" class="palette-mask" role="presentation" @mousedown.self="close">
      <section class="command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <div class="palette-search">
          <t-icon name="search" />
          <input ref="searchInput" v-model="query" type="search" autocomplete="off" placeholder="搜索页面、快捷启动或 AI 工作流…" @keydown.down.prevent="moveActive(1)" @keydown.up.prevent="moveActive(-1)" @keydown.enter.prevent="runActive" @keydown.esc.prevent="close" />
          <kbd>ESC</kbd>
        </div>

        <div class="palette-body">
          <div v-for="group in visibleGroups" :key="group.name" class="palette-group">
            <span class="palette-group-title">{{ group.name }}</span>
            <button v-for="command in group.items" :key="command.id" class="palette-item" :class="{ active: activeCommand?.id === command.id }" type="button" @mouseenter="activeId = command.id" @click="run(command)">
              <span class="palette-icon"><t-icon :name="command.icon" /></span>
              <span class="palette-copy"><strong>{{ command.name }}</strong><small>{{ command.description }}</small></span>
              <span class="palette-hint">{{ command.hint || '打开' }}</span>
            </button>
          </div>
          <div v-if="visibleCommands.length === 0" class="palette-empty"><t-icon name="search" /><strong>没有匹配的命令</strong><span>试试“发布”、“模型”或“快捷启动”。</span></div>
        </div>

        <footer class="palette-footer"><span><kbd>↑↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>⌘K</kbd> 随时唤起</span></footer>
      </section>
    </div>
  </transition>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close', 'open-request'])
const router = useRouter()
const query = ref('')
const activeId = ref('')
const searchInput = ref(null)

const commandGroups = [
  { name: '核心工作区', items: [
    { id: 'dashboard', name: '运维仪表盘', description: '发布、模型与巡检的集中总览', icon: 'dashboard', path: '/ops-dashboard' },
    { id: 'release', name: '系统发布', description: '切换环境、同步文件与查看发布历史', icon: 'folder-open', path: '/system-release' },
    { id: 'model-test', name: '模型测试', description: '测试模型连通性并配置定时巡检', icon: 'api', path: '/model-test' },
    { id: 'ai-ops', name: 'AI 运维中心', description: 'Provider、评测、知识库与 AI 工作流', icon: 'chat', path: '/ai-ops' },
  ] },
  { name: '效率工具', items: [
    { id: 'quick-launch', name: '快捷启动', description: '打开常用应用、目录和网站', icon: 'rocket', path: '/quick-launch', hint: '启动' },
    { id: 'clipboard', name: '剪贴板历史', description: '检索和复用已复制的内容', icon: 'file-copy', path: '/clipboard-history' },
    { id: 'node-services', name: 'Node 服务', description: '查看当前端口和服务占用', icon: 'code', path: '/node-services' },
    { id: 'system-info', name: '系统信息', description: '查看设备、运行环境与资源信息', icon: 'chart-area', path: '/system-info' },
  ] },
]

const normalizedQuery = computed(() => query.value.trim().toLowerCase())
const visibleGroups = computed(() => commandGroups.map(group => ({ ...group, items: group.items.filter(item => !normalizedQuery.value || `${item.name} ${item.description}`.toLowerCase().includes(normalizedQuery.value)) })).filter(group => group.items.length))
const visibleCommands = computed(() => visibleGroups.value.flatMap(group => group.items))
const activeCommand = computed(() => visibleCommands.value.find(item => item.id === activeId.value) || visibleCommands.value[0])

function close() { emit('close') }
function run(command) { if (!command) return; router.push(command.path); close() }
function runActive() { run(activeCommand.value) }
function moveActive(offset) { const list = visibleCommands.value; if (!list.length) return; const index = Math.max(0, list.findIndex(item => item.id === activeCommand.value?.id)); activeId.value = list[(index + offset + list.length) % list.length].id }
function onKeydown(event) { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (props.open) close(); else emit('open-request') } }

watch(() => props.open, async value => { if (value) { query.value = ''; activeId.value = visibleCommands.value[0]?.id || ''; await nextTick(); searchInput.value?.focus() } })
watch(visibleCommands, list => { if (!list.some(item => item.id === activeId.value)) activeId.value = list[0]?.id || '' })
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.palette-mask { position: fixed; z-index: 2000; inset: 0; display: flex; align-items: flex-start; justify-content: center; padding-top: min(16vh, 150px); background: rgba(15, 23, 42, .36); backdrop-filter: blur(5px); }
.command-palette { width: min(640px, calc(100vw - 40px)); overflow: hidden; border: 1px solid rgba(148, 163, 184, .35); border-radius: 16px; background: var(--shell-surface-raised); box-shadow: 0 28px 90px rgba(15, 23, 42, .28); }
.palette-search { display: flex; align-items: center; gap: 10px; height: 58px; padding: 0 16px; border-bottom: 1px solid var(--shell-border); color: var(--text-muted); }
.palette-search > .t-icon { color: var(--primary); font-size: 18px; }
.palette-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; }
.palette-search input::placeholder { color: var(--text-muted); }
kbd { padding: 2px 5px; border: 1px solid var(--border); border-bottom-color: var(--border-strong); border-radius: 5px; background: var(--bg-subtle); color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; }
.palette-body { max-height: min(53vh, 450px); padding: 8px; overflow-y: auto; }
.palette-group + .palette-group { margin-top: 8px; }
.palette-group-title { display: block; padding: 8px 10px 5px; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: .12em; }
.palette-item { width: 100%; display: flex; align-items: center; gap: 11px; padding: 9px 10px; border: 0; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.palette-item:hover,.palette-item.active { background: var(--primary-soft); }
.palette-icon { width: 32px; height: 32px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 9px; background: var(--bg-subtle); color: var(--primary); font-size: 16px; }
.palette-item.active .palette-icon { background: var(--primary); color: #fff; box-shadow: 0 5px 12px color-mix(in srgb, var(--primary) 32%, transparent); }
.palette-copy { min-width: 0; flex: 1; }
.palette-copy strong,.palette-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.palette-copy strong { color: var(--text); font-size: 13px; line-height: 19px; font-weight: 650; }
.palette-copy small { color: var(--text-muted); font-size: 11px; line-height: 17px; }
.palette-hint { color: var(--text-muted); font-size: 11px; }
.palette-empty { min-height: 190px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--text-muted); }
.palette-empty > .t-icon { color: var(--primary); font-size: 28px; }.palette-empty strong { color: var(--text-secondary); font-size: 14px; }.palette-empty span { font-size: 12px; }
.palette-footer { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-top: 1px solid var(--shell-border); color: var(--text-muted); font-size: 11px; }.palette-footer span { display: inline-flex; align-items: center; gap: 4px; }
.palette-fade-enter-active,.palette-fade-leave-active { transition: opacity .16s ease; }.palette-fade-enter-active .command-palette,.palette-fade-leave-active .command-palette { transition: transform .16s ease, opacity .16s ease; }.palette-fade-enter-from,.palette-fade-leave-to { opacity: 0; }.palette-fade-enter-from .command-palette,.palette-fade-leave-to .command-palette { opacity: 0; transform: translateY(-10px) scale(.985); }
@media (max-width: 640px) { .palette-mask { padding-top: 56px; }.palette-footer { justify-content: center; }.palette-footer span:last-child { display: none; } }
</style>
