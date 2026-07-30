import { ref, reactive, computed, nextTick, watch, onMounted, onUnmounted, onActivated, onDeactivated } from "vue";
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs';
import {
  CACHEABLE_RESULT_STATUSES,
  CONCURRENCY,
  COPY_FIELD_LABELS,
  EMPTY_RESULT,
  FAILED_STATUSES,
  FAMILY_LABELS,
  FAMILY_ORDER,
  RESULT_CACHE_STORAGE_KEY,
  RESULT_CACHE_TTL_MS,
  SCOPE_STORAGE_KEY,
} from "../constants.js";
import {
  detailText,
  formatDuration,
  modelFamily,
  normalizeModelOptions,
  normalizeScopeKeys,
  protocolDisplay,
  protocolLabel,
  providerKey,
  rowKey,
  statusText,
} from "../modelUtils.js";

/**
 * 模型测试页状态与编排。
 * 页面保持 keep-alive 名称 ModelTest；本 composable 负责列表、范围、探测队列。
 */
export function useModelTestPage() {
  const loading = ref(false);
  const running = ref(false);
  const stopping = ref(false);
  const preparing = ref(false);
  const errorMessage = ref("");
  const providers = ref([]);
  const appFilter = ref("all");
  const familyFilter = ref("all");
  /** 结果筛选：all | failed | ok | idle | gateway */
  const resultFilter = ref("all");
  const searchQuery = ref("");
  const activeNavKey = ref("");
  let activeNavTimer = 0;
  const progress = reactive({ done: 0, total: 0, currents: [] });

  /** null = 未配置范围（展示并测试全部）；Set = 仅展示/测试选中 entry key */
  const selectedScopeKeys = ref(null);
  const showScopeSettings = ref(false);
  const scopeDraftKeys = ref(new Set());

  // 模型列表筛选配置保存在主进程 userData 中，避免把运行环境或个人偏好写死在代码里。
  const showModelListSettings = ref(false);
  const modelListSettings = ref({ mode: "all", includeRules: [], excludeRules: [] });
  const savingModelListSettings = ref(false);

  const expanded = reactive({});
  /** 每个 provider 的模型加载状态，key 为 provider key */
  const modelState = reactive({});
  const results = reactive({});
  const MODEL_LIST_CONCURRENCY = 4;
  const modelLoadPromises = new Map();
  const pendingModelLoads = [];
  let activeModelLoadCount = 0;
  let modelLoadGeneration = 0;
  let reloadGeneration = 0;
  // 与本地结果缓存一起持久化。配置线路变化后，旧探测结论不能继续展示。
  let cachedProviderFingerprints = {};
  let cancelToken = { cancelled: false, runId: "" };

  function isExpanded(pKey) {
    return Boolean(expanded[pKey]);
  }

  function normalizeCachedResult(value) {
    if (!value || !CACHEABLE_RESULT_STATUSES.has(value.status)) return null;
    const updatedAt = Number(value.updatedAt || 0);
    if (!updatedAt || Date.now() - updatedAt > RESULT_CACHE_TTL_MS) return null;

    return {
      status: value.status,
      message: String(value.message || ""),
      httpStatus: Number(value.httpStatus || 0),
      endpoint: String(value.endpoint || ""),
      durationMs: Number(value.durationMs || 0),
      updatedAt,
    };
  }

  function providerCacheFingerprint(provider) {
    // 仅使用渲染进程本来就能看到的非敏感线路字段；绝不把 apiKey 写入 localStorage。
    return JSON.stringify({
      id: String(provider?.id || ""),
      appType: String(provider?.appType || ""),
      protocol: String(provider?.protocol || ""),
      baseUrl: String(provider?.baseUrl || ""),
      fallbackBaseUrl: String(provider?.fallbackBaseUrl || ""),
      anthropicAuthType: String(provider?.anthropicAuthType || ""),
      customUserAgent: String(provider?.customUserAgent || ""),
    });
  }

  function syncCachedResultsWithProviders(nextProviders) {
    const nextFingerprints = {};
    const providerKeys = new Set();
    for (const provider of nextProviders || []) {
      const key = providerKey(provider);
      providerKeys.add(key);
      nextFingerprints[key] = providerCacheFingerprint(provider);
    }

    let changed = false;
    for (const key of Object.keys(results)) {
      const matchedProviderKey = [...providerKeys].find((providerKeyValue) =>
        key.startsWith(`${providerKeyValue}::`),
      );
      // 当前不存在的中转站、以及线路配置发生变化的中转站，均不能复用旧结果。
      if (!matchedProviderKey || cachedProviderFingerprints[matchedProviderKey] !== nextFingerprints[matchedProviderKey]) {
        delete results[key];
        changed = true;
      }
    }

    const fingerprintsChanged = JSON.stringify(cachedProviderFingerprints) !== JSON.stringify(nextFingerprints);
    cachedProviderFingerprints = nextFingerprints;
    if (changed || fingerprintsChanged) persistCachedResults();
  }

  function restoreCachedResults() {
    try {
      const raw = window.localStorage.getItem(RESULT_CACHE_STORAGE_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      const entries = stored && typeof stored.results === "object" ? stored.results : {};
      cachedProviderFingerprints = stored && typeof stored.providerFingerprints === "object"
        ? stored.providerFingerprints
        : {};
      let hasExpired = false;

      for (const [key, value] of Object.entries(entries)) {
        const result = normalizeCachedResult(value);
        if (result) results[key] = result;
        else hasExpired = true;
      }

      if (hasExpired) persistCachedResults();
    } catch {
      // localStorage 不可用或旧缓存损坏时，直接从空状态开始即可。
      cachedProviderFingerprints = {};
    }
  }

  function persistCachedResults() {
    try {
      const cached = {};
      for (const [key, value] of Object.entries(results)) {
        const result = normalizeCachedResult(value);
        if (!result) continue;
        // 不持久化真实回复内容，缓存只保存连通结论和最小诊断信息。
        cached[key] = result;
      }
      window.localStorage.setItem(
        RESULT_CACHE_STORAGE_KEY,
        JSON.stringify({ version: 2, providerFingerprints: cachedProviderFingerprints, results: cached }),
      );
    } catch {
      // 隐私模式、磁盘空间不足等场景不应影响正常测试。
    }
  }

  function setResult(key, result) {
    results[key] = result;
    if (CACHEABLE_RESULT_STATUSES.has(result.status)) persistCachedResults();
  }

  function restoreScopeSettings() {
    try {
      const raw = window.localStorage.getItem(SCOPE_STORAGE_KEY);
      if (!raw) {
        selectedScopeKeys.value = null;
        return;
      }
      const stored = JSON.parse(raw);
      // selectedKeys 为 null/缺省：未配置；为数组：已配置（可为空数组表示一键不测任何项）
      if (!stored || !Object.prototype.hasOwnProperty.call(stored, "selectedKeys")) {
        selectedScopeKeys.value = null;
        return;
      }
      if (stored.selectedKeys == null) {
        selectedScopeKeys.value = null;
        return;
      }
      selectedScopeKeys.value = new Set(normalizeScopeKeys(stored.selectedKeys) || []);
    } catch {
      selectedScopeKeys.value = null;
    }
  }

  function persistScopeSettings() {
    try {
      const payload =
        selectedScopeKeys.value == null
          ? { version: 1, selectedKeys: null }
          : {
              version: 1,
              selectedKeys: [...selectedScopeKeys.value],
            };
      window.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage 不可用时不阻断页面，仅无法持久化范围。
    }
  }

  const scopeConfigured = computed(() => selectedScopeKeys.value instanceof Set);

  function isEntryInBulkScope(entry) {
    if (!scopeConfigured.value) return true;
    return selectedScopeKeys.value.has(entry.key);
  }

  async function copyModel(model) {
    try {
      await navigator.clipboard.writeText(model);
      MessagePlugin.success({ content: `已复制模型名 ${model}`, placement: "bottom-right" });
    } catch {
      MessagePlugin.error({ content: "复制失败", placement: "bottom-right" });
    }
  }

  async function copyProviderValue(provider, field) {
    try {
      await window.opsApi.copyModelProviderValue({
        providerId: provider.id,
        appType: provider.appType,
        field,
      });
      MessagePlugin.success({
        content: `已复制 ${COPY_FIELD_LABELS[field] || field}`,
        placement: "bottom-right",
      });
    } catch {
      MessagePlugin.error({ content: "复制失败", placement: "bottom-right" });
    }
  }

  function scheduleModelLoad(operation) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        activeModelLoadCount += 1;
        try {
          resolve(await operation());
        } catch (error) {
          reject(error);
        } finally {
          activeModelLoadCount -= 1;
          pendingModelLoads.shift()?.();
        }
      };
      if (activeModelLoadCount < MODEL_LIST_CONCURRENCY) run();
      else pendingModelLoads.push(run);
    });
  }

  function fetchModels(provider, { force = false } = {}) {
    const key = provider.key || providerKey(provider);
    const existing = modelLoadPromises.get(key);
    if (existing) return existing;
    if (!force && modelState[key]?.loaded) return Promise.resolve();

    const generation = modelLoadGeneration;
    modelState[key] = { loading: true, models: [], error: "", loaded: false };
    const request = scheduleModelLoad(async () => {
      try {
        // 刷新后遗留在全局队列中的旧任务不再发起请求，也不覆盖新状态。
        if (generation !== modelLoadGeneration) return;
        const res = await window.opsApi.listProviderModels({
          providerId: provider.id,
          appType: provider.appType,
        });
        if (generation !== modelLoadGeneration) return;
        if (res.ok) {
          modelState[key] = {
            loading: false,
            models: normalizeModelOptions(res.models),
            error: "",
            loaded: true,
            source: res.source || "",
            warning: res.warning || "",
          };
        } else {
          modelState[key] = {
            loading: false,
            models: [],
            error: res.error || "获取失败",
            loaded: true,
          };
        }
      } catch (error) {
        if (generation !== modelLoadGeneration) return;
        modelState[key] = {
          loading: false,
          models: [],
          error: error?.message || "获取失败",
          loaded: true,
        };
      }
    });
    modelLoadPromises.set(key, request);
    request.finally(() => {
      if (modelLoadPromises.get(key) === request) modelLoadPromises.delete(key);
    });
    return request;
  }

  async function fetchModelsWithConcurrency(providersToLoad, options = {}) {
    const targets = Array.from(providersToLoad || []);
    let nextIndex = 0;
    const workerCount = Math.min(MODEL_LIST_CONCURRENCY, targets.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < targets.length) {
        const provider = targets[nextIndex++];
        await fetchModels(provider, options);
      }
    }));
  }

  /** 主动重新请求 /models，并展开当前中转站显示结果。 */
  async function fetchProviderModels(provider) {
    const key = provider.key || providerKey(provider);
    expanded[key] = true;
    await fetchModels(provider, { force: true });
  }

  function toggleProviderGroup(provider) {
    if (expanded[provider.key]) {
      expanded[provider.key] = false;
      return;
    }
    expanded[provider.key] = true;
    void fetchModelsWithConcurrency(provider.entries);
  }

  async function fetchProviderGroupModels(provider) {
    expanded[provider.key] = true;
    await fetchModelsWithConcurrency(provider.entries, { force: true });
  }

  function statForRows(rows) {
    return rows.reduce(
      (acc, row) => {
        if (row.result.status === "ok") acc.ok += 1;
        else if (FAILED_STATUSES.includes(row.result.status)) acc.failed += 1;
        if (row.result.status !== "idle") acc.total += 1;
        return acc;
      },
      { ok: 0, failed: 0, total: 0 },
    );
  }

  const decoratedProviderEntries = computed(() =>
    providers.value.map((item) => {
      const key = providerKey(item);
      const state = modelState[key];
      const configuredModels = normalizeModelOptions(item.models);
      const models = item.officialModelsOnly
        ? state?.models || []
        : state?.source === "remote"
          ? state.models
          : state?.models?.length
            ? state.models
            : configuredModels;
      const rows = models.map((model) => ({
        key: rowKey(key, model.id),
        model: model.model,
        beta1m: model.beta1m,
        label: model.label,
        modelId: model.id,
        result: results[rowKey(key, model.id)] || EMPTY_RESULT,
      }));

      return {
        ...item,
        key,
        rows,
        modelLoading: state?.loading || false,
        modelError: state?.error || "",
        modelWarning: state?.warning || "",
        stat: statForRows(rows),
      };
    }),
  );

  /** 同名且至少配置了两种客户端的中转站合并为一个卡片；各客户端/API Key 保留独立模型表。 */
  const decoratedProviders = computed(() => {
    const byName = new Map();
    for (const entry of decoratedProviderEntries.value) {
      const nameKey = String(entry.name || "").trim().toLocaleLowerCase();
      if (!byName.has(nameKey)) byName.set(nameKey, []);
      byName.get(nameKey).push(entry);
    }

    return [...byName.entries()].flatMap(([nameKey, entries]) => {
      const appTypes = new Set(entries.map((entry) => entry.appType));
      const groupedEntries = appTypes.size > 1 ? [entries] : entries.map((entry) => [entry]);
      return groupedEntries.map((groupEntries) => {
        const rows = groupEntries.flatMap((entry) => entry.rows);
        return {
          key: `group::${nameKey}::${groupEntries.map((entry) => entry.key).join("|")}`,
          name: groupEntries[0].name,
          entries: groupEntries,
          isCurrent: groupEntries.some((entry) => entry.isCurrent),
          testable: groupEntries.some((entry) => entry.testable),
          modelLoading: groupEntries.some((entry) => entry.modelLoading),
          rows,
          stat: statForRows(rows),
        };
      });
    });
  });

  const testableProviders = computed(() =>
    decoratedProviderEntries.value.filter((provider) => provider.testable),
  );

  /** 一键测试实际覆盖的中转 entry：未配置范围时等于全部可测项。 */
  const bulkTestProviders = computed(() =>
    testableProviders.value.filter((provider) => isEntryInBulkScope(provider)),
  );

  /**
   * 列表展示用的中转：配置了测试范围后，仅保留范围内的 entry。
   * 未配置范围时与 decoratedProviders 一致。
   */
  const scopedProviders = computed(() => {
    if (!scopeConfigured.value) return decoratedProviders.value;
    return decoratedProviders.value
      .map((group) => {
        const entries = group.entries.filter((entry) => isEntryInBulkScope(entry));
        if (entries.length === 0) return null;
        const rows = entries.flatMap((entry) => entry.rows);
        return {
          ...group,
          entries,
          rows,
          testable: entries.some((entry) => entry.testable),
          modelLoading: entries.some((entry) => entry.modelLoading),
          isCurrent: entries.some((entry) => entry.isCurrent),
          stat: statForRows(rows),
        };
      })
      .filter(Boolean);
  });

  /** 范围内的独立 entry，用于汇总统计。 */
  const scopedProviderEntries = computed(() =>
    decoratedProviderEntries.value.filter((entry) => isEntryInBulkScope(entry)),
  );

  /** 设置弹窗中的可选项，按页面分组展示（同名多客户端合并）。 */
  const scopeOptions = computed(() =>
    decoratedProviders.value
      .map((group) => ({
        key: group.key,
        name: group.name,
        isCurrent: group.isCurrent,
        entries: group.entries.filter((entry) => entry.testable),
      }))
      .filter((group) => group.entries.length > 0),
  );

  function isScopeDraftChecked(option) {
    if (!option?.entries?.length) return false;
    return option.entries.every((entry) => scopeDraftKeys.value.has(entry.key));
  }

  function isScopeDraftPartial(option) {
    if (!option?.entries?.length) return false;
    let hit = 0;
    for (const entry of option.entries) {
      if (scopeDraftKeys.value.has(entry.key)) hit += 1;
    }
    return hit > 0 && hit < option.entries.length;
  }

  const scopeDraftSelectedGroupCount = computed(
    () => scopeOptions.value.filter((option) => isScopeDraftChecked(option)).length,
  );

  function toggleScopeDraftOption(option, checked) {
    const next = new Set(scopeDraftKeys.value);
    for (const entry of option.entries || []) {
      if (checked) next.add(entry.key);
      else next.delete(entry.key);
    }
    scopeDraftKeys.value = next;
  }

  function selectAllScopeDraft() {
    scopeDraftKeys.value = new Set(
      scopeOptions.value.flatMap((option) => option.entries.map((entry) => entry.key)),
    );
  }

  function clearScopeDraft() {
    scopeDraftKeys.value = new Set();
  }

  function lockPageScroll(lock) {
    const page = document.querySelector(".page");
    if (!page) return;
    page.style.overflowY = lock ? "hidden" : "";
  }

  const modelListSettingsConfigured = computed(() =>
    modelListSettings.value.mode === "include" || modelListSettings.value.excludeRules.length > 0,
  );

  const modelListSettingsSummary = computed(() => {
    const { mode, includeRules, excludeRules } = modelListSettings.value;
    if (mode === "include") {
      return includeRules.length
        ? `筛选 ${includeRules.length} 条规则`
        : "模型筛选（未设置规则）";
    }
    return excludeRules.length ? `排除 ${excludeRules.length} 条规则` : "模型筛选";
  });

  async function loadModelListSettings() {
    try {
      const res = await window.opsApi.getModelListSettings();
      if (!res?.ok || !res.settings) {
        throw new Error(res?.error || "读取模型筛选配置失败");
      }
      modelListSettings.value = res.settings;
    } catch (error) {
      // 读取失败时仍维持“全部兼容模型”的安全默认值，不阻断模型列表加载。
      modelListSettings.value = { mode: "all", includeRules: [], excludeRules: [] };
      console.warn("读取模型筛选配置失败:", error);
    }
  }

  function openModelListSettings() {
    showModelListSettings.value = true;
    lockPageScroll(true);
  }

  function closeModelListSettings() {
    showModelListSettings.value = false;
    lockPageScroll(false);
  }

  function resetCachedResults({ notify = false } = {}) {
    for (const key of Object.keys(results)) {
      delete results[key];
    }
    persistCachedResults();
    if (notify) {
      MessagePlugin.success({ content: "已清除测试结果缓存", placement: "bottom-right" });
    }
  }

  async function saveModelListSettings(settings) {
    if (running.value || preparing.value) {
      MessagePlugin.warning({ content: "测试进行中，暂不能修改模型筛选", placement: "bottom-right" });
      return;
    }

    savingModelListSettings.value = true;
    try {
      const res = await window.opsApi.saveModelListSettings(settings);
      if (!res?.ok || !res.settings) {
        throw new Error(res?.error || "保存模型筛选配置失败");
      }
      modelListSettings.value = res.settings;
      closeModelListSettings();
      // 可选模型发生变化，旧结论可能指向已排除的模型，不能继续展示。
      resetCachedResults();
      await reload();
      MessagePlugin.success({ content: "模型筛选配置已保存", placement: "bottom-right" });
    } catch (error) {
      MessagePlugin.error({
        content: error?.message || "保存模型筛选配置失败",
        placement: "bottom-right",
      });
    } finally {
      savingModelListSettings.value = false;
    }
  }

  function openScopeSettings() {
    if (selectedScopeKeys.value instanceof Set) {
      scopeDraftKeys.value = new Set(selectedScopeKeys.value);
    } else {
      // 未配置时默认全选，方便用户从全集里去掉不需要的中转。
      selectAllScopeDraft();
    }
    showScopeSettings.value = true;
    lockPageScroll(true);
  }

  function closeScopeSettings() {
    showScopeSettings.value = false;
    lockPageScroll(false);
  }

  function saveScopeSettings() {
    selectedScopeKeys.value = new Set(scopeDraftKeys.value);
    persistScopeSettings();
    showScopeSettings.value = false;
    lockPageScroll(false);
    const groupCount = scopeOptions.value.filter((option) =>
      option.entries.every((entry) => selectedScopeKeys.value.has(entry.key)),
    ).length;
    MessagePlugin.success({
      content: `已保存范围：列表与一键测试覆盖 ${groupCount} 组 / ${selectedScopeKeys.value.size} 个配置`,
      placement: "bottom-right",
    });
    // 新纳入范围的中转需要补拉模型；范围外的已加载数据保留，只是不再展示。
    ensureScopedProviderModels();
  }

  function resetScopeSettings() {
    selectedScopeKeys.value = null;
    persistScopeSettings();
    showScopeSettings.value = false;
    lockPageScroll(false);
    MessagePlugin.success({
      content: "已恢复为展示并测试全部中转",
      placement: "bottom-right",
    });
    ensureScopedProviderModels();
  }

  const appTabs = computed(() => {
    const groupsByApp = new Map();
    const labels = new Map();
    for (const group of scopedProviders.value) {
      for (const entry of group.entries) {
        if (!groupsByApp.has(entry.appType)) groupsByApp.set(entry.appType, new Set());
        groupsByApp.get(entry.appType).add(group.key);
        labels.set(entry.appType, entry.appLabel);
      }
    }
    const tabs = [{ value: "all", label: "全部", count: scopedProviders.value.length }];
    for (const [appType, groups] of groupsByApp) {
      tabs.push({ value: appType, label: labels.get(appType) || appType, count: groups.size });
    }
    return tabs;
  });

  /**
   * 拉取 /models、准备测试和执行测试期间不改动列表顺序。
   * 保留原始配置顺序比实时把「刚可用」的中转置顶更利于连续操作。
   */
  const isAvailabilitySortDeferred = computed(
    () =>
      loading.value ||
      preparing.value ||
      running.value ||
      scopedProviders.value.some((group) => group.entries.some((entry) => entry.modelLoading)),
  );

  const familyTabs = computed(() => {
    const counts = new Map();
    for (const group of scopedProviders.value) {
      for (const entry of group.entries) {
        for (const row of entry.rows) {
          const family = modelFamily(row.model);
          counts.set(family, (counts.get(family) || 0) + 1);
        }
      }
    }
    const rank = (family) => {
      const index = FAMILY_ORDER.indexOf(family);
      return index === -1 ? FAMILY_ORDER.length : index;
    };
    const total = [...counts.values()].reduce((acc, value) => acc + value, 0);
    const tabs = [{ value: "all", label: "全部", count: total }];
    for (const family of [...counts.keys()].sort((a, b) => rank(a) - rank(b))) {
      tabs.push({ value: family, label: FAMILY_LABELS[family] || family, count: counts.get(family) });
    }
    return tabs;
  });

  const visibleProviders = computed(() => {
    let list = scopedProviders.value;
    if (appFilter.value !== "all") {
      list = list
        .map((group) => ({
          ...group,
          entries: group.entries.filter((entry) => entry.appType === appFilter.value),
        }))
        .filter((group) => group.entries.length > 0);
    }

    const family = familyFilter.value;
    const query = searchQuery.value.trim().toLowerCase();
    const statusFilter = resultFilter.value;
    const needRowFilter = family !== "all" || statusFilter !== "all" || Boolean(query);

    if (needRowFilter) {
      list = list
        .map((group) => {
          const nameHit = Boolean(query) && String(group.name || "").toLowerCase().includes(query);
          const entries = group.entries
            .map((entry) => {
              const filteredRows = entry.rows.filter((row) => {
                if (family !== "all" && modelFamily(row.model) !== family) return false;
                if (statusFilter === "failed" && !FAILED_STATUSES.includes(row.result.status)) {
                  return false;
                }
                if (statusFilter === "ok" && row.result.status !== "ok") return false;
                if (statusFilter === "idle" && row.result.status !== "idle") return false;
                if (statusFilter === "gateway" && row.result.status !== "gateway") return false;
                if (query && !nameHit) {
                  const hay = `${row.model} ${row.label || ""} ${entry.appLabel || ""}`.toLowerCase();
                  if (!hay.includes(query)) return false;
                }
                return true;
              });
              // 运行中连同卡内模型顺序一起保持稳定，避免筛选视图跳动。
              const rows = isAvailabilitySortDeferred.value
                ? filteredRows
                : filteredRows.slice().sort((a, b) => {
                    // 只看可用：同站内按耗时升序，方便挑低延迟模型。
                    if (statusFilter === "ok") {
                      const aMs = Number(a.result.durationMs || 0) || Number.POSITIVE_INFINITY;
                      const bMs = Number(b.result.durationMs || 0) || Number.POSITIVE_INFINITY;
                      if (aMs !== bMs) return aMs - bMs;
                    }
                    // 只看失败：鉴权/超时等相对稳定的问题排前，方便批量处理。
                    if (statusFilter === "failed") {
                      const rank = (status) =>
                        ({ auth: 0, timeout: 1, network: 2, error: 3 }[status] ?? 9);
                      const diff = rank(a.result.status) - rank(b.result.status);
                      if (diff !== 0) return diff;
                    }
                    return String(a.model || "").localeCompare(String(b.model || ""), "zh");
                  });
              return { ...entry, rows, stat: statForRows(rows) };
            })
            .filter((entry) => entry.rows.length > 0);
          const rows = entries.flatMap((entry) => entry.rows);
          return { ...group, entries, rows, stat: statForRows(rows) };
        })
        .filter((group) => group.entries.length > 0);
    }

    // 测试或拉取模型时保持 cc-switch 原始顺序，避免刚有结果的卡片跳动，
    // 也避免用户在滚动、展开或查看进度时丢失当前位置。
    if (isAvailabilitySortDeferred.value) return list;

    if (!needRowFilter) return list;

    // 空闲时才按可用性整理（有可用模型优先）；「只看可用」优先按最快耗时，「只看失败」按失败数（不按可用模型数量排序）。
    return list.slice().sort((a, b) => {
      if (statusFilter === "ok") {
        const best = (group) => {
          const ms = group.rows
            .filter((row) => row.result.status === "ok" && row.result.durationMs > 0)
            .map((row) => row.result.durationMs);
          return ms.length ? Math.min(...ms) : Number.POSITIVE_INFINITY;
        };
        const aBest = best(a);
        const bBest = best(b);
        if (aBest !== bBest) return aBest - bBest;
      }
      if (statusFilter === "failed") {
        if (a.stat.failed !== b.stat.failed) return b.stat.failed - a.stat.failed;
      }
      const aOk = a.stat.ok > 0 ? 1 : 0;
      const bOk = b.stat.ok > 0 ? 1 : 0;
      if (aOk !== bOk) return bOk - aOk;
      if (Boolean(a.isCurrent) !== Boolean(b.isCurrent)) return a.isCurrent ? -1 : 1;
      return String(a.name || "").localeCompare(String(b.name || ""), "zh");
    });
  });


  const hasActiveFilters = computed(
    () =>
      resultFilter.value !== "all" ||
      appFilter.value !== "all" ||
      familyFilter.value !== "all" ||
      Boolean(searchQuery.value.trim()),
  );

  const emptyState = computed(() => {
    if (resultFilter.value === "failed") {
      return {
        title: "没有失败的模型",
        desc: "当前筛选下没有失败项，或失败项被其它条件隐藏了",
        action: "clear-filters",
        actionLabel: "清除筛选",
      };
    }
    if (resultFilter.value === "ok") {
      return {
        title: "没有可用的模型",
        desc: "当前筛选下没有可用结果，可先一键测试或清除筛选",
        action: "clear-filters",
        actionLabel: "清除筛选",
      };
    }
    if (resultFilter.value === "idle") {
      return {
        title: "没有未测模型",
        desc: "当前范围内模型都已测过，或被其它条件隐藏",
        action: "clear-filters",
        actionLabel: "清除筛选",
      };
    }
    if (resultFilter.value === "gateway") {
      return {
        title: "没有无法验证的模型",
        desc: "当前没有中转拒绝轻量探测的结果",
        action: "clear-filters",
        actionLabel: "清除筛选",
      };
    }
    if (searchQuery.value.trim()) {
      return {
        title: "没有匹配结果",
        desc: `找不到包含「${searchQuery.value.trim()}」的中转或模型`,
        action: "clear-filters",
        actionLabel: "清除搜索",
      };
    }
    if (familyFilter.value !== "all" || appFilter.value !== "all") {
      return {
        title: "没有符合条件的中转 / 模型",
        desc: "试试切换应用、端点筛选，或清除筛选条件",
        action: "clear-filters",
        actionLabel: "清除筛选",
      };
    }
    if (providers.value.length === 0) {
      return {
        title: "没有可测试的中转站",
        desc: "需在 cc-switch 配置 baseUrl 与 apiKey 后重新加载",
        action: "reload",
        actionLabel: "重新加载",
      };
    }
    if (scopeConfigured.value && scopedProviders.value.length === 0) {
      return {
        title: "测试范围为空",
        desc: "当前范围未包含任何中转，列表不会展示或拉取模型",
        action: "open-scope",
        actionLabel: "配置测试范围",
      };
    }
    return {
      title: "没有符合条件的中转站",
      desc: "",
      action: "",
      actionLabel: "",
    };
  });

  /** @deprecated 兼容旧模板文案；优先使用 emptyState */
  const emptyPlaceholder = computed(() => emptyState.value.desc || emptyState.value.title);

  function clearFilters() {
    resultFilter.value = "all";
    appFilter.value = "all";
    familyFilter.value = "all";
    searchQuery.value = "";
  }

  /** 点击统计 chip 切换结果筛选；再点一次取消。 */
  function toggleResultFilter(next) {
    resultFilter.value = resultFilter.value === next ? "all" : next;
  }

  /** 当前可见列表中的失败模型数，供「重测失败」使用。 */
  const failedTaskCount = computed(() => {
    let count = 0;
    for (const group of visibleProviders.value) {
      for (const entry of group.entries) {
        for (const row of entry.rows) {
          if (FAILED_STATUSES.includes(row.result.status)) count += 1;
        }
      }
    }
    return count;
  });

  const AVAILABLE_NAV_APP_GROUPS = {
    codex: { label: "Codex", rank: 0 },
    claude: { label: "Claude", rank: 1 },
    gemini: { label: "Gemini", rank: 2 },
    other: { label: "其它应用", rank: 9 },
  };

  function availableNavAppGroup(entry) {
    if (entry.appType === "codex") return "codex";
    if (entry.appType === "claude" || entry.appType === "claude-desktop") return "claude";
    if (entry.appType === "gemini") return "gemini";
    return "other";
  }

  /**
   * 当前筛选下的可用中转按客户端应用分层。相同中转同时配置 Codex / Claude
   * 时会在两个分组中各出现一次，但都定位到同一张中转卡片。
   */
  const availableNavGroups = computed(() => {
    const groups = new Map();

    for (const provider of visibleProviders.value) {
      for (const entry of provider.entries) {
        const ok = entry.rows.filter((row) => row.result.status === "ok").length;
        if (!ok) continue;

        const key = availableNavAppGroup(entry);
        if (!groups.has(key)) {
          groups.set(key, {
            key,
            label: AVAILABLE_NAV_APP_GROUPS[key].label,
            rank: AVAILABLE_NAV_APP_GROUPS[key].rank,
            providers: new Map(),
          });
        }

        const group = groups.get(key);
        const existing = group.providers.get(provider.key);
        if (existing) {
          existing.stat.ok += ok;
        } else {
          group.providers.set(provider.key, {
            key: provider.key,
            name: provider.name,
            stat: { ok },
          });
        }
      }
    }

    return [...groups.values()]
      .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "zh"))
      .map(({ key, label, providers: items }) => ({
        key,
        label,
        providers: [...items.values()],
      }));
  });

  function scrollToProvider(provider) {
    if (!provider?.key) return;

    const target = visibleProviders.value.find((item) => item.key === provider.key);
    if (!target) return;

    expanded[target.key] = true;
    void fetchModelsWithConcurrency(target.entries);

    activeNavKey.value = target.key;
    if (activeNavTimer) window.clearTimeout(activeNavTimer);
    activeNavTimer = window.setTimeout(() => {
      if (activeNavKey.value === target.key) activeNavKey.value = "";
    }, 1800);

    nextTick(() => {
      const root = document.querySelector(".page");
      const selector = `[data-provider-key="${CSS.escape(target.key)}"]`;
      const el = (root || document).querySelector(selector);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const summary = computed(() => {
    const acc = {
      ok: 0,
      failed: 0,
      gateway: 0,
      idle: 0,
      total: 0,
      bestMs: 0,
      failedBy: { auth: 0, timeout: 0, network: 0, error: 0 },
    };
    let bestMs = Number.POSITIVE_INFINITY;
    for (const item of scopedProviderEntries.value) {
      for (const row of item.rows) {
        const status = row.result.status;
        if (status === "testing") continue;
        if (status === "idle") {
          acc.idle += 1;
          continue;
        }
        acc.total += 1;
        if (status === "ok") {
          acc.ok += 1;
          const ms = Number(row.result.durationMs || 0);
          if (ms > 0 && ms < bestMs) bestMs = ms;
        } else if (FAILED_STATUSES.includes(status)) {
          acc.failed += 1;
          if (status in acc.failedBy) acc.failedBy[status] += 1;
        } else if (status === "gateway") {
          acc.gateway += 1;
        }
      }
    }
    acc.bestMs = Number.isFinite(bestMs) ? bestMs : 0;
    return acc;
  });

  const failedBreakdownTitle = computed(() => {
    const by = summary.value.failedBy || {};
    const parts = [];
    if (by.auth) parts.push(`鉴权 ${by.auth}`);
    if (by.timeout) parts.push(`超时 ${by.timeout}`);
    if (by.network) parts.push(`网络 ${by.network}`);
    if (by.error) parts.push(`其他 ${by.error}`);
    if (!parts.length) return "点击切换：只看失败";
    return `失败细分：${parts.join(" · ")}（点击筛选）`;
  });

  const okSummaryTitle = computed(() => {
    const best = summary.value.bestMs;
    if (best > 0) {
      return `最快 ${formatDuration(best)}；点击切换：只看可用`;
    }
    return "点击切换：只看可用";
  });

  const progressPercent = computed(() =>
    progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100),
  );

  const progressCurrentLabel = computed(() => {
    const labels = (progress.currents || []).map((item) => item.label).filter(Boolean);
    if (!labels.length) return "";
    // 并发通常为 2，完整展示即可；过长时截断尾部。
    const text = labels.join(" ｜ ");
    return text.length > 96 ? `${text.slice(0, 94)}…` : text;
  });

  function expandAllVisible() {
    for (const provider of visibleProviders.value) {
      if (!provider.testable) continue;
      expanded[provider.key] = true;
      void fetchModelsWithConcurrency(provider.entries);
    }
  }

  function collapseAllProviders() {
    for (const key of Object.keys(expanded)) {
      expanded[key] = false;
    }
  }

  function clearReactiveMap(target) {
    for (const key of Object.keys(target)) delete target[key];
  }

  /** 当前是否应拉取该中转的模型（未配置范围=全部；已配置=仅范围内）。 */
  function isProviderInModelLoadScope(provider) {
    if (!scopeConfigured.value) return true;
    return selectedScopeKeys.value.has(providerKey(provider));
  }

  /**
   * 并行拉取范围内中转的模型列表。
   * 默认只展开「当前使用」和缓存里已有可用结果的中转，避免一上来整页全展开。
   */
  async function loadAllProviderModels() {
    const currentProviders = providers.value.filter((provider) =>
      isProviderInModelLoadScope(provider),
    );
    await fetchModelsWithConcurrency(currentProviders);

    for (const group of scopedProviders.value) {
      if (group.isCurrent || group.stat.ok > 0) {
        expanded[group.key] = true;
      }
    }
  }

  /** 范围变更后补拉新纳入的中转模型（已加载的不会重复请求）。 */
  async function ensureScopedProviderModels() {
    const targets = providers.value.filter((provider) => isProviderInModelLoadScope(provider));
    if (targets.length === 0) return;
    await fetchModelsWithConcurrency(targets);
    for (const group of scopedProviders.value) {
      if (group.isCurrent || group.stat.ok > 0) {
        expanded[group.key] = true;
      }
    }
  }

  async function reload() {
    const generation = ++reloadGeneration;
    modelLoadGeneration += 1;
    modelLoadPromises.clear();
    loading.value = true;
    errorMessage.value = "";
    clearReactiveMap(expanded);
    clearReactiveMap(modelState);
    try {
      const res = await window.opsApi.listModelProviders();
      if (generation !== reloadGeneration) return;
      if (!res.ok) {
        errorMessage.value = res.message || "读取 cc-switch 配置失败";
        providers.value = [];
        return;
      }
      // 未配置 baseUrl / apiKey 的中转站无法进行模型测试，列表中直接隐藏。
      providers.value = (res.providers || []).filter((provider) => provider.testable);
      syncCachedResultsWithProviders(providers.value);
      await loadAllProviderModels();
      if (generation !== reloadGeneration) return;
    } catch (error) {
      if (generation !== reloadGeneration) return;
      errorMessage.value = error?.message || "读取 cc-switch 配置失败";
      providers.value = [];
    } finally {
      if (generation === reloadGeneration) loading.value = false;
    }
  }

  async function runTask(provider, row, runId) {
    setResult(row.key, { status: "testing", message: "", durationMs: 0 });
    try {
      const res = await window.opsApi.runModelTest({
        providerId: provider.id,
        appType: provider.appType,
        model: row.model,
        beta1m: row.beta1m,
        runId,
      });
      setResult(row.key, {
        status: res.ok ? "ok" : res.status || "error",
        message: res.message || "",
        httpStatus: res.httpStatus || 0,
        endpoint: res.endpoint || "",
        reply: res.reply || "",
        durationMs: res.durationMs || 0,
        updatedAt: Date.now(),
      });
    } catch (error) {
      setResult(row.key, {
        status: "error",
        message: error?.message || "测试失败",
        durationMs: 0,
        updatedAt: Date.now(),
      });
    }
  }

  function summarizeTasks(tasks) {
    let ok = 0;
    let failed = 0;
    let gateway = 0;
    for (const task of tasks) {
      const status = results[task.row.key]?.status;
      if (status === "ok") ok += 1;
      else if (FAILED_STATUSES.includes(status)) failed += 1;
      else if (status === "gateway") gateway += 1;
    }
    return { ok, failed, gateway, total: tasks.length };
  }

  async function runQueue(tasks, { announce = true } = {}) {
    if (!tasks.length) return;
    const historyStartedAt = Date.now();

    const token = {
      cancelled: false,
      runId: globalThis.crypto?.randomUUID?.()
        || `model-run-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    cancelToken = token;
    running.value = true;
    progress.done = 0;
    progress.total = tasks.length;
    progress.currents = [];

    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, tasks.length) },
      async () => {
        while (cursor < tasks.length) {
          if (token.cancelled) return;
          const task = tasks[cursor];
          cursor += 1;
          const current = {
            key: task.row.key,
            label: `${task.provider.name || task.provider.id} · ${task.row.model}`,
          };
          progress.currents.push(current);
          try {
            await runTask(task.provider, task.row, token.runId);
          } finally {
            progress.currents = progress.currents.filter((item) => item.key !== current.key);
            progress.done += 1;
          }
        }
      },
    );

    try {
      await Promise.all(workers);
    } finally {
      const wasCancelled = token.cancelled;
      running.value = false;
      stopping.value = false;
      progress.currents = [];
      if (cancelToken === token) cancelToken = { cancelled: false, runId: "" };

      const historyResults = tasks
        .filter((task) => {
          const status = results[task.row.key]?.status;
          return status && status !== "testing" && status !== "cancelled";
        })
        .map((task) => ({
          providerId: task.provider.id,
          providerName: task.provider.name || task.provider.id,
          appType: task.provider.appType,
          model: task.row.model,
          status: results[task.row.key].status,
          durationMs: results[task.row.key].durationMs || 0,
          httpStatus: results[task.row.key].httpStatus || 0,
          message: results[task.row.key].message || "",
        }));
      if (historyResults.length && typeof window.opsApi?.saveModelTestHistory === "function") {
        window.opsApi.saveModelTestHistory({
          source: "manual",
          label: tasks.length === 1 ? `单模型测试：${tasks[0].row.model}` : `批量测试（${tasks.length} 项）`,
          startedAt: historyStartedAt,
          finishedAt: Date.now(),
          results: historyResults,
        }).catch(() => {});
      }

      if (announce) {
        const stats = summarizeTasks(tasks);
        const gatewayPart = stats.gateway ? `，无法验证 ${stats.gateway}` : "";
        if (wasCancelled) {
          MessagePlugin.warning({
            content: `已停止（完成 ${progress.done}/${progress.total}：可用 ${stats.ok} / 失败 ${stats.failed}${gatewayPart}）`,
            placement: "bottom-right",
          });
        } else if (stats.failed === 0 && stats.gateway === 0) {
          MessagePlugin.success({
            content: `测试完成：全部可用 ${stats.ok}/${stats.total}`,
            placement: "bottom-right",
          });
        } else {
          MessagePlugin.warning({
            content: `测试完成：可用 ${stats.ok}，失败 ${stats.failed}${gatewayPart}（共 ${stats.total}）`,
            placement: "bottom-right",
          });
        }
      }
    }
  }

  function collectTasks(list) {
    const tasks = [];
    for (const provider of list) {
      if (!provider.testable) continue;
      for (const row of provider.rows) {
        tasks.push({ provider, row });
      }
    }
    return tasks;
  }

  async function ensureModels(provider) {
    const key = provider.key || providerKey(provider);
    await fetchModels(provider);
    return decoratedProviderEntries.value.find((item) => item.key === key) || provider;
  }

  async function ensureModelsWithConcurrency(providersToLoad) {
    const entries = Array.from(providersToLoad || []);
    await fetchModelsWithConcurrency(entries);
    return entries.map((provider) => {
      const key = provider.key || providerKey(provider);
      return decoratedProviderEntries.value.find((item) => item.key === key) || provider;
    });
  }

  async function testAll() {
    if (bulkTestProviders.value.length === 0) {
      MessagePlugin.warning({
        content: scopeConfigured.value
          ? "当前测试范围为空，请先在「测试范围」中勾选中转配置"
          : "没有可测试的中转配置",
        placement: "bottom-right",
      });
      return;
    }

    preparing.value = true;
    try {
      const currentProviders = await ensureModelsWithConcurrency(bulkTestProviders.value);
      const tasks = collectTasks(currentProviders);
      if (tasks.length) await runQueue(tasks);
      else {
        MessagePlugin.warning({
          content: "所选中转暂无模型可测，请先获取模型列表",
          placement: "bottom-right",
        });
      }
    } finally {
      preparing.value = false;
    }
  }

  async function testProviderGroup(provider) {
    preparing.value = true;
    try {
      const currentProviders = await ensureModelsWithConcurrency(provider.entries);
      const tasks = collectTasks(currentProviders);
      if (tasks.length) await runQueue(tasks);
    } finally {
      preparing.value = false;
    }
  }

  async function testProvider(provider) {
    preparing.value = true;
    try {
      const currentProvider = await ensureModels(provider);
      const tasks = collectTasks([currentProvider]);
      if (tasks.length) await runQueue(tasks);
    } finally {
      preparing.value = false;
    }
  }

  function testOne(provider, row) {
    runQueue([{ provider, row }], { announce: false });
  }

  function collectFailedTasksFromVisible() {
    const tasks = [];
    for (const group of visibleProviders.value) {
      for (const entry of group.entries) {
        if (!entry.testable) continue;
        for (const row of entry.rows) {
          if (FAILED_STATUSES.includes(row.result.status)) {
            tasks.push({ provider: entry, row });
          }
        }
      }
    }
    return tasks;
  }

  async function testFailed() {
    const tasks = collectFailedTasksFromVisible();
    if (!tasks.length) {
      MessagePlugin.warning({
        content: resultFilter.value === "failed"
          ? "当前没有失败的模型"
          : "没有失败的模型可重测，可先筛选「只看失败」确认范围",
        placement: "bottom-right",
      });
      return;
    }
    await runQueue(tasks);
  }

  /** 导出当前范围内可用模型，便于粘贴到巡检记录。 */
  async function copyAvailableSummary() {
    const lines = ["# 模型巡检 · 可用", ""];
    let count = 0;
    for (const group of scopedProviders.value) {
      const blocks = [];
      for (const entry of group.entries) {
        const oks = entry.rows
          .filter((row) => row.result.status === "ok")
          .slice()
          .sort((a, b) => {
            const aMs = Number(a.result.durationMs || 0) || Number.POSITIVE_INFINITY;
            const bMs = Number(b.result.durationMs || 0) || Number.POSITIVE_INFINITY;
            return aMs - bMs;
          });
        if (!oks.length) continue;
        const header = `- ${group.name} · ${entry.appLabel || entry.appType}`;
        const body = oks.map((row) => {
          const ms = formatDuration(row.result.durationMs);
          count += 1;
          return `  · ${row.model}${ms ? `（${ms}）` : ""}`;
        });
        blocks.push([header, ...body].join("\n"));
      }
      if (blocks.length) lines.push(...blocks, "");
    }

    if (!count) {
      MessagePlugin.warning({ content: "当前没有可用模型可复制", placement: "bottom-right" });
      return;
    }

    lines[0] = `# 模型巡检 · 可用 ${count}`;
    try {
      await navigator.clipboard.writeText(lines.join("\n").trim() + "\n");
      MessagePlugin.success({
        content: `已复制 ${count} 个可用模型`,
        placement: "bottom-right",
      });
    } catch {
      MessagePlugin.error({ content: "复制失败", placement: "bottom-right" });
    }
  }

  /** 清除本地结果缓存（不影响中转配置与测试范围）。 */
  function clearCachedResults() {
    if (running.value || preparing.value) {
      MessagePlugin.warning({ content: "测试进行中，暂不能清除结果", placement: "bottom-right" });
      return;
    }
    const total = summary.value.total;
    if (!total) {
      MessagePlugin.info({ content: "当前没有可清除的测试结果", placement: "bottom-right" });
      return;
    }
    const ok = window.confirm(
      `确认清除 ${total} 条测试结果缓存？\n不会改动中转配置与测试范围。`,
    );
    if (!ok) return;

    resetCachedResults({ notify: true });
  }

  async function saveCurrentMonitorTargets() {
    const candidates = collectTasks(bulkTestProviders.value);
    if (!candidates.length) {
      MessagePlugin.warning({ content: "当前范围没有可巡检模型", placement: "bottom-right" });
      return false;
    }
    const current = await window.opsApi.getModelMonitorSettings();
    const settings = current?.settings || {};
    const response = await window.opsApi.saveModelMonitorSettings({
      ...settings,
      enabled: true,
      targets: candidates.map(({ provider, row }) => ({
        providerId: provider.id,
        providerName: provider.name || provider.id,
        appType: provider.appType,
        model: row.model,
        beta1m: row.beta1m,
      })),
    });
    if (!response.ok) throw new Error(response.error || "保存巡检范围失败");
    MessagePlugin.success({
      content: `已启用定时巡检，共 ${candidates.length} 个模型`,
      placement: "bottom-right",
    });
    return true;
  }

  function cancel() {
    if (cancelToken.cancelled) return;
    cancelToken.cancelled = true;
    stopping.value = true;
    // 主进程持有同一 runId 的 AbortController，会立即中止已在途的真实网络请求。
    if (cancelToken.runId && typeof window.opsApi?.cancelModelTestRun === "function") {
      window.opsApi.cancelModelTestRun(cancelToken.runId).catch(() => {});
    }
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest("[contenteditable='true']"));
  }

  function focusSearchInput() {
    const input = document.querySelector("[data-model-test-search]");
    if (!input) return;
    input.focus();
    input.select?.();
  }

  function onGlobalKeydown(event) {
    if (event.key === "Escape") {
      if (showModelListSettings.value) {
        closeModelListSettings();
        return;
      }
      if (showScopeSettings.value) {
        closeScopeSettings();
        return;
      }
      if (searchQuery.value) {
        searchQuery.value = "";
        return;
      }
      const active = document.activeElement;
      if (active?.matches?.("[data-model-test-search]")) {
        active.blur();
      }
      return;
    }

    // 斜杠聚焦搜索；输入框/对话框内不拦截。
    if (
      event.key === "/" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !showScopeSettings.value &&
      !showModelListSettings.value &&
      !isEditableTarget(event.target)
    ) {
      event.preventDefault();
      focusSearchInput();
    }
  }

  /** 行级筛选条件变化时自动展开命中中转，避免折叠态只看到统计看不到模型。 */
  watch([resultFilter, searchQuery, familyFilter], () => {
    const rowFilterActive =
      resultFilter.value !== "all" ||
      familyFilter.value !== "all" ||
      Boolean(searchQuery.value.trim());
    if (!rowFilterActive) return;
    nextTick(() => {
      for (const provider of visibleProviders.value) {
        if (provider?.testable) expanded[provider.key] = true;
      }
    });
  });

  onMounted(async () => {
    restoreCachedResults();
    restoreScopeSettings();
    await loadModelListSettings();
    reload();
  });

  // 此页被 keep-alive 缓存。快捷键只应在页面可见时生效，避免离开页面后 /、Esc
  // 仍影响已缓存的模型测试状态或把焦点带到隐藏的搜索框。
  onActivated(() => {
    window.addEventListener("keydown", onGlobalKeydown);
  });

  onDeactivated(() => {
    window.removeEventListener("keydown", onGlobalKeydown);
    if (activeNavTimer) window.clearTimeout(activeNavTimer);
    activeNavTimer = 0;
    lockPageScroll(false);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", onGlobalKeydown);
    if (activeNavTimer) window.clearTimeout(activeNavTimer);
    lockPageScroll(false);
  });

  return {
    // state
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
    // computed
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
    emptyPlaceholder,
    emptyState,
    hasActiveFilters,
    failedTaskCount,
    availableNavGroups,
    summary,
    failedBreakdownTitle,
    okSummaryTitle,
    progressPercent,
    progressCurrentLabel,
    // methods
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
    protocolLabel,
    protocolDisplay,
    statusText,
    detailText,
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
  };
}
