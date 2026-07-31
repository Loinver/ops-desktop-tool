<template>
  <Teleport to="body">
  <div
    v-if="open"
    class="model-test-page modal-mask"
  >
    <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="scope-dialog-title">
      <header class="dialog-header">
        <div>
          <h3 id="scope-dialog-title">测试范围</h3>
          <p>勾选要在列表中展示、拉取模型并纳入一键测试的中转配置</p>
        </div>
        <button class="icon-button" type="button" title="关闭" @click="$emit('close')">
          <t-icon name="close" />
        </button>
      </header>

      <div class="scope-toolbar">
        <div class="scope-toolbar-left">
          <span class="scope-count">
            已选 {{ selectedGroupCount }} 组 / {{ draftSize }} 个配置
          </span>
          <label class="scope-search">
            <t-icon name="search" />
            <input
              ref="scopeSearchRef"
              v-model="scopeQuery"
              type="search"
              placeholder="搜索中转名称"
              spellcheck="false"
            />
            <button
              v-if="scopeQuery"
              type="button"
              class="search-clear"
              title="清除"
              @click="scopeQuery = ''"
            >
              <t-icon name="close" />
            </button>
          </label>
        </div>
        <div class="scope-toolbar-actions">
          <button class="btn-ghost small" type="button" @click="$emit('select-all')">全选</button>
          <button class="btn-ghost small" type="button" @click="$emit('clear')">清空</button>
        </div>
      </div>

      <div class="scope-list">
        <label
          v-for="option in filteredOptions"
          :key="option.key"
          class="scope-item"
          :class="{ checked: isChecked(option), partial: isPartial(option) }"
        >
          <input
            type="checkbox"
            :checked="isChecked(option)"
            :indeterminate.prop="isPartial(option)"
            @change="$emit('toggle', option, $event.target.checked)"
          />
          <div class="scope-item-body">
            <div class="scope-item-title">
              <strong>{{ option.name }}</strong>
              <span v-if="option.isCurrent" class="current-tag">当前使用</span>
            </div>
            <div class="scope-item-meta">
              <span
                v-for="entry in option.entries"
                :key="entry.key"
                class="app-tag"
                :data-app="entry.appType"
              >{{ entry.appLabel }}</span>
              <span class="scope-item-sub">{{ option.entries.length }} 个配置</span>
            </div>
          </div>
        </label>
        <div v-if="filteredOptions.length === 0" class="scope-empty">
          {{ scopeQuery.trim() ? `没有匹配「${scopeQuery.trim()}」的中转` : "暂无可选中转" }}
        </div>
      </div>

      <div class="dialog-actions">
        <button
          class="btn-ghost"
          type="button"
          :disabled="!scopeConfigured"
          @click="$emit('reset')"
        >
          恢复全部
        </button>
        <div class="dialog-actions-right">
          <button class="btn-ghost" type="button" @click="$emit('close')">取消</button>
          <button class="btn-ghost primary" type="button" @click="$emit('save')">保存范围</button>
        </div>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps({
  open: { type: Boolean, default: false },
  options: { type: Array, default: () => [] },
  selectedGroupCount: { type: Number, default: 0 },
  draftSize: { type: Number, default: 0 },
  scopeConfigured: { type: Boolean, default: false },
  isChecked: { type: Function, required: true },
  isPartial: { type: Function, required: true },
});

defineEmits(["close", "select-all", "clear", "toggle", "reset", "save"]);

const scopeQuery = ref("");
const scopeSearchRef = ref(null);

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      scopeQuery.value = "";
      return;
    }
    await nextTick();
    scopeSearchRef.value?.focus?.();
  },
);

const filteredOptions = computed(() => {
  const q = scopeQuery.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((option) => {
    const name = String(option.name || "").toLowerCase();
    if (name.includes(q)) return true;
    return (option.entries || []).some((entry) => {
      const hay = `${entry.appLabel || ""} ${entry.appType || ""} ${entry.baseUrl || ""}`.toLowerCase();
      return hay.includes(q);
    });
  });
});
</script>
