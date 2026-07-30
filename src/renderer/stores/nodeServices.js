import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useNodeServicesStore = defineStore('nodeServices', () => {
  const services = ref([])
  const loading = ref(false)
  const lastScan = ref('未扫描')

  const tcpCount = computed(() => services.value.filter(s => s.protocol === 'TCP').length)
  const udpCount = computed(() => services.value.filter(s => s.protocol === 'UDP').length)

  async function fetchServices() {
    loading.value = true
    try {
      const result = await window.opsApi.listPorts()
      if (result.ok) {
        services.value = result.entries.map(entry => ({
          ...entry,
          id: `${entry.protocol}-${entry.port}-${entry.pid}`
        }))
        lastScan.value = formatTime(result.scannedAt)
      }
    } finally {
      loading.value = false
    }
  }

  async function killProcess(pid, signal = 'SIGTERM') {
    return await window.opsApi.killPid(pid, signal)
  }

  function formatTime(iso) {
    if (!iso) return '未扫描'
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(iso))
  }

  return {
    services,
    loading,
    lastScan,
    tcpCount,
    udpCount,
    fetchServices,
    killProcess
  }
})
