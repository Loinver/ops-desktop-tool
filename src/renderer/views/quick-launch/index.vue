<template>
  <div class="page">
    <header class="page-header">
      <div class="page-heading header-left">
        <h2 class="page-title">快捷启动</h2>
        <p class="page-desc">管理常用应用和网站，并按配置一键打开多个网站</p>
      </div>
      <div class="page-actions header-actions">
        <button type="button"
          class="btn-open"
          :disabled="batchOpening"
          :title="store.quickOpenItems.length ? `打开已配置的 ${store.quickOpenItems.length} 个网站` : '请先配置一键打开的网站'"
          @click="openConfiguredWebsites"
        >
          <t-icon name="rocket" />
          <span>{{ batchOpening ? '正在打开…' : `一键打开${store.quickOpenItems.length ? `（${store.quickOpenItems.length}）` : ''}` }}</span>
        </button>
        <button type="button" class="btn-batch" title="选择一键打开的网站" @click="showQuickOpenDialog = true">
          <t-icon name="setting" />
          <span>配置网站</span>
        </button>
        <button type="button" class="btn-batch" title="粘贴 JSON 文本，批量添加网址快捷方式" @click="showBatchTextDialog = true">
          <t-icon name="edit" />
          <span>粘贴 JSON</span>
        </button>
        <button type="button" class="btn-batch" title="从 JSON 文件批量导入网址快捷方式" @click="importWebsites">
          <t-icon name="upload" />
          <span>导入</span>
        </button>
        <button type="button" class="btn-batch" title="导出当前网址快捷方式" @click="exportWebsites">
          <t-icon name="download" />
          <span>导出</span>
        </button>
        <button type="button" class="btn-add" @click="openAdd">
          <t-icon name="add" />
          <span>添加</span>
        </button>
      </div>
    </header>

    <main class="page-content">
      <div class="list-toolbar">
          <div class="filter-bar" role="tablist" aria-label="快捷方式类型筛选">
        <button type="button"
          v-for="tab in tabs"
          :key="tab.id"
          :class="['filter-chip', { active: store.currentTab === tab.id }]"
          role="tab"
          :aria-selected="store.currentTab === tab.id"
          @click="store.currentTab = tab.id"
        >
          <t-icon :name="tab.icon" />
          <span>{{ tab.name }}</span>
          <span v-if="tab.count > 0" class="chip-badge">{{ tab.count }}</span>
        </button>
      </div>
      <label class="page-search">
        <t-icon name="search" />
        <input v-model="store.searchQuery" type="search" placeholder="搜索名称或地址" />
        <button v-if="store.searchQuery" type="button" title="清除搜索" @click="store.searchQuery = ''">
          <t-icon name="close" />
        </button>
      </label>
    </div>

      <section class="content" aria-live="polite">
      <div v-if="loading" class="loading-state">
        <t-icon name="loading" />
        <span>正在加载快捷方式…</span>
      </div>

      <div v-else-if="store.filteredItems.length === 0" class="empty-state">
        <div class="empty-illustration">
          <div class="empty-circle">
            <t-icon :name="store.searchQuery ? 'search' : 'rocket'" />
          </div>
          <div v-if="!store.searchQuery" class="empty-particles">
            <span class="particle p1"></span>
            <span class="particle p2"></span>
            <span class="particle p3"></span>
          </div>
        </div>
        <h3>{{ store.searchQuery ? '没有匹配的快捷方式' : '暂无快捷方式' }}</h3>
        <p>{{ store.searchQuery ? '请更换关键词，或清除搜索条件' : '点击右上角“添加”创建快捷启动，或从 JSON 文件导入网址' }}</p>
        <button type="button" v-if="store.searchQuery" class="btn-guide" @click="store.searchQuery = ''">
          清除搜索
        </button>
        <button type="button" v-else class="btn-guide" @click="openAdd">
          <t-icon name="add" />
          立即添加
        </button>
      </div>

      <div v-else class="launch-grid">
        <LaunchCard
          v-for="item in store.filteredItems"
          :key="item.id"
          :item="item"
          @launch="handleLaunch"
          @edit="editItem"
          @delete="deleteItem"
        />
      </div>
      </section>
    </main>

    <LaunchDialog
      v-model="showAddDialog"
      :editing-item="editingItem"
      @saved="onSaved"
    />
    <BatchWebsiteDialog
      v-model="showBatchTextDialog"
      @parsed="addImportedWebsites"
    />
    <QuickOpenDialog
      v-model="showQuickOpenDialog"
      @saved="onQuickOpenSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useQuickLaunchStore } from '../../stores/quickLaunch'
