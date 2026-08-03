import { opsApi } from '../api/opsApi.js'
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
function toPlainItem(item) {
  return {
    id: String(item?.id ?? ''),
    name: String(item?.name ?? ''),
    type: String(item?.type ?? ''),
    target: String(item?.target ?? ''),
    icon: String(item?.icon ?? ''),
    color: String(item?.color ?? ''),
    quickOpen: item?.quickOpen === true
  }
}

function toPlainItems(source) {
  return Array.from(source || [], toPlainItem)
}

function createItemId(prefix = 'launch') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function targetKey(target) {
  return String(target || '')
    .trim()
    .replace(/\/$/, '')
    .toLowerCase()
}

export const useQuickLaunchStore = defineStore('quickLaunch', () => {
  const items = ref([])
  const currentTab = ref('all')
  const searchQuery = ref('')

  const websiteItems = computed(() => items.value.filter((item) => item.type === 'url'))
  const quickOpenItems = computed(() =>
    websiteItems.value.filter((item) => item.quickOpen === true)
  )
  const filteredItems = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    return items.value.filter((item) => {
      if (currentTab.value !== 'all' && item.type !== currentTab.value) return false
      if (!query) return true
      return [item.name, item.target, item.type].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(query)
      )
    })
  })

  // 所有写操作按进入顺序串行执行。此前每个操作都会立即乐观更新并独立保存，
  // 保存失败乱序返回时，较早操作的回滚可能覆盖较晚操作，造成内存与磁盘不一致。
  let mutationQueue = Promise.resolve()

  function enqueueItemMutation(mutator) {
    const operation = mutationQueue.then(async () => {
      const previous = toPlainItems(items.value)
      const outcome = mutator() || {}
      if (outcome.changed === false) return outcome.result

      let ok = false
      try {
        ok = await saveItems()
      } catch {
        ok = false
      }
      if (!ok) items.value = previous
      return typeof outcome.result === 'function' ? outcome.result(ok) : ok
    })

    // 当前操作要把真实结果返回给调用者；队列本身则吞掉异常，以便后续操作仍可继续。
    mutationQueue = operation.catch(() => undefined)
    return operation
  }

  async function fetchItems() {
    const result = await opsApi.getQuickLaunchItems()
    const storedItems = Array.isArray(result) ? result : result?.items
    // 快捷方式完全来自用户保存、手动添加或导入的配置；不再打包任何个人默认站点。
    items.value = toPlainItems(Array.isArray(storedItems) ? storedItems : [])
    return { ok: true }
  }

  async function saveItems() {
    return await opsApi.saveQuickLaunchItems(toPlainItems(items.value))
  }

  async function addItem(item) {
    return enqueueItemMutation(() => {
      const added = {
        ...toPlainItem(item),
        id: String(item?.id || createItemId())
      }
      items.value.push(added)
      return { result: (ok) => ok }
    })
  }

  async function updateItem(id, data) {
    return enqueueItemMutation(() => {
      const index = items.value.findIndex((item) => item.id === id)
      if (index === -1) return { changed: false, result: false }

      const previous = items.value[index]
      items.value[index] = toPlainItem({ ...previous, ...data, id: previous.id })
      return { result: (ok) => ok }
    })
  }

  async function deleteItem(id) {
    return enqueueItemMutation(() => {
      const index = items.value.findIndex((item) => item.id === id)
      if (index === -1) return { changed: false, result: false }

      items.value.splice(index, 1)
      return { result: (ok) => ok }
    })
  }

  async function launchItem(item) {
    return await opsApi.launchItem(toPlainItem(item))
  }

  async function launchQuickOpenItems() {
    return await opsApi.launchQuickLaunchUrls(toPlainItems(quickOpenItems.value))
  }

  async function configureQuickOpen(selectedIds) {
    const selected = new Set(Array.from(selectedIds || [], String))
    return enqueueItemMutation(() => {
      items.value = items.value.map((item) => ({
        ...item,
        quickOpen: item.type === 'url' && selected.has(String(item.id))
      }))
      return { result: (ok) => ok }
    })
  }

  async function importWebsiteItems() {
    return await opsApi.importQuickLaunchUrls()
  }

  async function parseWebsiteItems(raw) {
    return await opsApi.parseQuickLaunchUrls(raw)
  }

  async function mergeWebsiteItems(newItems) {
    return enqueueItemMutation(() => {
      const existingTargets = new Set(
        websiteItems.value.map((item) => targetKey(item.target)).filter(Boolean)
      )
      const additions = []
      let duplicates = 0

      for (const item of newItems || []) {
        const key = targetKey(item?.target)
        if (!key || existingTargets.has(key)) {
          duplicates += 1
          continue
        }
        existingTargets.add(key)
        additions.push({
          ...toPlainItem(item),
          id: String(item?.id || createItemId('website'))
        })
      }

      if (!additions.length) {
        return { changed: false, result: { ok: true, added: 0, duplicates } }
      }

      items.value.push(...additions)
      return {
        result: (ok) => ({ ok, added: ok ? additions.length : 0, duplicates })
      }
    })
  }

  async function exportWebsiteItems() {
    return await opsApi.exportQuickLaunchUrls(toPlainItems(items.value))
  }

  async function browseFile() {
    return await opsApi.browseFile()
  }

  return {
    items,
    currentTab,
    searchQuery,
    websiteItems,
    quickOpenItems,
    filteredItems,
    fetchItems,
    saveItems,
    addItem,
    updateItem,
    deleteItem,
    launchItem,
    launchQuickOpenItems,
    configureQuickOpen,
    importWebsiteItems,
    parseWebsiteItems,
    mergeWebsiteItems,
    exportWebsiteItems,
    browseFile
  }
})
