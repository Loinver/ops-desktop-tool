<template>
  <div class="page">
    <!-- 页头 -->
    <header class="page-header">
      <div class="page-heading header-left">
        <h2 class="page-title">剪贴板历史</h2>
        <p class="page-desc">记录复制过的内容，点击即可快速复制</p>
      </div>
      <div class="page-actions header-actions">
        <div class="search-box">
          <t-icon name="search" class="search-icon" />
          <input
            v-model="search"
            type="text"
            placeholder="搜索剪贴板内容..."
            class="search-input"
          />
          <button v-if="search" type="button" class="search-clear" aria-label="清除搜索" @click="search = ''">
            <t-icon name="close-circle-filled" />
          </button>
        </div>
        <button type="button" class="btn-danger" :disabled="!store.history.length" @click="clearAll">
          <t-icon name="delete" />
          <span>清空</span>
        </button>
      </div>
    </header>

    <main class="page-content">
    <!-- 统计卡片 -->
    <section class="stats-grid" aria-label="剪贴板统计">
      <div class="stat-card interactive-surface">
        <div class="stat-icon-wrap stat-icon-total">
          <t-icon name="file-copy" />
        </div>
        <div class="stat-body">
          <div class="stat-number">{{ store.history.length }}</div>
          <div class="stat-text">总记录</div>
        </div>
      </div>
      <div class="stat-card interactive-surface">
        <div class="stat-icon-wrap stat-icon-text">
          <t-icon name="file-text" />
        </div>
        <div class="stat-body">
          <div class="stat-number">{{ store.textCount }}</div>
          <div class="stat-text">文本</div>
        </div>
      </div>
      <div class="stat-card interactive-surface">
        <div class="stat-icon-wrap stat-icon-image">
          <t-icon name="image" />
        </div>
        <div class="stat-body">
          <div class="stat-number">{{ store.imageCount }}</div>
          <div class="stat-text">图片</div>
        </div>
      </div>
    </section>

    <!-- 筛选栏 -->
    <div class="filter-bar" role="tablist" aria-label="剪贴板类型筛选">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="['filter-chip', { active: currentTab === tab.id }]"
        type="button"
        role="tab"
        :aria-selected="currentTab === tab.id"
        @click="currentTab = tab.id"
      >
        <t-icon :name="tab.icon" />
        <span>{{ tab.name }}</span>
        <span v-if="tab.count > 0" class="chip-badge">{{ tab.count }}</span>
      </button>
    </div>

    <!-- 历史列表 -->
    <section class="content surface-panel page-section" aria-live="polite">
      <div v-if="filteredHistory.length === 0" class="empty-state">
        <div class="empty-icon">
          <t-icon name="file-copy" />
        </div>
        <h3>{{ search ? '未找到匹配内容' : '暂无剪贴板记录' }}</h3>
        <p>{{ search ? '尝试其他关键词' : '复制内容后会自动记录到这里' }}</p>
      </div>

      <div v-else class="history-list">
        <div
          v-for="item in filteredHistory"
          :key="item.id"
          class="history-item"
          tabindex="0"
          @click="handleCopy(item)"
          @keydown.enter="handleCopy(item)"
          @keydown.space.prevent="handleCopy(item)"
        >
          <div class="item-icon">
            <t-icon :name="item.type === 'image' ? 'image' : 'file-text'" />
          </div>
          <div class="item-body">
            <div class="item-content">
              <img
                v-if="item.type === 'image'"
                :src="item.content"
                alt="剪贴板图片预览"
                class="image-preview"
              />
              <span v-else class="text-preview">{{ item.content }}</span>
            </div>
            <div class="item-meta">
              <span class="meta-type">{{ item.type === 'image' ? '图片' : '文本' }}</span>
              <span class="meta-separator">·</span>
              <span class="meta-time">{{ formatTime(item.timestamp) }}</span>
              <span v-if="item.type !== 'image'" class="meta-separator">·</span>
              <span v-if="item.type !== 'image'" class="meta-length">{{ item.content.length }} 字符</span>
            </div>
          </div>
          <div class="item-actions">
            <button type="button" class="action-btn" aria-label="复制" title="复制" @click.stop="handleCopy(item)">
              <t-icon name="copy" />
            </button>
            <button type="button" class="action-btn danger" aria-label="删除" title="删除" @click.stop="handleDelete(item)">
              <t-icon name="close" />
            </button>
          </div>
        </div>
      </div>
    </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useClipboardStore } from '../../stores/clipboard'
import { useConfirm } from '../../composables/useConfirm'

const store = useClipboardStore()
const { confirm } = useConfirm()

const search = ref('')
const currentTab = ref('all')
let clipboardTimer = null

const tabs = computed(() => [
  { id: 'all', name: '全部', icon: 'folder-open', count: store.history.length },
  { id: 'text', name: '文本', icon: 'file-text', count: store.textCount },
  { id: 'image', name: '图片', icon: 'image', count: store.imageCount },
])

