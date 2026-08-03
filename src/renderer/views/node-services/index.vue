<template>
  <div class="page">
    <!-- 页头 -->
    <header class="page-header">
      <div class="page-heading header-left">
        <div class="page-eyebrow"><t-icon name="code" /> NODE SERVICES</div>
        <h2 class="page-title">Node 服务</h2>
        <p class="page-desc">管理本地 Node.js 进程，监控端口占用情况</p>
      </div>
      <div class="page-actions header-actions">
        <div class="node-search">
          <t-icon name="search" class="node-search__icon" />
          <input
            v-model="search"
            type="text"
            placeholder="搜索端口、PID..."
            class="node-search__input"
          />
          <button
            v-if="search"
            type="button"
            class="node-search__clear"
            aria-label="清除搜索"
            @click="search = ''"
          >
            <t-icon name="close-circle-filled" />
          </button>
        </div>
        <button type="button" class="btn-refresh" :disabled="store.checking" @click="checkWatches">
          <t-icon name="check-circle" :class="{ spinning: store.checking }" />
          <span>检查关注</span>
        </button>
        <button type="button" class="btn-refresh" :disabled="store.loading" @click="refresh">
          <t-icon name="refresh" :class="{ spinning: store.loading }" />
          <span>刷新</span>
        </button>
      </div>
    </header>

    <main class="page-content">
      <!-- 统计卡片 -->
      <section class="stats-grid" aria-label="Node 服务统计">
        <div class="stat-card interactive-surface">
          <div class="stat-icon-wrap stat-icon-total">
            <t-icon name="ai-terminal" />
          </div>
          <div class="stat-body">
            <div class="stat-number">{{ store.services.length }}</div>
            <div class="stat-text">运行中</div>
          </div>
        </div>
        <div class="stat-card interactive-surface">
          <div class="stat-icon-wrap stat-icon-tcp">
            <t-icon name="link" />
          </div>
          <div class="stat-body">
            <div class="stat-number">{{ store.tcpCount }}</div>
            <div class="stat-text">TCP</div>
          </div>
        </div>
        <div class="stat-card interactive-surface">
          <div class="stat-icon-wrap stat-icon-udp">
            <t-icon name="cloud" />
          </div>
          <div class="stat-body">
            <div class="stat-number">{{ store.udpCount }}</div>
            <div class="stat-text">UDP</div>
          </div>
        </div>
        <div class="stat-card interactive-surface">
          <div class="stat-icon-wrap stat-icon-watch">
            <t-icon name="notification" />
          </div>
          <div class="stat-body">
            <div class="stat-number">{{ store.watchedCount }}</div>
            <div class="stat-text">已关注</div>
          </div>
        </div>
      </section>

      <!-- 服务列表 -->
      <section class="content-section surface-panel page-section" aria-live="polite">
        <div class="monitor-note">
          <div>
            <strong>服务异常监控</strong
            ><span>只有明确关注的端口停止监听时才会生成统一事件，恢复后自动关闭。</span>
          </div>
          <span>上次扫描：{{ store.lastScan }}</span>
        </div>
        <div v-if="store.watches.length" class="watch-list" aria-label="已关注服务">
          <div class="watch-list-heading">
            <strong>已关注服务</strong>
            <span>后台每分钟检查一次，仅状态变化时生成或恢复事件。</span>
          </div>
          <article
            v-for="item in store.watches"
            :key="item.id"
            :data-watch-key="`${item.protocol}:${item.port}`"
            :class="['watch-item', item.lastState, { 'target-service': isTargetService(item) }]"
          >
            <span class="watch-state-dot"></span>
            <div class="watch-info">
              <strong>{{ item.protocol }} {{ item.port }}</strong>
              <span>{{ item.commandLabel || '未记录进程命令' }}</span>
            </div>
            <div class="watch-state">
              <strong>{{
                item.lastState === 'offline'
                  ? '停止监听'
                  : item.lastState === 'online'
                    ? '运行中'
                    : '待检查'
              }}</strong>
              <span>最近发现：{{ formatWatchTime(item.lastSeenAt) }}</span>
            </div>
            <button type="button" class="btn-text-danger" @click="toggleWatch(item)">
              取消关注
            </button>
          </article>
        </div>

        <div v-if="filteredServices.length === 0" class="empty-state">
          <div class="empty-icon">
            <t-icon name="ai-terminal" />
          </div>
          <h3>{{ search ? '未找到运行中的 Node 服务' : '暂无 Node 服务' }}</h3>
          <p>
            {{
              search
                ? '目标端口可能已停止监听，可在上方关注列表查看状态。'
                : '启动 Node 应用后点击刷新按钮'
            }}
          </p>
        </div>

        <div v-else class="service-table-wrap" :aria-busy="store.loading">
          <table class="service-table">
            <thead>
              <tr>
                <th class="col-port">端口</th>
                <th class="col-protocol">协议</th>
                <th class="col-pid">PID</th>
                <th>进程命令</th>
                <th class="col-address">地址</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="service in filteredServices"
                :key="service.id"
                :data-service-key="`${service.protocol}:${service.port}`"
                :class="{ 'target-service': isTargetService(service) }"
              >
                <td class="align-center">
                  <span class="cell-port">{{ service.port }}</span>
                </td>
                <td class="align-center">
                  <span :class="['protocol-tag', service.protocol === 'TCP' ? 'tcp' : 'udp']">
                    {{ service.protocol }}
                  </span>
                </td>
                <td class="align-center">
                  <span class="cell-mono">{{ service.pid }}</span>
                </td>
                <td class="truncate-cell">
                  <span class="cell-mono" :title="service.command">{{ service.command }}</span>
                </td>
                <td class="truncate-cell">
                  <span v-if="service.address" class="cell-mono" :title="service.address">
                    {{ service.address }}
                  </span>
                  <span v-else class="cell-empty">-</span>
                </td>
                <td>
                  <div class="cell-actions">
                    <button
                      type="button"
                      class="action-btn watch-action"
                      :class="{ active: store.isWatched(service) }"
                      :aria-label="store.isWatched(service) ? '取消关注服务' : '关注服务'"
                      :title="
                        store.isWatched(service)
                          ? '取消关注，不再生成异常事件'
                          : '关注后，端口停止监听会生成异常事件'
                      "
                      @click="toggleWatch(service)"
                    >
                      <t-icon name="notification" />
                      <span>{{ store.isWatched(service) ? '已关注' : '关注' }}</span>
                    </button>
                    <button
                      type="button"
                      class="action-btn danger"
                      aria-label="结束进程"
                      title="结束进程"
                      @click="handleKill(service)"
                    >
                      <t-icon name="close-circle" />
                    </button>
                    <button
                      type="button"
                      class="action-btn"
                      aria-label="强制结束进程"
                      title="强制结束"
                      @click="handleForceKill(service)"
                    >
                      <t-icon name="poweroff" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="store.loading" class="table-loading">正在刷新…</div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'
