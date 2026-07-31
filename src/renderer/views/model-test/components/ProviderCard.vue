<template>
  <section
    :data-provider-key="provider.key"
    :class="[
      'provider-card',
      {
        'has-available-model': provider.stat.ok > 0,
        'nav-target': isNavTarget,
        collapsed: !expanded,
      },
    ]"
  >
    <header class="provider-head provider-group-head">
      <div class="provider-title">
        <button
          class="expand-btn"
          type="button"
          :disabled="!provider.testable"
          :aria-expanded="expanded"
          :title="expanded ? '收起' : '展开'"
          @click.stop="$emit('toggle')"
        >
          <t-icon :name="expanded ? 'chevron-down' : 'chevron-right'" />
        </button>
        <h3>{{ provider.name }}</h3>
        <span
          v-for="entry in provider.entries"
          :key="entry.key"
          class="app-tag"
          :data-app="entry.appType"
        >{{ entry.appLabel }}</span>
        <span v-if="provider.isCurrent" class="current-tag">当前使用</span>
      </div>
      <div class="provider-actions">
        <span
          v-if="provider.rows.length"
          class="stat-text model-count"
          :title="`当前筛选下 ${provider.rows.length} 个模型`"
        >
          {{ provider.rows.length }} 模型
        </span>
        <span v-if="provider.stat.total" class="stat-text" title="可用 / 失败 / 已测">
          <em class="ok">{{ provider.stat.ok }}</em>
          /
          <em class="fail">{{ provider.stat.failed }}</em>
          / {{ provider.stat.total }}
        </span>
        <span
          v-if="bestDurationLabel"
          class="stat-text best-latency"
          title="当前可用模型中的最低耗时"
        >
          最快 {{ bestDurationLabel }}
        </span>
        <button
          class="btn-ghost small"
          type="button"
          :disabled="!provider.testable || provider.modelLoading || running || preparing"
          @click="$emit('fetch-models')"
        >
          <t-icon
            :name="provider.modelLoading ? 'loading' : 'refresh'"
            :class="{ spin: provider.modelLoading }"
          />
          <span>获取模型列表</span>
        </button>
        <button
          class="btn-ghost small"
          type="button"
          :disabled="!provider.testable || running || preparing"
          @click="$emit('test')"
        >
          <t-icon name="play-circle" />
          <span>测试该站</span>
        </button>
      </div>
    </header>

    <div v-if="expanded" class="provider-profiles">
      <section
        v-for="entry in provider.entries"
        :key="entry.key"
        class="provider-profile"
        :class="{ 'single-entry': provider.entries.length === 1 }"
      >
        <header class="provider-profile-head">
          <div class="provider-title">
            <span class="app-tag" :data-app="entry.appType">{{ entry.appLabel }}</span>
            <span class="protocol-tag" :data-protocol="entry.protocol">
              {{ protocolLabel(entry.protocol) }}
            </span>
            <span v-if="provider.entries.length > 1" class="provider-key-label">
              独立 API Key / 模型列表
            </span>
          </div>
          <div class="provider-meta">
            <button
              class="provider-meta-copy"
              type="button"
              :disabled="!entry.baseUrl"
              title="复制 baseUrl"
              @click="$emit('copy-provider-value', entry, 'baseUrl')"
            >
              <code>{{ entry.baseUrl || "未配置 baseUrl" }}</code>
              <t-icon name="file-copy" />
            </button>
            <button
              v-if="entry.apiKeyMasked"
              class="provider-meta-copy"
              type="button"
              title="复制 apiKey"
              @click="$emit('copy-provider-value', entry, 'apiKey')"
            >
              <code>{{ entry.apiKeyMasked }}</code>
              <t-icon name="file-copy" />
            </button>
          </div>
          <div
            v-if="provider.entries.length > 1"
            class="provider-actions provider-profile-actions"
          >
            <button
              class="btn-ghost small"
              type="button"
              :disabled="!entry.testable || entry.modelLoading || running || preparing"
              @click="$emit('fetch-entry-models', entry)"
            >
              <t-icon
                :name="entry.modelLoading ? 'loading' : 'refresh'"
                :class="{ spin: entry.modelLoading }"
              />
              <span>获取模型</span>
            </button>
            <button
              class="btn-ghost small"
              type="button"
              :disabled="!entry.testable || running || preparing"
              @click="$emit('test-entry', entry)"
            >
              <t-icon name="play-circle" />
              <span>测试</span>
            </button>
          </div>
        </header>

        <div v-if="entry.issues.length" class="provider-issues">
          <t-icon name="info-circle" />
          <span>{{ entry.issues.join("、") }}，无法测试</span>
        </div>

        <div v-else class="model-section">
          <div v-if="entry.modelLoading" class="section-loading">
            <t-icon name="loading" class="spin" />
            <span>正在获取模型列表…</span>
          </div>
          <div v-else-if="entry.modelError" class="section-error">
            <t-icon name="error-circle" />
            <span>{{ entry.modelError }}</span>
          </div>
          <template v-else>
            <div class="section-header">
              <span class="section-title">可用模型（{{ entry.rows.length }}）</span>
              <span class="section-hint">支持 {{ protocolDisplay(entry) }}</span>
            </div>
            <div v-if="entry.modelWarning" class="section-warning">
              <t-icon name="info-circle" />
              <span>{{ entry.modelWarning }}</span>
            </div>
            <table class="model-table">
              <thead>
                <tr>
                  <th class="col-model">模型</th>
                  <th class="col-status">状态</th>
                  <th class="col-duration">耗时</th>
                  <th class="col-detail">详情</th>
                  <th class="col-action">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in entry.rows"
                  :key="row.key"
                  :class="['model-row', `is-${row.result.status}`]"
                >
                  <td class="col-model">
                    <button
                      type="button"
                      class="model-name copyable"
                      :class="{ copied: copiedModel === row.model }"
                      :title="`点击复制：${row.model}`"
                      :aria-label="`复制模型名称：${row.model}`"
                      @click="onCopyModel(row.model)"
                    >
                      <span class="model-id">{{ row.model }}</span>
                      <span v-if="row.beta1m" class="model-flag">1M</span>
                      <span class="copy-icon" aria-hidden="true"><t-icon name="file-copy" /></span>
                    </button>
                  </td>
                  <td class="col-status">
                    <span :class="['status-dot', row.result.status]"></span>
                    <span :class="['status-text', row.result.status]">{{
                      statusText(row.result)
                    }}</span>
                  </td>
                  <td
                    class="col-duration"
                    :class="durationClass(row.result)"
                    :title="row.result.durationMs ? `耗时 ${formatDuration(row.result.durationMs)}` : ''"
                  >
                    {{ row.result.durationMs ? formatDuration(row.result.durationMs) : "—" }}
                  </td>
                  <td class="col-detail">
                    <button
                      v-if="detailText(row.result) && canExpandDetail(row.result)"
                      type="button"
                      class="detail-cell"
                      :class="{ expanded: isDetailExpanded(row.key) }"
                      :title="detailTitle(row.result)"
                      @click="toggleDetail(row.key)"
                    >
                      <span class="detail-text">{{ detailText(row.result) }}</span>
                      <span class="detail-toggle">
                        {{ isDetailExpanded(row.key) ? "收起" : "展开" }}
                      </span>
                    </button>
                    <span
                      v-else-if="detailText(row.result)"
                      class="detail-text"
                      :title="detailTitle(row.result)"
                    >{{ detailText(row.result) }}</span>
                    <span v-else class="detail-empty">—</span>
                  </td>
                  <td class="col-action">
                    <button
                      type="button"
                      :class="[
                        'btn-link',
                        {
                          danger: isFailed(row.result.status),
                          primary: row.result.status === 'idle',
                        },
                      ]"
                      :disabled="running || row.result.status === 'testing'"
                      :title="retestTitle(row.result.status)"
                      @click="$emit('test-one', entry, row)"
                    >
                      {{ row.result.status === "idle" ? "测试" : "重测" }}
                    </button>
                  </td>
                </tr>
                <tr v-if="entry.rows.length === 0">
                  <td colspan="5" class="empty-hint">该 API Key 暂无可用模型</td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import { FAILED_STATUSES } from "../constants.js";
