<template>
  <div class="page">
    <ModelTestHeader
      :summary="summary"
      :result-filter="resultFilter"
      :ok-summary-title="okSummaryTitle"
      :failed-breakdown-title="failedBreakdownTitle"
      :scope-configured="scopeConfigured"
      :model-filter-configured="modelListSettingsConfigured"
      :model-filter-summary="modelListSettingsSummary"
      :bulk-count="bulkTestProviders.length"
      :testable-count="testableProviders.length"
      :failed-task-count="failedTaskCount"
      :loading="loading"
      :running="running"
      :preparing="preparing"
      :stopping="stopping"
      @toggle-result-filter="toggleResultFilter"
      @open-scope="openScopeSettings"
      @open-model-filter="openModelListSettings"
      @reload="reload"
      @copy-available="copyAvailableSummary"
      @test-failed="testFailed"
      @cancel="cancel"
      @test-all="testAll"
    />

    <div class="monitor-banner">
      <div><strong>模型监控</strong><span>当前测试范围可直接保存为后台定时巡检目标，历史和趋势在运维仪表盘查看。</span></div>
      <button class="btn-ghost primary" :disabled="loading || running || preparing" @click="saveCurrentMonitorTargets">启用定时巡检</button>
    </div>

    <div class="control-stack">
      <ModelTestProgress
        :error-message="errorMessage"
        :preparing="preparing"
        :running="running"
        :stopping="stopping"
        :progress="progress"
        :progress-percent="progressPercent"
        :current-label="progressCurrentLabel"
      />

      <ModelTestToolbar
        v-model:app-filter="appFilter"
        v-model:family-filter="familyFilter"
        v-model:search-query="searchQuery"
        :result-filter="resultFilter"
        :app-tabs="appTabs"
        :family-tabs="familyTabs"
        :has-active-filters="hasActiveFilters"
        :failed-count="summary.failed"
        :ok-count="summary.ok"
        :tested-count="summary.total"
        :loading="loading"
        :running="running"
        :preparing="preparing"
        :visible-count="visibleProviders.length"
        @toggle-result-filter="toggleResultFilter"
        @expand-all="expandAllVisible"
        @collapse-all="collapseAllProviders"
        @clear-filters="clearFilters"
        @clear-results="clearCachedResults"
      />
    </div>

    <div class="page-body">
      <div class="provider-list">
        <div v-if="loading" class="placeholder empty-state">
          <t-icon name="loading" class="empty-icon spin" />
          <h3>正在读取 cc-switch 配置…</h3>
          <p>随后会按测试范围拉取模型列表</p>
        </div>
        <div v-else-if="visibleProviders.length === 0" class="placeholder empty-state">
          <t-icon :name="emptyIcon" class="empty-icon" />
          <h3>{{ emptyState.title }}</h3>
          <p v-if="emptyState.desc">{{ emptyState.desc }}</p>
          <button
            v-if="emptyState.action === 'clear-filters'"
            type="button"
            class="btn-ghost"
            @click="clearFilters"
          >
            {{ emptyState.actionLabel }}
          </button>
          <button
            v-else-if="emptyState.action === 'open-scope'"
            type="button"
            class="btn-ghost primary"
            @click="openScopeSettings"
          >
            {{ emptyState.actionLabel }}
          </button>
          <button
            v-else-if="emptyState.action === 'reload'"
            type="button"
            class="btn-ghost"
            @click="reload"
          >
            {{ emptyState.actionLabel }}
          </button>
        </div>
        <ProviderCard
          v-for="provider in visibleProviders"
          :key="provider.key"
          :provider="provider"
          :expanded="isExpanded(provider.key)"
          :is-nav-target="activeNavKey === provider.key"
          :running="running"
          :preparing="preparing"
          @toggle="toggleProviderGroup(provider)"
          @fetch-models="fetchProviderGroupModels(provider)"
          @test="testProviderGroup(provider)"
          @fetch-entry-models="fetchProviderModels"
          @test-entry="testProvider"
          @copy-provider-value="copyProviderValue"
          @copy-model="copyModel"
          @test-one="testOne"
        />
      </div>

      <AvailableNav
        :groups="availableNavGroups"
        :active-key="activeNavKey"
        @select="scrollToProvider"
      />
    </div>

    <ModelListSettingsDialog
      :open="showModelListSettings"
      :settings="modelListSettings"
      :saving="savingModelListSettings"
      @close="closeModelListSettings"
      @save="saveModelListSettings"
    />

    <ScopeSettingsDialog
      :open="showScopeSettings"
      :options="scopeOptions"
      :selected-group-count="scopeDraftSelectedGroupCount"
      :draft-size="scopeDraftKeys.size"
      :scope-configured="scopeConfigured"
      :is-checked="isScopeDraftChecked"
      :is-partial="isScopeDraftPartial"
      @close="closeScopeSettings"
      @select-all="selectAllScopeDraft"
      @clear="clearScopeDraft"
      @toggle="toggleScopeDraftOption"
      @reset="resetScopeSettings"
      @save="saveScopeSettings"
    />
  </div>