import { useConfirm } from '../../composables/useConfirm'
import LaunchCard from './components/LaunchCard.vue'
import LaunchDialog from './components/LaunchDialog.vue'
import BatchWebsiteDialog from './components/BatchWebsiteDialog.vue'
import QuickOpenDialog from './components/QuickOpenDialog.vue'

const store = useQuickLaunchStore()
const { confirm } = useConfirm()

const loading = ref(true)
const batchOpening = ref(false)
const showAddDialog = ref(false)
const showBatchTextDialog = ref(false)
const showQuickOpenDialog = ref(false)
const editingItem = ref(null)

const tabs = computed(() => [
  { id: 'all', name: '全部', icon: 'folder-open', count: store.items.length },
  { id: 'app', name: '应用', icon: 'app', count: store.items.filter(item => item.type === 'app').length },
  { id: 'url', name: '网址', icon: 'earth', count: store.websiteItems.length },
  { id: 'folder', name: '文件夹', icon: 'folder', count: store.items.filter(item => item.type === 'folder').length },
])

function openAdd() {
  editingItem.value = null
  showAddDialog.value = true
}

function editItem(item) {
  editingItem.value = { ...item }
  showAddDialog.value = true
}

async function handleLaunch(item) {
  try {
    const result = await store.launchItem(item)
    const ok = typeof result === 'boolean' ? result : result?.ok

    if (ok) {
      const content = item.type === 'url'
        ? `已在默认浏览器打开 ${result?.target || item.name}`
        : `正在启动 ${item.name}`
      MessagePlugin.success({ content, placement: 'bottom-right' })
    } else {
      MessagePlugin.error({
        content: result?.error || '启动失败，请检查目标地址或路径',
        placement: 'bottom-right',
      })
    }
  } catch (error) {
    MessagePlugin.error({
      content: error instanceof Error ? error.message : '启动失败，请检查目标地址或路径',
      placement: 'bottom-right',
    })
  }
}

async function openConfiguredWebsites() {
  if (!store.quickOpenItems.length) {
    MessagePlugin.warning({ content: '请先选择需要一键打开的网站', placement: 'bottom-right' })
    showQuickOpenDialog.value = true
    return
  }

  batchOpening.value = true
  try {
    const result = await store.launchQuickOpenItems()
    if (result?.opened && result?.failed) {
      MessagePlugin.warning({
        content: `已打开 ${result.opened} 个网站，${result.failed} 个打开失败`,
        placement: 'bottom-right',
      })
    } else if (result?.ok) {
      MessagePlugin.success({
        content: `已在默认浏览器打开 ${result.opened} 个网站`,
        placement: 'bottom-right',
      })
    } else {
      MessagePlugin.error({
        content: result?.error || '一键打开网站失败',
        placement: 'bottom-right',
      })
    }
  } catch (error) {
    MessagePlugin.error({
      content: error instanceof Error ? error.message : '一键打开网站失败',
      placement: 'bottom-right',
    })
  } finally {
    batchOpening.value = false
  }
}

async function deleteItem(item) {
  const confirmed = await confirm({
    title: '删除快捷方式',
    content: `确定删除「${item.name}」吗？`,
    theme: 'warning',
  })
  if (!confirmed) return

  try {
    const ok = await store.deleteItem(item.id)
    if (!ok) {
      MessagePlugin.error({ content: '删除失败，配置未保存', placement: 'bottom-right' })
      return
    }
    MessagePlugin.success({ content: '已删除', placement: 'bottom-right' })
  } catch (error) {
    MessagePlugin.error({
      content: error instanceof Error ? error.message : '删除快捷方式失败',
      placement: 'bottom-right',
    })
  }
}

async function importWebsites() {
  try {
    const result = await store.importWebsiteItems()
    if (result?.canceled) return
    await addImportedWebsites(result)
  } catch (error) {
    MessagePlugin.error({
      content: error instanceof Error ? error.message : '导入网址 JSON 失败',
      placement: 'bottom-right',
    })
  }
}

async function addImportedWebsites(result) {
  if (!result?.ok) {
    MessagePlugin.error({ content: result?.error || '导入网址 JSON 失败', placement: 'bottom-right' })
    return
  }

  const merged = await store.mergeWebsiteItems(result.items)
  if (!merged.ok) {
    MessagePlugin.error({ content: '网址快捷方式保存失败', placement: 'bottom-right' })
    return
  }

  const skipped = (result.skipped || 0) + merged.duplicates
  const content = skipped
    ? `已添加 ${merged.added} 个网址，跳过 ${skipped} 个重复或无效项`
    : `已添加 ${merged.added} 个网址快捷方式`
  MessagePlugin.success({ content, placement: 'bottom-right' })
}