import { useNodeServicesStore } from '../../stores/nodeServices'
import { useRoute } from 'vue-router'
import { useConfirm } from '../../composables/useConfirm'

const store = useNodeServicesStore()
const route = useRoute()
const { confirm } = useConfirm()

const search = ref('')
const targetPort = ref('')
const targetProtocol = ref('')

const filteredServices = computed(() => {
  if (!search.value) return store.services
  const keyword = search.value.toLowerCase()
  return store.services.filter(
    (s) =>
      String(s.port).includes(keyword) ||
      String(s.pid).includes(keyword) ||
      s.command?.toLowerCase().includes(keyword) ||
      s.address?.toLowerCase().includes(keyword)
  )
})

async function refresh() {
  await store.refreshAll()
  await focusRouteService()
  if (store.services.length > 0) {
    MessagePlugin.success({
      content: `发现 ${store.services.length} 个 Node 服务`,
      placement: 'bottom-right'
    })
  }
}

async function checkWatches() {
  const result = await store.checkWatches()
  if (result?.ok) {
    const offline = (result.changes || []).filter((item) => item.type === 'offline').length
    MessagePlugin[offline ? 'warning' : 'success']({
      content: offline ? `发现 ${offline} 个关注服务异常` : '关注服务检查完成',
      placement: 'bottom-right'
    })
  } else {
    MessagePlugin.error({ content: result?.error || '关注服务检查失败', placement: 'bottom-right' })
  }
}

async function toggleWatch(service) {
  const watching = store.isWatched(service)
  const result = watching ? await store.unwatchService(service) : await store.watchService(service)
  if (result?.ok) {
    MessagePlugin.success({
      content: watching ? '已取消关注' : '已关注该服务',
      placement: 'bottom-right'
    })
  } else {
    MessagePlugin.error({ content: result?.error || '更新关注状态失败', placement: 'bottom-right' })
  }
}

async function stopWatchBeforeKill(service) {
  const watchedServices = store.services.filter(
    (item) => item.pid === service.pid && store.isWatched(item)
  )
  const removed = []
  for (const item of watchedServices) {
    const result = await store.unwatchService(item)
    if (!result?.ok) {
      for (const previous of removed) await store.watchService(previous)
      return { services: [], ok: false, error: result?.error }
    }
    removed.push(item)
  }
  return { services: removed, ok: true }
}

async function restoreWatchAfterFailure(watchState) {
  for (const service of watchState.services || []) await store.watchService(service)
}

