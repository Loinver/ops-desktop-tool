import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'

export const useClipboardStore = defineStore('clipboard', () => {
  const history = ref([])
  const maxItems = 200

  const textCount = computed(() => history.value.filter(i => i.type === 'text').length)
  const imageCount = computed(() => history.value.filter(i => i.type === 'image').length)

  async function fetchHistory() {
    const result = await window.opsApi.getClipboardHistory()
    if (result) {
      history.value = result
    }
  }

  async function saveHistory() {
    const serializableHistory = toRaw(history.value).map(item => ({ ...toRaw(item) }))
    await window.opsApi.saveClipboardHistory(serializableHistory)
  }

  async function checkClipboard() {
    const result = await window.opsApi.readClipboard()
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

    saveHistory()
  }

  async function copyToClipboard(item) {
    await window.opsApi.writeClipboard(item.content)
  }

  function deleteItem(id) {
    history.value = history.value.filter(i => i.id !== id)
    saveHistory()
  }

  function clearAll() {
    history.value = []
    saveHistory()
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