async function exportWebsites() {
  try {
    const result = await store.exportWebsiteItems()
    if (result?.canceled) return
    if (!result?.ok) {
      MessagePlugin.error({ content: result?.error || '导出网址 JSON 失败', placement: 'bottom-right' })
      return
    }

    MessagePlugin.success({
      content: `已导出 ${result.count} 个网址${result.count ? '' : '（空白模板）'}`,
      placement: 'bottom-right',
    })
  } catch (error) {
    MessagePlugin.error({
      content: error instanceof Error ? error.message : '导出网址 JSON 失败',
      placement: 'bottom-right',
    })
  }
}

function onSaved() {
  editingItem.value = null
  MessagePlugin.success({ content: '已保存', placement: 'bottom-right' })
}

function onQuickOpenSaved(count) {
  MessagePlugin.success({
    content: count ? `已配置一键打开 ${count} 个网站` : '已清空一键打开配置',
    placement: 'bottom-right',
  })
}

onMounted(async () => {
  try {
    const result = await store.fetchItems()
    if (!result?.ok) {
      MessagePlugin.error({ content: '快捷启动配置读取失败', placement: 'bottom-right' })
    }
  } catch (error) {
    MessagePlugin.error({
      content: error instanceof Error ? error.message : '快捷启动配置加载失败',
      placement: 'bottom-right',
    })
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
@media (max-width: 1180px) {
  .page-header {
    flex-direction: column;
  }

  .header-actions {
    flex-wrap: wrap;
  }
}

.btn-add,
.btn-batch,
.btn-open {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: var(--header-control-height);
  padding: 0 18px;
  border: none;
  border-radius: var(--radius);
  background: var(--primary);
  color: #fff;
  font-size: var(--header-control-font-size);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
  box-shadow: 0 2px 8px rgba(91, 106, 191, 0.3);
}

.btn-add:hover,
.btn-open:hover:not(:disabled) {
  background: var(--primary-hover);
  box-shadow: 0 4px 12px rgba(91, 106, 191, 0.4);
  transform: translateY(-1px);
}

.btn-open {
  background: linear-gradient(135deg, var(--primary), #7c3aed);
}

.btn-open:disabled {
  cursor: wait;
  opacity: 0.7;
}

.btn-batch {
  border: 1px solid var(--border);
  background: var(--card-bg);
  color: var(--text-secondary);
  box-shadow: none;
}

.btn-batch:hover {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
  box-shadow: none;
  transform: translateY(-1px);
}

/* 筛选与搜索 */
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.filter-bar {
  display: flex;
  gap: 8px;
  padding: 6px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  width: fit-content;
  flex-shrink: 0;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}

.filter-chip:hover {
  background: #f1f5f9;
  color: var(--text);
}

.filter-chip.active {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 2px 8px rgba(91, 106, 191, 0.3);
}

.filter-chip.active .chip-badge {
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
}

.chip-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 10px;
  background: #e2e8f0;
  color: var(--text-muted);
}

.page-search {
  width: min(320px, 100%);
  height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--card-bg);
  color: var(--text-muted);
  transition: all var(--transition);
}

.page-search:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(91, 106, 191, 0.1);
}

.page-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
}

.page-search input::-webkit-search-cancel-button {
  display: none;
}

.page-search button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.page-search button:hover {
  background: var(--primary-light);
  color: var(--primary);
}

/* 内容区 */
.content {
  min-height: 400px;
}

.launch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.loading-state {
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 13px;
}

.loading-state > :first-child {
  font-size: 20px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.empty-illustration {
  position: relative;
  width: 100px;
  height: 100px;
  margin-bottom: 24px;
}

.empty-circle {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: linear-gradient(135deg, #eef2ff, #e0e7ff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  color: var(--primary);
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.empty-particles {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.particle {
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  opacity: 0.3;
  animation: sparkle 2s ease-in-out infinite;
}

.p1 { top: 10%; left: -10%; animation-delay: 0s; }
.p2 { top: 0%; right: -5%; animation-delay: 0.5s; }
.p3 { bottom: 10%; left: 5%; animation-delay: 1s; }

@keyframes sparkle {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.5); }
}

.empty-state h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}

.empty-state p {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 24px;
}

.btn-guide {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 24px;
  border: 2px solid var(--primary);
  border-radius: var(--radius);
  background: transparent;
  color: var(--primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}

.btn-guide:hover {
  background: var(--primary);
  color: #fff;
}

@media (max-width: 760px) {
  .header-actions {
    width: 100%;
  }

  .btn-add,
  .btn-batch,
  .btn-open {
    flex: 1 1 auto;
    justify-content: center;
    padding: 0 12px;
  }

  .list-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-bar {
    width: 100%;
    overflow-x: auto;
  }

  .filter-chip {
    flex-shrink: 0;
  }

  .page-search {
    width: 100%;
  }
}
</style>