function isTargetService(service) {
  if (!targetPort.value) return false
  return (
    String(service.port) === targetPort.value &&
    (!targetProtocol.value || service.protocol === targetProtocol.value)
  )
}

function formatWatchTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '尚未发现'
}

async function focusRouteService() {
  targetPort.value = String(route.query.port || '')
  targetProtocol.value = String(route.query.protocol || '').toUpperCase()
  if (!targetPort.value) return
  search.value = targetPort.value
  await nextTick()
  const key = `${targetProtocol.value || 'TCP'}:${targetPort.value}`
  const target = [...document.querySelectorAll('[data-watch-key], [data-service-key]')].find(
    (element) => {
      const current = element.dataset.watchKey || element.dataset.serviceKey || ''
      return targetProtocol.value ? current === key : current.endsWith(`:${targetPort.value}`)
    }
  )
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function handleKill(service) {
  const confirmed = await confirm({
    title: '结束进程',
    content: `确定结束 PID ${service.pid} 吗？`,
    detail: `${service.command} 占用端口 ${service.port}。该进程下已关注的端口会同时取消关注。`
  })
  if (!confirmed) return

  const watchState = await stopWatchBeforeKill(service)
  if (!watchState.ok) {
    MessagePlugin.error({
      content: watchState.error || '停止关注失败，已取消结束进程',
      placement: 'bottom-right'
    })
    return
  }
  const result = await store.killProcess(service.pid, 'SIGTERM')
  if (result.ok) {
    MessagePlugin.success({
      content: '已发送结束信号',
      placement: 'bottom-right'
    })
    await refresh()
  } else {
    await restoreWatchAfterFailure(watchState)
    MessagePlugin.error({
      content: result.error || '操作失败',
      placement: 'bottom-right'
    })
  }
}

async function handleForceKill(service) {
  const confirmed = await confirm({
    title: '强制结束',
    content: `确定强制结束 PID ${service.pid} 吗？`,
    detail: '强制结束不会给进程清理机会；该进程下已关注的端口会同时取消关注。',
    theme: 'warning'
  })
  if (!confirmed) return

  const watchState = await stopWatchBeforeKill(service)
  if (!watchState.ok) {
    MessagePlugin.error({
      content: watchState.error || '停止关注失败，已取消强制结束',
      placement: 'bottom-right'
    })
    return
  }
  const result = await store.killProcess(service.pid, 'SIGKILL')
  if (result.ok) {
    MessagePlugin.success({
      content: '已强制结束进程',
      placement: 'bottom-right'
    })
    await refresh()
  } else {
    await restoreWatchAfterFailure(watchState)
    MessagePlugin.error({
      content: result.error || '操作失败',
      placement: 'bottom-right'
    })
  }
}

watch(
  () => [route.query.port, route.query.protocol],
  () => {
    void focusRouteService()
  }
)

onMounted(() => {
  refresh()
})
</script>

<style scoped>
/* 搜索框 */
.node-search {
  position: relative;
  display: flex;
  align-items: center;
}

.node-search__icon {
  position: absolute;
  left: 12px;
  color: var(--text-muted);
  font-size: 16px;
  pointer-events: none;
}

.node-search__input {
  width: 240px;
  height: var(--header-control-height);
  padding: 0 36px 0 38px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: var(--header-control-font-size);
  color: var(--text);
  background: var(--card-bg);
  outline: none;
  transition: all var(--transition);
}

.node-search__input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(91, 106, 191, 0.1);
}

.node-search__input::placeholder {
  color: var(--text-muted);
}

.node-search__clear {
  position: absolute;
  right: 10px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  transition:
    color var(--transition),
    background var(--transition);
}

.node-search__clear:hover {
  background: var(--primary-light);
  color: var(--primary);
}

/* 刷新按钮 */
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

.btn-refresh:active:not(:disabled) {
  transform: translateY(0);
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 统计卡片 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--content-gap);
}

.stat-card {
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

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: transparent;
}

.stat-icon-wrap {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  flex-shrink: 0;
}

