<template>
  <header class="page-header">
    <div>
      <h2 class="page-title">
        <span v-if="icon" class="header-icon">{{ icon }}</span>
        {{ title }}
      </h2>
      <slot name="subtitle" />
    </div>
    <div class="page-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    required: true
  },
  icon: {
    type: String,
    default: ''
  }
})
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.page-title {
  margin: 0;
  color: var(--text);
  font-size: 24px;
  line-height: 1.4;
}

.header-icon {
  margin-right: 8px;
}

.page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
