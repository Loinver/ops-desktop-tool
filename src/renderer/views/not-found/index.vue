<template>
  <div class="page">
    <header class="page-header">
      <div class="page-heading">
        <div class="page-eyebrow"><t-icon name="info-circle" /> 404</div>
        <h2 class="page-title">页面不存在</h2>
        <p class="page-desc">请求的路径无效或已被移除。</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn-primary" @click="$router.replace('/ops-dashboard')">
          <t-icon name="dashboard" /> 返回仪表盘
        </button>
      </div>
    </header>
  </div>
</template>

<script setup>
defineOptions({ name: 'NotFound' })
</script>

<style scoped>
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--header-control-height);
  padding: 0 16px;
  font-size: var(--header-control-font-size);
  color: #fff;
  background: var(--primary);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-fast);
}
.btn-primary:hover { background: var(--primary-hover); }
</style>
