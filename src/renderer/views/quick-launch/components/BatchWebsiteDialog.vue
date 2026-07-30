<template>
  <div v-if="modelValue" class="dialog-overlay">
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="batch-website-title">
      <header class="dialog-header">
        <div>
          <h3 id="batch-website-title">粘贴网址 JSON</h3>
          <p>支持 JSON 数组或包含 <code>items</code> 的对象；仅添加网址快捷方式。</p>
        </div>
        <button type="button" class="close-btn" title="关闭" @click="close">
          <t-icon name="close" />
        </button>
      </header>

      <div class="dialog-body">
        <label class="json-label" for="website-json-input">JSON 内容</label>
        <textarea
          id="website-json-input"
          v-model="rawJson"
          class="json-input"
          spellcheck="false"
          placeholder='[
  {
    "name": "运维平台",
    "target": "https://ops.example.com",
    "icon": "🚀",
    "color": "#6366f1"
  },
  {
    "name": "本地服务",
    "target": "localhost:3000"
  }
]'
        />
        <p class="json-hint">网址可省略协议；本机地址或带端口地址会自动使用 HTTP。单次最多 200 条。</p>
      </div>

      <footer class="dialog-footer">
        <button type="button" class="btn-cancel" @click="close">取消</button>
        <button type="button" class="btn-confirm" :disabled="!rawJson.trim()" @click="parseAndAdd">
          解析并添加
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useQuickLaunchStore } from '../../../stores/quickLaunch'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'parsed'])
const store = useQuickLaunchStore()
const rawJson = ref('')

watch(() => props.modelValue, (open) => {
  if (open) rawJson.value = ''
})

function close() {
  emit('update:modelValue', false)
}

async function parseAndAdd() {
  const result = await store.parseWebsiteItems(rawJson.value)
  if (!result?.ok) {
    MessagePlugin.error({ content: result?.error || '解析网址 JSON 失败', placement: 'bottom-right' })
    return
  }

  emit('parsed', result)
  close()
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
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(4px);
}

.dialog {
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-xl);
  background: var(--card-bg);
  box-shadow: var(--shadow-xl);
}

.dialog-header,
.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
  padding: 18px 22px;
}

.dialog-header {
  align-items: flex-start;
  border-bottom: 1px solid var(--border-light);
}

.dialog-header h3 {
  margin: 0;
  color: var(--text);
  font-size: 18px;
}

.dialog-header p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.dialog-header code {
  font-family: var(--font-mono);
  color: var(--primary);
}

.close-btn,
.btn-cancel,
.btn-confirm {
  border: 0;
  border-radius: var(--radius);
  cursor: pointer;
  font-size: 14px;
  transition: all var(--transition);
}

.close-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
}

.close-btn:hover {
  background: var(--primary-light);
  color: var(--primary);
}

.dialog-body {
  min-height: 0;
  padding: 20px 22px;
}

.json-label {
  display: block;
  margin-bottom: 8px;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}

.json-input {
  width: 100%;
  min-height: 320px;
  box-sizing: border-box;
  resize: vertical;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  outline: none;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
}

.json-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(91, 106, 191, 0.1);
}

.json-hint {
  margin: 8px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.dialog-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--border-light);
}

.btn-cancel,
.btn-confirm {
  min-width: 84px;
  height: 36px;
  padding: 0 14px;
}

.btn-cancel {
  border: 1px solid var(--border);
  background: var(--card-bg);
  color: var(--text-secondary);
}

.btn-confirm {
  background: var(--primary);
  color: #fff;
}

.btn-confirm:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.btn-confirm:not(:disabled):hover {
  background: var(--primary-hover);
}
</style>
