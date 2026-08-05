<template>
  <div class="page-header">
    <div class="page-heading header-left">
      <div class="page-eyebrow"><t-icon name="api" /> MODEL RELIABILITY</div>
      <h2 class="page-title">模型可靠性</h2>
      <p class="page-desc">读取 cc-switch 中转站配置，按范围持续验证模型可用性并沉淀巡检历史</p>
    </div>
    <div class="page-actions header-actions">
      <button
        type="button"
        class="btn-ghost"
        :class="{ 'scope-active': modelFilterConfigured }"
        :disabled="loading || running || preparing"
        :title="
          modelFilterConfigured ? `当前：${modelFilterSummary}` : '配置从 /models 接口加载哪些模型'
        "
        @click="$emit('open-model-filter')"
      >
        <t-icon name="filter" />
        <span>{{ modelFilterConfigured ? modelFilterSummary : '模型筛选' }}</span>
      </button>
      <button
        type="button"
        class="btn-ghost"
        :class="{ 'scope-active': scopeConfigured }"
        :disabled="loading || running || preparing"
        :title="
          scopeConfigured
            ? `列表与一键测试仅覆盖已选中的 ${bulkCount} 个中转配置`
            : '配置列表展示与一键测试要覆盖的中转'
        "
        @click="$emit('open-scope')"
      >
        <t-icon name="setting" />
        <span v-if="scopeConfigured">测试范围 {{ bulkCount }}/{{ testableCount }}</span>
        <span v-else>测试范围</span>
      </button>
      <button
        v-if="running"
        type="button"
        class="btn-ghost danger"
        :disabled="stopping"
        @click="$emit('cancel')"
      >
        <t-icon :name="stopping ? 'loading' : 'close-circle'" :class="{ spin: stopping }" />
        <span>{{ stopping ? '停止中…' : '停止测试' }}</span>
      </button>
      <button
        v-else
        type="button"
        class="btn-ghost primary"
        :disabled="loading || preparing || bulkCount === 0"
        @click="$emit('test-all')"
      >
        <t-icon name="play-circle" />
        <span>{{ scopeConfigured ? '开始巡检所选' : '开始全部巡检' }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  scopeConfigured: { type: Boolean, default: false },
  modelFilterConfigured: { type: Boolean, default: false },
  modelFilterSummary: { type: String, default: '模型筛选' },
  bulkCount: { type: Number, default: 0 },
  testableCount: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  running: { type: Boolean, default: false },
  preparing: { type: Boolean, default: false },
  stopping: { type: Boolean, default: false }
})

defineEmits(['open-scope', 'open-model-filter', 'cancel', 'test-all'])
</script>