import {
  detailText,
  durationTone,
  formatDuration,
  protocolDisplay,
  protocolLabel,
  statusText,
} from "../modelUtils.js";

const props = defineProps({
  provider: { type: Object, required: true },
  expanded: { type: Boolean, default: false },
  isNavTarget: { type: Boolean, default: false },
  running: { type: Boolean, default: false },
  preparing: { type: Boolean, default: false },
});

const bestDurationLabel = computed(() => {
  const ms = (props.provider.rows || [])
    .filter((row) => row.result?.status === "ok" && Number(row.result.durationMs) > 0)
    .map((row) => Number(row.result.durationMs));
  if (!ms.length) return "";
  return formatDuration(Math.min(...ms));
});

function durationClass(result) {
  if (!result?.durationMs) return "";
  if (result.status !== "ok") return "is-muted";
  const tone = durationTone(result.durationMs);
  return tone ? `is-${tone}` : "";
}

const emit = defineEmits([
  "toggle",
  "fetch-models",
  "test",
  "fetch-entry-models",
  "test-entry",
  "copy-provider-value",
  "copy-model",
  "test-one",
]);

const expandedDetails = reactive({});
const copiedModel = ref("");
let copiedTimer = 0;

function isFailed(status) {
  return FAILED_STATUSES.includes(status);
}

function retestTitle(status) {
  if (status === "testing") return "测试进行中";
  if (status === "idle") return "对该模型发起连通测试";
  if (isFailed(status)) return "重新测试失败模型";
  return "重新测试";
}

function detailTitle(result) {
  if (!result) return "";
  const parts = [result.message, result.endpoint].filter(Boolean);
  return parts.join(" · ");
}

function canExpandDetail(result) {
  const text = detailText(result);
  return Boolean(text && (text.length > 36 || text.includes(" · ")));
}

function isDetailExpanded(key) {
  return Boolean(expandedDetails[key]);
}

function toggleDetail(key) {
  expandedDetails[key] = !expandedDetails[key];
}

function onCopyModel(model) {
  emit("copy-model", model);
  copiedModel.value = model;
  if (copiedTimer) window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    if (copiedModel.value === model) copiedModel.value = "";
  }, 1200);
}
</script>
