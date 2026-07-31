<template>
  <header class="page-header">
    <div class="page-heading">
      <h2 class="page-title">
        <span v-if="icon" class="header-icon">{{ icon }}</span>
        {{ title }}
      </h2>
      <p v-if="description" class="page-desc">{{ description }}</p>
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
  description: {
    type: String,
    default: ''
  },
  icon: {
    type: String,
    default: ''
  }
})
</script>

<style scoped>
.header-icon {
  margin-right: var(--spacing-sm);
}
</style>
