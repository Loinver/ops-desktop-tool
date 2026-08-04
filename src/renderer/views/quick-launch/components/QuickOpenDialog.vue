<template>
  <Teleport to="body">
    <div v-if="modelValue" class="dialog-overlay" @click.self="close">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="quick-open-title">
        <header class="dialog-header">
          <div>
            <h3 id="quick-open-title">配置一键打开</h3>
            <p>选择需要同时在默认浏览器中打开的网站。</p>
          </div>
          <button type="button" class="icon-btn" title="关闭" @click="close">
            <t-icon name="close" />
          </button>
        </header>

        <div class="dialog-toolbar">
          <label class="search-box">
            <t-icon name="search" />
            <input v-model="query" type="search" placeholder="搜索网站名称或地址" />
          </label>
          <div class="selection-actions">
            <span>已选 {{ selectedIds.size }} / {{ websiteItems.length }}</span>
            <button type="button" @click="selectVisible">全选</button>
            <button type="button" @click="clearSelection">清空</button>
          </div>
        </div>

        <div class="dialog-body">
          <div v-if="websiteItems.length === 0" class="empty-list">
            <t-icon name="earth" />
            <p>还没有网站快捷方式</p>
            <span>请先添加网站，或从 JSON 文件导入配置。</span>
          </div>
          <div v-else-if="filteredItems.length === 0" class="empty-list compact">
            <t-icon name="search" />
            <p>没有匹配的网站</p>
          </div>
          <div v-else class="site-list">
            <label
              v-for="item in filteredItems"
              :key="item.id"
              class="site-option"
              :class="{ selected: selectedIds.has(String(item.id)) }"
            >
              <input
                type="checkbox"
                :checked="selectedIds.has(String(item.id))"
                @change="toggleItem(item.id)"
              />
              <span class="site-icon" :style="{ background: item.color || '#6366f1' }">
                <span v-if="item.icon">{{ item.icon }}</span>
                <t-icon v-else name="earth" />
              </span>
              <span class="site-content">
                <strong>{{ item.name }}</strong>
                <small :title="item.target">{{ item.target }}</small>
              </span>
              <span v-if="selectedIds.has(String(item.id))" class="selected-tag">一键打开</span>
            </label>
          </div>
        </div>

        <footer class="dialog-footer">
          <div class="footer-actions">
            <button type="button" class="btn-cancel" @click="close">取消</button>
            <button type="button" class="btn-confirm" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : `保存配置（${selectedIds.size}）` }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useQuickLaunchStore } from '../../../stores/quickLaunch'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'saved'])
const store = useQuickLaunchStore()
const query = ref('')
const selectedIds = ref(new Set())
const saving = ref(false)

const websiteItems = computed(() => store.websiteItems)
const filteredItems = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return websiteItems.value
  return websiteItems.value.filter((item) =>
    [item.name, item.target].some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(keyword)
    )
  )
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    query.value = ''
    selectedIds.value = new Set(store.quickOpenItems.map((item) => String(item.id)))
  }
)

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

function toggleItem(id) {
  const next = new Set(selectedIds.value)
  const key = String(id)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedIds.value = next
}

function selectVisible() {
  const next = new Set(selectedIds.value)
  filteredItems.value.forEach((item) => next.add(String(item.id)))
  selectedIds.value = next
}

function clearSelection() {
  selectedIds.value = new Set()
}

async function save() {
  saving.value = true
  try {
    const ok = await store.configureQuickOpen(selectedIds.value)
    if (!ok) {
      MessagePlugin.error({ content: '一键打开配置保存失败', placement: 'bottom-right' })
      return
    }
    emit('saved', selectedIds.value.size)
    emit('update:modelValue', false)
  } catch (error) {
    MessagePlugin.error({
      content: error instanceof Error ? error.message : '一键打开配置保存失败',
      placement: 'bottom-right'
    })
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
}

.dialog {
  width: min(720px, 100%);
  max-height: min(720px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  background: var(--card-bg);
  box-shadow: var(--shadow-xl);
}

.dialog-header,
.dialog-footer,
.dialog-toolbar {
  flex-shrink: 0;
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border-light);
}

.dialog-header h3 {
  margin: 0;
  color: var(--text);
  font-size: 18px;
  line-height: 1.4;
}

.dialog-header p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.icon-btn:hover {
  background: var(--primary-light);
  color: var(--primary);
}

.dialog-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--border-light);
}

.search-box {
  width: min(330px, 100%);
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text-muted);
}

.search-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(91, 106, 191, 0.1);
}

.search-box input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.selection-actions button {
  padding: 4px 7px;
  border: 0;
  background: transparent;
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
}

.dialog-body {
  min-height: 220px;
  overflow-y: auto;
  padding: 12px 22px 18px;
}

.site-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.site-option {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  background: var(--card-bg);
  cursor: pointer;
  transition: all var(--transition);
}

.site-option:hover {
  border-color: var(--primary);
  background: var(--primary-light);
}

.site-option.selected {
  border-color: rgba(91, 106, 191, 0.45);
  background: var(--primary-light);
}

.site-option input {
  width: var(--checkbox-size);
  height: var(--checkbox-size);
  flex-shrink: 0;
  margin: 0;
  accent-color: var(--primary);
}

.site-icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: #fff;
}

.site-content {
  min-width: 0;
  flex: 1;
}

.site-content strong,
.site-content small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-content strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.site-content small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
}

.selected-tag {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(91, 106, 191, 0.12);
  color: var(--primary);
  font-size: 10px;
}

.empty-list {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  text-align: center;
}

.empty-list.compact {
  min-height: 220px;
}

.empty-list > :first-child {
  font-size: 30px;
}

.empty-list p {
  margin: 12px 0 3px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
}

.empty-list span {
  font-size: 12px;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 22px;
  border-top: 1px solid var(--border-light);
}

.footer-actions {
  display: flex;
  gap: 10px;
}

.btn-cancel,
.btn-confirm {
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 14px;
  border-radius: var(--radius);
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition);
}

.btn-cancel {
  border: 1px solid var(--border);
  background: var(--card-bg);
  color: var(--text-secondary);
}

.btn-confirm {
  min-width: 126px;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
}

.btn-cancel:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.btn-confirm:hover:not(:disabled) {
  background: var(--primary-hover);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 720px) {
  .dialog-toolbar,
  .dialog-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .search-box {
    width: 100%;
  }

  .selection-actions,
  .footer-actions {
    justify-content: flex-end;
  }

  .site-list {
    grid-template-columns: 1fr;
  }
}
</style>
