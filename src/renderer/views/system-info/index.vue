<template>
  <div class="page">
    <!-- 页头 -->
    <header class="page-header">
      <div class="page-heading header-left">
        <h2 class="page-title">系统信息</h2>
        <p class="page-desc">查看当前系统运行状态和环境信息</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn-refresh" :disabled="store.loading" @click="refresh">
        <t-icon name="refresh" :class="{ spinning: store.loading }" />
        <span>刷新</span>
      </button>
      </div>
    </header>

    <main class="page-content">
    <!-- 基本信息 -->
    <section class="section">
      <h3 class="section-title">
        <t-icon name="info-circle" />
        基本信息
      </h3>
      <div class="info-grid">
        <div class="info-card interactive-surface" v-for="item in basicInfo" :key="item.label">
          <div class="info-icon-wrap" :style="{ background: item.bg, color: item.color }">
            <t-icon :name="item.icon" />
          </div>
          <div class="info-body">
            <span class="info-label">{{ item.label }}</span>
            <span class="info-value" :title="item.value">{{ item.value }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 硬件信息 -->
    <section class="section">
      <h3 class="section-title">
        <t-icon name="server" />
        硬件信息
      </h3>
      <div class="info-grid">
        <div class="info-card interactive-surface" v-for="item in hardwareInfo" :key="item.label">
          <div class="info-icon-wrap" :style="{ background: item.bg, color: item.color }">
            <t-icon :name="item.icon" />
          </div>
          <div class="info-body">
            <span class="info-label">{{ item.label }}</span>
            <span class="info-value" :title="item.value">{{ item.value }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 内存详情 -->
    <section class="section">
      <h3 class="section-title">
        <t-icon name="chart-area" />
        内存使用
      </h3>
      <div class="memory-card">
        <div class="memory-visual">
          <div class="memory-ring">
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#e2e8f0" stroke-width="10" />
              <circle
                cx="60" cy="60" r="50"
                fill="none"
                :stroke="memoryColor"
                stroke-width="10"
                stroke-linecap="round"
                :stroke-dasharray="memoryDashArray"
                stroke-dashoffset="0"
                transform="rotate(-90 60 60)"
                class="memory-progress"
              />
            </svg>
            <div class="memory-percent">
              <span class="percent-num">{{ memoryPercent }}</span>
              <span class="percent-sign">%</span>
            </div>
          </div>
        </div>
        <div class="memory-details">
          <div class="memory-row">
            <span class="memory-label">已使用</span>
            <span class="memory-value used">{{ memoryUsed }}</span>
          </div>
          <div class="memory-row">
            <span class="memory-label">总内存</span>
            <span class="memory-value total">{{ memoryTotal }}</span>
          </div>
          <div class="memory-row">
            <span class="memory-label">可用</span>
            <span class="memory-value free">{{ memoryFree }}</span>
          </div>
        </div>
      </div>
    </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useSystemInfoStore } from '../../stores/systemInfo'

const store = useSystemInfoStore()

const basicInfo = computed(() => [
  {
    label: '操作系统',
    value: `${store.system.platform || '-'} ${store.system.arch || ''}`,
    icon: 'logo-apple',
    bg: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
    color: '#475569',
  },
  {
    label: '主机名',
    value: store.system.hostname || '-',
    icon: 'server',
    bg: 'linear-gradient(135deg, #fdf2f8, #fce7f3)',
    color: '#ec4899',
  },
  {
    label: '运行时间',
    value: store.system.uptime || '-',
    icon: 'time',
    bg: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
    color: '#3b82f6',
  },
])

const hardwareInfo = computed(() => [
  {
    label: 'CPU',
    value: store.system.cpu || '-',
    icon: 'setting',
    bg: 'linear-gradient(135deg, #eef2ff, #e0e7ff)',
    color: '#6366f1',
  },
  {
    label: 'Node.js',
    value: store.system.nodeVersion || '-',
    icon: 'code',
    bg: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
    color: '#10b981',
  },
  {
    label: '平台架构',
    value: store.system.arch || '-',
    icon: 'cpu',
    bg: 'linear-gradient(135deg, #fef3c7, #fde68a)',
    color: '#f59e0b',
  },
])

const memoryUsed = computed(() => {
  const match = store.system.memory?.match(/^([\d.]+)\s*GB/)
  return match ? `${match[1]} GB` : '-'
})

const memoryTotal = computed(() => {
  const match = store.system.memory?.match(/\/\s*([\d.]+)\s*GB/)
  return match ? `${match[1]} GB` : '-'
})

const memoryFree = computed(() => {
  const used = parseFloat(memoryUsed.value) || 0
  const total = parseFloat(memoryTotal.value) || 0
  const free = total - used
  return `${free.toFixed(1)} GB`
})

const memoryPercent = computed(() => {
  const match = store.system.memory?.match(/\((\d+)%\)/)
  return match ? match[1] : '0'
})

const memoryColor = computed(() => {
  const pct = parseInt(memoryPercent.value)
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f59e0b'
  return '#10b981'
})

const memoryDashArray = computed(() => {
  const circumference = 2 * Math.PI * 50
  const pct = parseInt(memoryPercent.value) / 100
  return `${circumference * pct} ${circumference}`
})

function refresh() {
  store.fetchSystemInfo()
}

onMounted(() => {
  refresh()
})
</script>

<style scoped>
.btn-refresh {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: var(--header-control-height);
  padding: 0 18px;
  border: none;
  border-radius: var(--radius);
  background: var(--primary);
  color: #fff;
  font-size: var(--header-control-font-size);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
  box-shadow: 0 2px 8px rgba(91, 106, 191, 0.3);
}

.btn-refresh:hover:not(:disabled) {
  background: var(--primary-hover);
  box-shadow: 0 4px 12px rgba(91, 106, 191, 0.4);
  transform: translateY(-1px);
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 分区 */
.section {
  margin: 0;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--section-title-size);
  line-height: var(--section-title-line-height);
  font-weight: 600;
  color: var(--text);
  margin-bottom: var(--spacing-md);
}

.section-title .t-icon {
  color: var(--primary);
  font-size: 18px;
}

/* 信息网格 */
.info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--content-gap);
}

