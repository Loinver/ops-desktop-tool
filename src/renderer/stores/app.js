import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const platform = ref('检测中...')

  async function fetchPlatform() {
    const result = await window.opsApi.listPorts()
    if (result.ok) {
      platform.value = formatPlatform(result.platform)
    }
  }

  function formatPlatform(p) {
    const map = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }
    return map[p] || p || '未知'
  }

  return {
    platform,
    fetchPlatform
  }
})
