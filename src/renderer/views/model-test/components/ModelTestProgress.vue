<template>
  <div v-if="errorMessage" class="alert">
    <t-icon name="error-circle" />
    <pre>{{ errorMessage }}</pre>
  </div>

  <div v-if="preparing && !running" class="progress-bar preparing sticky-bar">
    <span class="progress-text">正在准备模型列表…</span>
  </div>

  <div v-if="running" class="progress-panel">
    <div class="progress-bar sticky-bar">
      <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
      <span class="progress-text">{{
        stopping
          ? "停止中，等待进行中的请求结束…"
          : `测试中 ${progress.done} / ${progress.total}（${progressPercent}%）`
      }}</span>
    </div>
    <div v-if="!stopping && currentLabel" class="progress-current" :title="currentLabel">
      <t-icon name="loading" class="spin" />
      <span>{{ currentLabel }}</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  errorMessage: { type: String, default: "" },
  preparing: { type: Boolean, default: false },
  running: { type: Boolean, default: false },
  stopping: { type: Boolean, default: false },
  progress: { type: Object, required: true },
  progressPercent: { type: Number, default: 0 },
  currentLabel: { type: String, default: "" },
});
</script>
