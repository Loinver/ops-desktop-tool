<template>
  <Teleport to="body">
    <div v-if="open" class="model-test-page modal-mask">
      <div
        class="settings-dialog model-list-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-list-settings-title"
      >
        <header class="dialog-header">
          <div>
            <h3 id="model-list-settings-title">模型筛选</h3>
            <p>控制从 cc-switch 配置和上游 <code>/models</code> 接口纳入哪些模型。</p>
          </div>
          <button class="icon-button" type="button" title="关闭" @click="$emit('close')">
            <t-icon name="close" />
          </button>
        </header>

        <div class="model-filter-content">
          <fieldset class="model-filter-mode">
            <legend>获取范围</legend>
            <label class="model-filter-mode-option" :class="{ active: mode === 'all' }">
              <input v-model="mode" type="radio" value="all" />
              <span>
                <strong>获取全部兼容模型</strong>
                <small>保留当前端点协议可调用的全部模型，再应用下方排除规则。</small>
              </span>
            </label>
            <label class="model-filter-mode-option" :class="{ active: mode === 'include' }">
              <input v-model="mode" type="radio" value="include" />
              <span>
                <strong>只获取匹配规则的模型</strong>
                <small>仅保留下方“包含规则”匹配的模型，再应用排除规则。</small>
              </span>
            </label>
          </fieldset>

          <label class="model-filter-field">
            <span>包含规则</span>
            <textarea
              v-model="includeRulesText"
              :disabled="mode !== 'include'"
              rows="5"
              placeholder="每行一个，例如：&#10;gpt-*&#10;claude-opus-*&#10;vendor/model-name"
              spellcheck="false"
            />
            <small
              >支持 <code>*</code> 通配符；匹配完整模型 ID
              或最后一段名称。仅在“只获取匹配规则的模型”时生效。</small
            >
          </label>

          <label class="model-filter-field">
            <span>排除规则（可选）</span>
            <textarea
              v-model="excludeRulesText"
              rows="4"
              placeholder="每行一个，例如：&#10;*-deprecated&#10;*embedding*"
              spellcheck="false"
            />
            <small>排除规则始终优先于包含规则，可用于跳过不需要测试的模型。</small>
          </label>
        </div>

        <div class="dialog-actions">
          <span class="model-filter-summary">{{ summaryText }}</span>
          <div class="dialog-actions-right">
            <button class="btn-ghost" type="button" :disabled="saving" @click="$emit('close')">
              取消
            </button>
            <button class="btn-ghost primary" type="button" :disabled="saving" @click="save">
              {{ saving ? '保存中…' : '保存并重新加载' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  settings: {
    type: Object,
    default: () => ({ mode: 'all', includeRules: [], excludeRules: [] })
  },
  saving: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'save'])
const mode = ref('all')
const includeRulesText = ref('')
const excludeRulesText = ref('')

function rulesToText(value) {
  return Array.isArray(value) ? value.join('\n') : ''
}

function textToRules(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function restoreDraft() {
  mode.value = props.settings?.mode === 'include' ? 'include' : 'all'
  includeRulesText.value = rulesToText(props.settings?.includeRules)
  excludeRulesText.value = rulesToText(props.settings?.excludeRules)
}

watch(
  () => props.open,
  (open) => {
    if (open) restoreDraft()
  }
)

const summaryText = computed(() => {
  const included = textToRules(includeRulesText.value).length
  const excluded = textToRules(excludeRulesText.value).length
  if (mode.value === 'include') {
    return included > 0
      ? `仅获取 ${included} 条包含规则匹配的模型${excluded ? `，并排除 ${excluded} 条规则` : ''}`
      : '未填写包含规则，保存后不会纳入任何模型'
  }
  return excluded ? `获取全部兼容模型，并排除 ${excluded} 条规则` : '获取全部兼容模型'
})

function save() {
  emit('save', {
    mode: mode.value,
    includeRules: textToRules(includeRulesText.value),
    excludeRules: textToRules(excludeRulesText.value)
  })
}
</script>
