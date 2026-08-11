import { opsApi } from '../api/opsApi.js'
import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'

export const useClipboardStore = defineStore('clipboard', () => {
  const history = ref([])
  const maxItems = 200

  const textCount = computed(() => history.value.filter((i) => i.type === 'text').length)
  const imageCount = computed(() => history.value.filter((i) => i.type === 'image').length)

  async function fetchHistory() {
    const result = await opsApi.getClipboardHistory()
    if (result) {
      history.value = result
    }
  }

  async function saveHistory() {
    try {
      const rawHistory = toRaw(history.value)
      const serializableHistory = Array.isArray(rawHistory)
        ? rawHistory.map((item) => ({ ...toRaw(item) }))
        : []
      const result = await opsApi.saveClipboardHistory(serializableHistory)
      if (result === false || result?.ok === false) {
        console.error(result?.error || '保存剪贴板历史失败')
        return false
      }
      if (Array.isArray(result?.history)) history.value = result.history
      return true
    } catch (err) {
      console.error('保存剪贴板历史失败:', err)
      return false
    }
  }

  async function checkClipboard() {
    const result = await opsApi.readClipboard()
    if (!result) return

    const lastItem = history.value[0]
    if (lastItem && lastItem.content === result.content) return

    history.value.unshift({
      id: Date.now().toString(),
      type: result.type,
      content: result.content,
      timestamp: Date.now()
    })

    if (history.value.length > maxItems) {
      history.value = history.value.slice(0, maxItems)
    }

    void saveHistory()
  }

  async function copyToClipboard(item) {
    await opsApi.writeClipboard(item.content)
  }

  function deleteItem(id) {
    history.value = history.value.filter((i) => i.id !== id)
    void saveHistory()
  }

  function clearAll() {
    history.value = []
    void saveHistory()
  }

  return {
    history,
    textCount,
    imageCount,
    fetchHistory,
    saveHistory,
    checkClipboard,
    copyToClipboard,
    deleteItem,
    clearAll
  }
})
