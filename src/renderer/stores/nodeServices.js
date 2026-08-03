import { opsApi } from '../api/opsApi.js'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

function serviceKey(service = {}) {
  return `${String(service.protocol || '').toUpperCase()}:${Number(service.port) || 0}`
}

export const useNodeServicesStore = defineStore('nodeServices', () => {
  const services = ref([])
  const watches = ref([])
  const loading = ref(false)
  const checking = ref(false)
  const lastScan = ref('未扫描')

  const tcpCount = computed(() => services.value.filter((s) => s.protocol === 'TCP').length)
  const udpCount = computed(() => services.value.filter((s) => s.protocol === 'UDP').length)
  const watchedCount = computed(() => watches.value.filter((item) => item.enabled !== false).length)
  const watchedKeys = computed(() => new Set(watches.value.map(serviceKey)))

  function applyEntries(result) {
    if (!result?.ok) return
    services.value = (result.entries || []).map((entry) => ({
      ...entry,
      id: `${entry.protocol}-${entry.port}-${entry.pid}`
    }))
    lastScan.value = formatTime(result.scannedAt || result.checkedAt)
  }

  async function fetchServices() {
    loading.value = true
    try {
      const result = await opsApi.listPorts()
      applyEntries(result)
      return result
    } finally {
      loading.value = false
    }
  }

  async function fetchWatches() {
    const result = await opsApi.getNodeServiceWatches()
    if (result?.ok) watches.value = result.items || []
    return result
  }

  async function refreshAll() {
    loading.value = true
    try {
      const [servicesResult, watchesResult] = await Promise.all([
        opsApi.listPorts(),
        opsApi.getNodeServiceWatches()
      ])
      applyEntries(servicesResult)
      if (watchesResult?.ok) watches.value = watchesResult.items || []
      return servicesResult
    } finally {
      loading.value = false
    }
  }

  async function checkWatches() {
    checking.value = true
    try {
      const result = await opsApi.checkNodeServiceWatches()
      applyEntries(result)
      if (result?.ok) watches.value = result.items || []
      return result
    } finally {
      checking.value = false
    }
  }

  async function watchService(service) {
    const result = await opsApi.watchNodeService({
      protocol: service.protocol,
      port: service.port,
      pid: service.pid,
      command: service.command,
      address: service.address,
      lastSeenAt: Date.now(),
      lastState: 'online'
    })
    if (result?.ok) await fetchWatches()
    return result
  }

  async function unwatchService(service) {
    const result = await opsApi.unwatchNodeService({
      protocol: service.protocol,
      port: service.port
    })
    if (result?.ok) await fetchWatches()
    return result
  }

  function isWatched(service) {
    return watchedKeys.value.has(serviceKey(service))
  }

  async function killProcess(pid, signal = 'SIGTERM') {
    return await opsApi.killPid(pid, signal)
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
    watches,
    loading,
    checking,
    lastScan,
    tcpCount,
    udpCount,
    watchedCount,
    fetchServices,
    fetchWatches,
    refreshAll,
    checkWatches,
    watchService,
    unwatchService,
    isWatched,
    killProcess
  }
})
