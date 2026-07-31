<template>
  <div class="page-header">
    <div class="page-heading header-left">
      <div class="page-eyebrow"><t-icon name="api" /> MODEL TEST</div>
      <h2 class="page-title">模型测试</h2>
      <p class="page-desc">
        读取 cc-switch 中转站配置，按模型筛选规则加载并发送极短真实请求验证可用性
      </p>
    </div>
    <div class="page-actions header-actions">
      <div v-if="summary.total || summary.idle" class="summary">
        <button
          type="button"
          class="chip ok"
          :class="{ active: resultFilter === 'ok' }"
          :title="okSummaryTitle"
          @click="$emit('toggle-result-filter', 'ok')"
        >
          可用 {{ summary.ok }}
          <em v-if="summary.ok && summary.bestMs" class="chip-sub">
            · {{ formatDuration(summary.bestMs) }}
          </em>
        </button>
        <button
          type="button"
          class="chip fail"
          :class="{ active: resultFilter === 'failed' }"
          :title="failedBreakdownTitle"
          @click="$emit('toggle-result-filter', 'failed')"
        >
          失败 {{ summary.failed }}
        </button>
        <button
          v-if="summary.gateway"
          type="button"
          class="chip gateway"
          :class="{ active: resultFilter === 'gateway' }"
          title="中转拒绝轻量探测；点击切换筛选"
          @click="$emit('toggle-result-filter', 'gateway')"
        >
          无法验证 {{ summary.gateway }}
        </button>
        <button
          v-if="summary.idle"
          type="button"
          class="chip idle"
          :class="{ active: resultFilter === 'idle' }"
          title="点击切换：只看未测"
          @click="$emit('toggle-result-filter', 'idle')"
        >
          未测 {{ summary.idle }}
        </button>
        <span v-if="summary.total" class="chip quiet" title="已产生结论的探测数（不含未测）">
          已测 {{ summary.total }}
        </span>
      </div>
      <button type="button"
        class="btn-ghost"
        :class="{ 'scope-active': modelFilterConfigured }"
        :disabled="loading || running || preparing"
        :title="modelFilterConfigured ? `当前：${modelFilterSummary}` : '配置从 /models 接口加载哪些模型'"
        @click="$emit('open-model-filter')"
      >
        <t-icon name="filter" />
        <span>{{ modelFilterConfigured ? modelFilterSummary : '模型筛选' }}</span>
      </button>
      <button type="button"
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
      <button type="button"
        class="btn-ghost"
        :disabled="loading || running || preparing"
        @click="$emit('reload')"
      >
        <t-icon name="refresh" />
        <span>重新加载</span>
      </button>
      <button
        v-if="summary.ok"
        class="btn-ghost"
        type="button"
        :disabled="loading || running || preparing"
        title="复制当前范围内可用模型清单"
        @click="$emit('copy-available')"
      >
        <t-icon name="file-copy" />
        <span>复制可用</span>
      </button>
      <button type="button"
        v-if="failedTaskCount && !running"
        class="btn-ghost"
        :disabled="loading || preparing"
        title="重测当前可见列表中失败的模型"
        @click="$emit('test-failed')"
      >
        <t-icon name="refresh" />
        <span>重测失败 ({{ failedTaskCount }})</span>
      </button>
      <button type="button"
        v-if="running"
        class="btn-ghost danger"
        :disabled="stopping"
        @click="$emit('cancel')"
      >
        <t-icon :name="stopping ? 'loading' : 'close-circle'" :class="{ spin: stopping }" />
        <span>{{ stopping ? "停止中…" : "停止测试" }}</span>
      </button>
      <button type="button"
        v-else
        class="btn-ghost primary"
        :disabled="loading || running || preparing || bulkCount === 0"
        @click="$emit('test-all')"
      >
        <t-icon name="play-circle" />
        <span>{{ scopeConfigured ? "一键测试所选" : "一键测试全部" }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { formatDuration } from "../modelUtils.js";

defineProps({
  summary: { type: Object, required: true },
  resultFilter: { type: String, default: "all" },
  okSummaryTitle: { type: String, default: "点击切换：只看可用" },
  failedBreakdownTitle: { type: String, default: "点击切换：只看失败" },
  scopeConfigured: { type: Boolean, default: false },
  modelFilterConfigured: { type: Boolean, default: false },
  modelFilterSummary: { type: String, default: "模型筛选" },
  bulkCount: { type: Number, default: 0 },
  testableCount: { type: Number, default: 0 },
  failedTaskCount: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  running: { type: Boolean, default: false },
  preparing: { type: Boolean, default: false },
  stopping: { type: Boolean, default: false },
});

defineEmits([
  "toggle-result-filter",
  "open-scope",
  "open-model-filter",
  "reload",
  "copy-available",
  "test-failed",
  "cancel",
  "test-all",
]);
</script>
