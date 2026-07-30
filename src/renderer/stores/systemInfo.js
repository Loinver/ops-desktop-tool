import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSystemInfoStore = defineStore('systemInfo', () => {
  const loading = ref(false)
  const system = ref({
    platform: '-',
    arch: '-',
    nodeVersion: '-',
    uptime: '-',
    memory: '-',
    cpu: '-',
    hostname: '-'
  })

  async function fetchSystemInfo() {
    loading.value = true
    try {
      const info = await window.opsApi.getSystemInfo()
      system.value = info
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    system,
    fetchSystemInfo
  }
})