.info-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--panel-padding);
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-xs);
  transition: all var(--transition-slow);
}

.info-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: transparent;
}

.info-icon-wrap {
  width: 50px;
  height: 50px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}

.info-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.info-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.info-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 内存卡片 */
.memory-card {
  display: flex;
  align-items: center;
  gap: var(--spacing-xl);
  padding: var(--panel-padding);
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-xs);
}

.memory-visual {
  flex-shrink: 0;
}

.memory-ring {
  position: relative;
  width: 120px;
  height: 120px;
}

.memory-ring svg {
  width: 100%;
  height: 100%;
}

.memory-progress {
  transition: stroke-dasharray 0.6s ease;
}

.memory-percent {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}

.percent-num {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  font-family: var(--font-mono);
  line-height: 1;
}

.percent-sign {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-muted);
}

.memory-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.memory-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f8fafc;
  border-radius: var(--radius-sm);
}

.memory-label {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 500;
}

.memory-value {
  font-size: 15px;
  font-weight: 600;
  font-family: var(--font-mono);
}

.memory-value.used {
  color: var(--danger);
}

.memory-value.total {
  color: var(--text);
}

.memory-value.free {
  color: var(--success);
}


@media (max-width: 960px) {
  .info-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .info-grid {
    grid-template-columns: 1fr;
  }

  .memory-card {
    align-items: stretch;
    flex-direction: column;
    gap: var(--spacing-lg);
    padding: var(--panel-padding);
  }

  .memory-visual {
    align-self: center;
  }
}
</style>
