<template>
  <div class="toolbar">
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
        <div class="result-filter-group" title="按探测结果筛选">
          <button
            type="button"
            class="result-filter-chip ok"
            :class="{ active: resultFilter === 'ok' }"
            @click="$emit('toggle-result-filter', 'ok')"
          >
            只看可用{{ okCount ? ` ${okCount}` : "" }}
          </button>
          <button
            type="button"
            class="result-filter-chip fail"
            :class="{ active: resultFilter === 'failed' }"
            @click="$emit('toggle-result-filter', 'failed')"
          >
            只看失败{{ failedCount ? ` ${failedCount}` : "" }}
          </button>
        </div>
        <button
          v-if="hasActiveFilters"
          type="button"
          class="btn-ghost small"
          title="清除搜索与筛选"
          @click="$emit('clear-filters')"
        >
          清除筛选
        </button>
        <button
          v-if="testedCount"
          type="button"
          class="btn-ghost small"
          :disabled="loading || running || preparing"
          title="清除本地测试结果缓存（不影响范围与配置）"
          @click="$emit('clear-results')"
        >
          清除结果
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
  appFilter: { type: String, default: "all" },
  familyFilter: { type: String, default: "all" },
  resultFilter: { type: String, default: "all" },
  searchQuery: { type: String, default: "" },
  hasActiveFilters: { type: Boolean, default: false },
  failedCount: { type: Number, default: 0 },
  okCount: { type: Number, default: 0 },
  testedCount: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  running: { type: Boolean, default: false },
  preparing: { type: Boolean, default: false },
  visibleCount: { type: Number, default: 0 },
});

defineEmits([
  "update:appFilter",
  "update:familyFilter",
  "update:searchQuery",
  "toggle-result-filter",
  "expand-all",
  "collapse-all",
  "clear-filters",
  "clear-results",
]);
</script>