const filteredHistory = computed(() => {
  let list = store.history

  // 按类型筛选
  if (currentTab.value === 'text') {
    list = list.filter(item => item.type !== 'image')
  } else if (currentTab.value === 'image') {
    list = list.filter(item => item.type === 'image')
  }

  // 按关键词搜索
  if (search.value) {
    const keyword = search.value.toLowerCase()
    list = list.filter(item => {
      if (item.type === 'image') return true
      return item.content.toLowerCase().includes(keyword)
    })
  }

  return list
})

async function handleCopy(item) {
  await store.copyToClipboard(item)
  MessagePlugin.success({ content: '已复制到剪贴板', placement: 'bottom-right' })
}

function handleDelete(item) {
  store.deleteItem(item.id)
}

async function clearAll() {
  const confirmed = await confirm({
    title: '清空历史',
    body: '确定清空所有剪贴板历史？此操作不可撤销。'
  })
  if (!confirmed) return

  store.clearAll()
  MessagePlugin.success({ content: '已清空', placement: 'bottom-right' })
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

onMounted(() => {
  store.fetchHistory()
  clipboardTimer = setInterval(() => store.checkClipboard(), 1000)
})

onUnmounted(() => {
  clearInterval(clipboardTimer)
})
</script>

<style scoped>
/* 搜索框 */
.search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  color: var(--text-muted);
  font-size: 16px;
  pointer-events: none;
}

.search-input {
  width: 240px;
  height: var(--header-control-height);
  padding: 0 36px 0 38px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: var(--header-control-font-size);
  color: var(--text);
  background: var(--card-bg);
  outline: none;
  transition: all var(--transition);
}

.search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(91, 106, 191, 0.1);
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-clear {
  position: absolute;
  right: 10px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  transition: color var(--transition), background var(--transition);
}

.search-clear:hover {
  background: var(--primary-light);
  color: var(--primary);
}

/* 危险按钮 */
.btn-danger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: var(--header-control-height);
  padding: 0 18px;
  border: none;
  border-radius: var(--radius);
  background: var(--danger);
  color: #fff;
  font-size: var(--header-control-font-size);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
}

.btn-danger:hover {
  background: #dc2626;
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
  transform: translateY(-1px);
}

.btn-danger:active {
  transform: translateY(0);
}

.btn-danger:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-xs);
  transition: all var(--transition-slow);
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: transparent;
}

.stat-icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  flex-shrink: 0;
}

.stat-icon-total {
  background: linear-gradient(135deg, #eef2ff, #e0e7ff);
  color: #6366f1;
}

.stat-icon-text {
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  color: #10b981;
}

.stat-icon-image {
  background: linear-gradient(135deg, #fffbeb, #fef3c7);
  color: #f59e0b;
}

.stat-body {
  display: flex;
  flex-direction: column;
}

.stat-number {
  font-size: 32px;
  font-weight: 700;
  color: var(--text);
  line-height: 1;
  font-family: var(--font-mono);
  letter-spacing: -1px;
}

.stat-text {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
  font-weight: 500;
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  gap: 8px;
  padding: 6px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  width: fit-content;
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

/* 内容区 */
.content {
  min-height: 300px;
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

.empty-icon {
  width: 80px;
  height: 80px;
  border-radius: 24px;
  background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}

.empty-state p {
  font-size: 14px;
  color: var(--text-muted);
}

/* 历史列表 */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: all var(--transition);
}

.history-item:hover {
  border-color: var(--primary);
  box-shadow: 0 2px 12px rgba(91, 106, 191, 0.1);
  transform: translateY(-1px);
}

.item-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #eef2ff, #e0e7ff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #6366f1;
  flex-shrink: 0;
}

.item-body {
  flex: 1;
  min-width: 0;
}

.item-content {
  margin-bottom: 6px;
}

.text-preview {
  display: block;
  font-size: 14px;
  color: var(--text);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-preview {
  display: block;
  width: 60px;
  height: 45px;
  border-radius: 6px;
  object-fit: cover;
  overflow: hidden;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.meta-separator {
  color: var(--border);
}

.item-actions {
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity var(--transition);
}

.history-item:hover .item-actions,
.history-item:focus-within .item-actions {
  opacity: 1;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  cursor: pointer;
  transition: all var(--transition);
}

.action-btn:hover {
  background: #f8fafc;
  color: var(--text-secondary);
  border-color: var(--text-muted);
}

.action-btn.danger:hover {
  background: var(--danger-light);
  color: var(--danger);
  border-color: var(--danger);
}


@media (max-width: 760px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }

  .filter-bar {
    width: 100%;
    overflow-x: auto;
  }

  .filter-chip {
    flex: 0 0 auto;
  }

  .search-box,
  .search-input {
    width: 100%;
  }

  .history-item {
    align-items: flex-start;
    padding: 14px;
  }

  .item-actions {
    opacity: 1;
  }
}
</style>
