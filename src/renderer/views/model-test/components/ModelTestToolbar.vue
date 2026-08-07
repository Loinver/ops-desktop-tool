<template>
  <div class="toolbar">
    <div v-if="summary.total || summary.idle || summary.testing" class="toolbar-overview">
      <div class="summary" aria-label="巡检结果概览">
        <button
          type="button"
          class="chip ok"
          :class="{ active: resultFilter === 'ok' }"
          @click="$emit('toggle-result-filter', 'ok')"
        >
          可用 {{ summary.ok }}
        </button>
        <button
          type="button"
          class="chip fail"
          :class="{ active: resultFilter === 'failed' }"
          @click="$emit('toggle-result-filter', 'failed')"
        >
          失败 {{ summary.failed }}
        </button>
        <button
          v-if="summary.gateway"
          type="button"
          class="chip gateway"
          :class="{ active: resultFilter === 'gateway' }"
          @click="$emit('toggle-result-filter', 'gateway')"
        >
          无法验证 {{ summary.gateway }}
        </button>
        <button
          v-if="summary.idle"
          type="button"
          class="chip idle"
          :class="{ active: resultFilter === 'idle' }"
          @click="$emit('toggle-result-filter', 'idle')"
        >
          未测 {{ summary.idle }}
        </button>
        <div
          class="coverage-progress"
          :aria-label="`测试覆盖率：已测 ${summary.total} / ${coverageTotal(summary)}`"
        >
          <div class="coverage-progress-label">
            <span>已测 {{ summary.total }} / {{ coverageTotal(summary) }}</span>
            <strong>{{ coveragePercent(summary) }}%</strong>
          </div>
          <div
            class="coverage-track"
            role="progressbar"
            aria-label="测试覆盖率"
            :aria-valuenow="summary.total"
            :aria-valuemin="0"
            :aria-valuemax="coverageTotal(summary)"
          >
            <span class="coverage-fill" :style="{ width: `${coveragePercent(summary)}%` }"></span>
          </div>
        </div>
      </div>
      <div class="toolbar-utilities">
        <button
          type="button"
          class="btn-ghost small"
          :disabled="loading || running || preparing"
          @click="$emit('reload')"
        >
          <t-icon name="refresh" />重新加载
        </button>
        <button
          v-if="summary.ok"
          type="button"
          class="btn-ghost small"
          :disabled="loading || running || preparing"
          @click="$emit('copy-available')"
        >
          <t-icon name="file-copy" />复制可用
        </button>
        <button
          v-if="failedTaskCount && !running"
          type="button"
          class="btn-ghost small"
          :disabled="loading || preparing"
          @click="$emit('test-failed')"
        >
          <t-icon name="refresh" />重测失败 ({{ failedTaskCount }})
        </button>
        <button
          v-if="testedCount"
          type="button"
          class="btn-ghost small"
          :disabled="loading || running || preparing"
          @click="$emit('clear-results')"
        >
          清除结果
        </button>
      </div>
    </div>
    <div class="filter-line">
      <div class="filter-group filter-group-main">
        <span class="filter-label">应用</span>
        <div class="filters filters-scroll">
          <button
            v-for="tab in appTabs"
            :key="tab.value"
            type="button"
            :class="['filter-chip', { active: appFilter === tab.value }]"
            @click="$emit('update:appFilter', tab.value)"
          >
            {{ tab.label }}
            <em>{{ tab.count }}</em>
          </button>
        </div>
      </div>
      <div class="toolbar-right">
        <label class="search-box">
          <t-icon name="search" />
          <input
            data-model-test-search
            :value="searchQuery"
            type="search"
            placeholder="搜索中转 / 模型"
            spellcheck="false"
            aria-label="搜索中转或模型，快捷键 /"
            @input="$emit('update:searchQuery', $event.target.value)"
          />
          <kbd v-if="!searchQuery" class="search-kbd" title="按 / 聚焦搜索">/</kbd>
          <button
            v-if="searchQuery"
            type="button"
            class="search-clear"
            title="清除搜索"
            @click="$emit('update:searchQuery', '')"
          >
            <t-icon name="close" />
          </button>
        </label>
        <button
          type="button"
          class="btn-ghost small"
          :disabled="loading || visibleCount === 0"
          title="展开当前列表中的全部中转"
          @click="$emit('expand-all')"
        >
          全部展开
        </button>
        <button
          type="button"
          class="btn-ghost small"
          :disabled="loading"
          title="收起全部中转卡片"
          @click="$emit('collapse-all')"
        >
          全部收起
        </button>
        <button
          v-if="hasActiveFilters"
          type="button"
          class="btn-ghost small"
          title="清除搜索与筛选"
          @click="$emit('clear-filters')"
        >
          清除筛选
        </button>
      </div>
    </div>
    <div v-if="familyTabs.length > 2" class="filter-line">
      <div class="filter-group filter-group-main">
        <span class="filter-label">端点</span>
        <div class="filters filters-scroll">
          <button
            v-for="tab in familyTabs"
            :key="tab.value"
            type="button"
            :class="['filter-chip', { active: familyFilter === tab.value }]"
            @click="$emit('update:familyFilter', tab.value)"
          >
            {{ tab.label }}
            <em>{{ tab.count }}</em>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  appTabs: { type: Array, default: () => [] },
  familyTabs: { type: Array, default: () => [] },
  appFilter: { type: String, default: 'all' },
  familyFilter: { type: String, default: 'all' },
  resultFilter: { type: String, default: 'all' },
  summary: { type: Object, required: true },
  failedTaskCount: { type: Number, default: 0 },
  searchQuery: { type: String, default: '' },
  hasActiveFilters: { type: Boolean, default: false },
  testedCount: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  running: { type: Boolean, default: false },
  preparing: { type: Boolean, default: false },
  visibleCount: { type: Number, default: 0 }
})

defineEmits([
  'update:appFilter',
  'update:familyFilter',
  'update:searchQuery',
  'toggle-result-filter',
  'reload',
  'copy-available',
  'test-failed',
  'expand-all',
  'collapse-all',
  'clear-filters',
  'clear-results'
])

function coverageTotal(summary) {
  return (
    (Number(summary?.total) || 0) + (Number(summary?.idle) || 0) + (Number(summary?.testing) || 0)
  )
}

function coveragePercent(summary) {
  const testedCount = Number(summary?.total) || 0
  const totalCount = coverageTotal(summary)
  return totalCount ? Math.round((testedCount / totalCount) * 100) : 0
}
</script>
