<template>
  <aside v-if="groups.length" class="available-nav">
    <div class="available-nav-head">
      <span class="available-nav-title">可用中转</span>
      <em>{{ providerCount }}</em>
    </div>

    <section v-for="group in groups" :key="group.key" class="available-nav-group">
      <div class="available-nav-group-head">
        <span>{{ group.label }}</span>
        <em>{{ group.providers.length }}</em>
      </div>
      <button
        v-for="provider in group.providers"
        :key="provider.key"
        type="button"
        class="available-nav-item"
        :class="{ active: activeKey === provider.key }"
        :title="`${group.label} · ${provider.name}`"
        @click="$emit('select', provider)"
      >
        <span class="available-nav-dot" aria-hidden="true"></span>
        <span class="available-nav-name">{{ provider.name }}</span>
        <em v-if="provider.stat.ok" class="available-nav-count">{{ provider.stat.ok }}</em>
      </button>
    </section>
  </aside>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  activeKey: { type: String, default: '' }
})

const providerCount = computed(() =>
  props.groups.reduce((total, group) => total + (group.providers?.length || 0), 0)
)

defineEmits(['select'])
</script>
