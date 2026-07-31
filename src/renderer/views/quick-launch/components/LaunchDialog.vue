<template>
  <Teleport to="body">
  <div v-if="modelValue" class="dialog-overlay">
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="launch-dialog-title">
      <div class="dialog-header">
        <h3 id="launch-dialog-title">{{ editingItem ? '编辑快捷方式' : '添加快捷方式' }}</h3>
        <button type="button" class="close-btn" title="关闭" aria-label="关闭" @click="close">
          <t-icon name="close" />
        </button>
      </div>

      <div class="dialog-body">
        <!-- 名称 -->
        <div class="form-group">
          <label class="form-label">名称</label>
          <input
            v-model="form.name"
            type="text"
            class="form-input"
            placeholder="例如：VS Code、Google"
          />
        </div>

        <!-- 类型选择 -->
        <div class="form-group">
          <label class="form-label">类型</label>
          <div class="type-selector">
            <button type="button"
              v-for="t in typeOptions"
              :key="t.value"
              :class="['type-btn', { active: form.type === t.value }]"
              @click="form.type = t.value"
            >
              <t-icon :name="t.icon" />
              <span>{{ t.label }}</span>
            </button>
          </div>
        </div>

        <!-- 路径/网址 -->
        <div class="form-group">
          <label class="form-label">{{ targetLabel }}</label>
          <div class="input-with-btn">
            <input
              v-model="form.target"
              :type="form.type === 'url' ? 'url' : 'text'"
              class="form-input"
              :placeholder="targetPlaceholder"
            />
            <button type="button"
              v-if="form.type !== 'url'"
              class="browse-btn"
              @click="browseFile"
            >
              <t-icon name="folder-open" />
              浏览
            </button>
          </div>
        </div>

        <label v-if="form.type === 'url'" class="quick-open-option">
          <input v-model="form.quickOpen" type="checkbox" />
          <span>
            <strong>加入一键打开</strong>
            <small>在页面顶部点击“一键打开”时同时打开此网站</small>
          </span>
        </label>

        <!-- 图标 -->
        <div class="form-row">
          <div class="form-group flex-1">
            <label class="form-label">图标</label>
            <div class="icon-input-wrap">
              <div class="icon-preview" :style="{ background: form.color }">
                <span v-if="form.icon">{{ form.icon }}</span>
                <t-icon v-else :name="getDefaultIcon(form.type)" />
              </div>
              <input
                v-model="form.icon"
                type="text"
                class="form-input"
                maxlength="4"
                placeholder="emoji 或留空"
              />
            </div>
          </div>

          <div class="form-group flex-2">
            <label class="form-label">颜色</label>
            <div class="color-grid">
              <button type="button"
                v-for="color in colors"
                :key="color"
                :class="['color-dot', { active: form.color === color }]"
                :style="{ background: color }"
                @click="form.color = color"
              >
                <t-icon v-if="form.color === color" name="check" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button type="button" class="btn-cancel" @click="close">取消</button>
        <button type="button"
          class="btn-confirm"
          :disabled="saving || !form.name.trim() || !form.target.trim()"
          @click="save"
        >
          {{ saving ? '保存中…' : (editingItem ? '保存' : '添加') }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useQuickLaunchStore } from '../../../stores/quickLaunch'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  editingItem: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'saved'])

const store = useQuickLaunchStore()
const saving = ref(false)

const form = ref({
  name: '',
  type: 'app',
  target: '',
  icon: '',
  color: '#6366f1',
  quickOpen: false,
})

const colors = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6b7280',
]

const typeOptions = [
  { value: 'app', label: '应用', icon: 'app' },
  { value: 'url', label: '网址', icon: 'earth' },
  { value: 'folder', label: '文件夹', icon: 'folder' },
]

const targetLabel = computed(() => {
  const map = { url: '网址', folder: '文件夹路径', app: '应用路径' }
  return map[form.value.type] || '路径'
})

const targetPlaceholder = computed(() => {
  const map = {
    url: 'https://example.com',
    folder: '/Users/xxx/Documents',
    app: '/Applications/Visual Studio Code.app'
  }
  return map[form.value.type] || ''
})

function getDefaultIcon(type) {
  const map = { app: 'app', url: 'earth', folder: 'folder' }
  return map[type] || 'app'
}

