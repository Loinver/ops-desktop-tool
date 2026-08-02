<template>
  <router-view v-if="!errorCaught" />
  <div v-else class="app-error-fallback">
    <t-icon name="error-circle" />
    <p>页面发生错误，已停止渲染。</p>
    <button type="button" @click="recover">重试</button>
  </div>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue'

const errorCaught = ref(false)

onErrorCaptured((err) => {
  console.error('[ErrorBoundary]', err)
  errorCaught.value = true
  return false
})

function recover() {
  errorCaught.value = false
}
</script>

<style>
/* 全局样式已在 base.css 中定义 */
</style>

<style scoped>
.app-error-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 100%;
  color: var(--text-secondary);
  font-size: 14px;
}
.app-error-fallback :deep([class*='t-icon']),
.app-error-fallback svg {
  font-size: 48px;
  color: var(--danger);
}
.app-error-fallback button {
  height: var(--header-control-height);
  padding: 0 20px;
  font-size: var(--header-control-font-size);
  color: #fff;
  background: var(--primary);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.app-error-fallback button:hover {
  background: var(--primary-hover);
}
</style>