</template>

<script setup>
import { computed } from "vue";
import { useModelTestPage } from "./composables/useModelTestPage.js";
import ModelTestHeader from "./components/ModelTestHeader.vue";
import ModelTestProgress from "./components/ModelTestProgress.vue";
import ModelTestToolbar from "./components/ModelTestToolbar.vue";
import ProviderCard from "./components/ProviderCard.vue";
import AvailableNav from "./components/AvailableNav.vue";
import ScopeSettingsDialog from "./components/ScopeSettingsDialog.vue";
import ModelListSettingsDialog from "./components/ModelListSettingsDialog.vue";
import "./model-test.css";

defineOptions({ name: "ModelTest" });

const {
  loading,
  running,
  stopping,
  preparing,
  errorMessage,
  appFilter,
  familyFilter,
  resultFilter,
  searchQuery,
  activeNavKey,
  progress,
  showScopeSettings,
  scopeDraftKeys,
  showModelListSettings,
  modelListSettings,
  savingModelListSettings,
  scopeConfigured,
  modelListSettingsConfigured,
  modelListSettingsSummary,
  testableProviders,
  bulkTestProviders,
  scopeOptions,
  scopeDraftSelectedGroupCount,
  appTabs,
  familyTabs,
  visibleProviders,
  emptyState,
  hasActiveFilters,
  failedTaskCount,
  availableNavGroups,
  summary,
  failedBreakdownTitle,
  okSummaryTitle,
  progressPercent,
  progressCurrentLabel,
  isExpanded,
  isScopeDraftChecked,
  isScopeDraftPartial,
  toggleScopeDraftOption,
  selectAllScopeDraft,
  clearScopeDraft,
  openModelListSettings,
  closeModelListSettings,
  saveModelListSettings,
  openScopeSettings,
  closeScopeSettings,
  saveScopeSettings,
  resetScopeSettings,
  scrollToProvider,
  copyModel,
  copyProviderValue,
  fetchProviderModels,
  fetchProviderGroupModels,
  toggleProviderGroup,
  expandAllVisible,
  collapseAllProviders,
  clearFilters,
  toggleResultFilter,
  copyAvailableSummary,
  clearCachedResults,
  reload,
  testAll,
  testProviderGroup,
  testProvider,
  testOne,
  testFailed,
  saveCurrentMonitorTargets,
  cancel,
} = useModelTestPage();

const emptyIcon = computed(() => {
  if (resultFilter.value === "failed") return "check-circle";
  if (resultFilter.value === "ok") return "info-circle";
  if (resultFilter.value !== "all" || searchQuery.value.trim() || hasActiveFilters.value) {
    return "search";
  }
  if (scopeConfigured.value) return "setting";
  return "info-circle";
});
</script>