watch(() => props.modelValue, (val) => {
  if (val && props.editingItem) {
    form.value = { ...props.editingItem }
  } else if (val) {
    resetForm()
  }
})

function resetForm() {
  form.value = {
    name: '',
    type: 'app',
    target: '',
    icon: '',
    color: '#6366f1',
    quickOpen: false,
  }
}

function close() {
  emit('update:modelValue', false)
}

async function save() {
  if (!form.value.name.trim() || !form.value.target.trim() || saving.value) return

  saving.value = true
  try {
    const payload = {
      ...form.value,
      name: form.value.name.trim(),
      target: form.value.target.trim(),
      quickOpen: form.value.type === 'url' && form.value.quickOpen === true,
    }
    const ok = props.editingItem
      ? await store.updateItem(props.editingItem.id, payload)
      : await store.addItem(payload)

    if (!ok) {
      MessagePlugin.error({ content: '快捷方式保存失败', placement: 'bottom-right' })
      return
    }

    close()
    emit('saved')
  } catch (error) {
    MessagePlugin.error({
      content: error instanceof Error ? error.message : '快捷方式保存失败',
      placement: 'bottom-right',
    })
  } finally {
    saving.value = false
  }
}

async function browseFile() {
  const path = await store.browseFile()
  if (path) {
    form.value.target = path
  }
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.dialog {
  width: 480px;
  max-height: 90vh;
  background: var(--card-bg);
  border-radius: var(--radius-xl);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  animation: slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-light);
}

.dialog-header h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  transition: all var(--transition);
}

.close-btn:hover {
  background: #f1f5f9;
  color: var(--text);
}

.dialog-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-height: calc(90vh - 140px);
  overflow-y: auto;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-input {
  height: 42px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 14px;
  color: var(--text);
  background: var(--card-bg);
  outline: none;
  transition: all var(--transition);
  width: 100%;
}

.form-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(91, 106, 191, 0.1);
}

.form-input::placeholder {
  color: var(--text-muted);
}

/* 类型选择 */
.type-selector {
  display: flex;
  gap: 8px;
}

.type-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 44px;
  border: 2px solid var(--border);
  border-radius: var(--radius);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}

.type-btn:hover {
  border-color: var(--text-muted);
  color: var(--text);
}

.type-btn.active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
}

/* 带按钮的输入框 */
.input-with-btn {
  display: flex;
  gap: 8px;
}

.input-with-btn .form-input {
  flex: 1;
}

.browse-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 16px;
  height: 42px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
  white-space: nowrap;
}

.browse-btn:hover {
  border-color: var(--text-muted);
  color: var(--text);
}

/* 图标输入 */
.quick-open-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: -2px 0 18px;
  padding: 12px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--primary-light);
  cursor: pointer;
}

.quick-open-option input {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  accent-color: var(--primary);
}

.quick-open-option span,
.quick-open-option strong,
.quick-open-option small {
  display: block;
}

.quick-open-option strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.quick-open-option small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 12px;
}

.form-row {
  display: flex;
  gap: 16px;
}

.flex-1 { flex: 1; }
.flex-2 { flex: 2; }

.icon-input-wrap {
  display: flex;
  gap: 10px;
  align-items: center;
}

.icon-preview {
  width: 42px;
  height: 42px;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #fff;
  flex-shrink: 0;
}

.icon-input-wrap .form-input {
  flex: 1;
}

/* 颜色选择 */
.color-grid {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.color-dot {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid transparent;
  cursor: pointer;
  transition: all var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
}

.color-dot:hover {
  transform: scale(1.1);
}

.color-dot.active {
  border-color: var(--text);
  transform: scale(1.1);
}

/* 底部按钮 */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-light);
}

.btn-cancel {
  height: 40px;
  padding: 0 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}

.btn-cancel:hover {
  border-color: var(--text-muted);
  color: var(--text);
}

.btn-confirm {
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--radius);
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
  box-shadow: 0 2px 8px rgba(91, 106, 191, 0.3);
}

.btn-confirm:hover:not(:disabled) {
  background: var(--primary-hover);
  box-shadow: 0 4px 12px rgba(91, 106, 191, 0.4);
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