.stat-icon-total {
  background: linear-gradient(135deg, #eef2ff, #e0e7ff);
  color: #6366f1;
}

.stat-icon-tcp {
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  color: #10b981;
}

.stat-icon-watch {
  color: var(--primary);
  background: var(--primary-soft);
}

.stat-icon-udp {
  background: linear-gradient(135deg, #fffbeb, #fef3c7);
  color: #f59e0b;
}

.stat-body {
  display: flex;
  flex-direction: column;
}

.stat-number {
  font-size: 32px;
  font-weight: 700;
  color: var(--text);
  line-height: 1;
  font-family: var(--font-mono);
  letter-spacing: -1px;
}

.stat-text {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
  font-weight: 500;
}

/* 内容区 */
.content-section {
  min-height: 300px;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}

.empty-icon {
  width: 80px;
  height: 80px;
  border-radius: 24px;
  background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 8px;
}

.empty-state p {
  font-size: 14px;
  color: var(--text-muted);
}

.monitor-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: var(--content-gap);
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: 12px;
}
.monitor-note > div {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}
.monitor-note strong {
  color: var(--text-secondary);
}
.monitor-note > span {
  flex: none;
  white-space: nowrap;
}

.watch-list {
  display: grid;
  gap: 8px;
  margin-bottom: var(--content-gap);
}
.watch-list-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-muted);
  font-size: 11px;
}
.watch-list-heading strong {
  color: var(--text-secondary);
  font-size: 12px;
}
.watch-item {
  display: grid;
  grid-template-columns: 8px minmax(140px, 0.7fr) minmax(150px, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card-bg);
}
.watch-item.target-service {
  border-color: color-mix(in srgb, var(--primary) 48%, var(--border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 10%, transparent);
}
.watch-state-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
}
.watch-item.online .watch-state-dot {
  background: var(--success);
}
.watch-item.offline .watch-state-dot {
  background: var(--danger);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 10%, transparent);
}
.watch-info,
.watch-state {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.watch-info strong,
.watch-state strong {
  color: var(--text);
  font-size: 12px;
}
.watch-info span,
.watch-state span {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.watch-item.offline .watch-state strong {
  color: var(--danger);
}
.btn-text-danger {
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--danger);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.btn-text-danger:hover {
  background: var(--danger-light);
}

/* 服务表格 */
.service-table-wrap {
  position: relative;
  overflow-x: auto;
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
}

.service-table {
  width: 100%;
  min-width: 820px;
  border-collapse: collapse;
  table-layout: fixed;
  color: var(--text-secondary);
  font-size: 13px;
}

.service-table th,
.service-table td {
  height: 52px;
  padding: 10px 16px;
  border-right: 1px solid var(--border-light);
  border-bottom: 1px solid var(--border-light);
  vertical-align: middle;
}

.service-table th:last-child,
.service-table td:last-child {
  border-right: 0;
}

.service-table tbody tr:last-child td {
  border-bottom: 0;
}

.service-table th {
  height: 46px;
  background: #f8fafc;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}

.service-table tbody tr:nth-child(even) {
  background: rgba(248, 250, 252, 0.55);
}

.service-table tbody tr:hover {
  background: rgba(91, 106, 191, 0.05);
}

.col-port,
.col-protocol,
.col-pid,
.col-actions,
.align-center {
  text-align: center !important;
}

.col-port,
.col-protocol {
  width: 90px;
}

.col-pid {
  width: 110px;
}

.col-address {
  width: 190px;
}

.col-actions {
  width: 210px;
}

.truncate-cell {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cell-port {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  font-family: var(--font-mono);
}

.cell-mono {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: #f8fafc;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-light);
}

.cell-empty {
  color: var(--text-muted);
  font-size: 12px;
}

.protocol-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 20px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.protocol-tag.tcp {
  background: var(--info-light);
  color: var(--info);
}

.protocol-tag.udp {
  background: var(--warning-light);
  color: var(--warning);
}

.cell-actions {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.action-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  cursor: pointer;
  transition: all var(--transition);
}

.action-btn:hover {
  background: #f8fafc;
  color: var(--text-secondary);
  border-color: var(--text-muted);
}

.action-btn.watch-action {
  width: auto;
  padding: 0 9px;
  gap: 5px;
  font-size: 12px;
}
.action-btn.watch-action.active {
  border-color: color-mix(in srgb, var(--primary) 40%, var(--border));
  background: var(--primary-soft);
  color: var(--primary);
}
.service-table tbody tr.target-service {
  background: color-mix(in srgb, var(--primary-soft) 70%, #fff);
  box-shadow: inset 3px 0 0 var(--primary);
}

.action-btn.danger:hover {
  background: var(--danger-light);
  color: var(--danger);
  border-color: var(--danger);
}

.table-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.72);
  color: var(--text-secondary);
  font-size: 13px;
  backdrop-filter: blur(1px);
}

@media (max-width: 760px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .node-search,
  .node-search__input {
    width: 100%;
  }

  .service-table-wrap {
    margin-inline: calc(var(--panel-padding) * -1);
    border-right: 0;
    border-left: 0;
    border-radius: 0;
  }

  .content-section {
    padding-inline: var(--panel-padding);
  }

  .monitor-note,
  .watch-list-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .monitor-note > span {
    white-space: normal;
  }
  .watch-item {
    grid-template-columns: 8px minmax(0, 1fr) auto;
  }
  .watch-state {
    grid-column: 2;
  }
  .btn-text-danger {
    grid-column: 3;
    grid-row: 1 / span 2;
  }
}
</style>
