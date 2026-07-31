<template>
  <div class="page">
    <!-- 页头 -->
    <div class="page-header">
      <div class="page-heading header-left">
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
          <t-icon
            v-if="search"
            name="close-circle-filled"
            class="node-search__clear"
            @click="search = ''"
          />
        </div>
        <button class="btn-refresh" :disabled="store.loading" @click="refresh">
          <t-icon name="refresh" :class="{ spinning: store.loading }" />
          <span>刷新</span>
        </button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon-wrap stat-icon-total">
          <t-icon name="ai-terminal" />
        </div>
        <div class="stat-body">
          <div class="stat-number">{{ store.services.length }}</div>
          <div class="stat-text">运行中</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrap stat-icon-tcp">
          <t-icon name="link" />
        </div>
        <div class="stat-body">
          <div class="stat-number">{{ store.tcpCount }}</div>
          <div class="stat-text">TCP</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrap stat-icon-udp">
          <t-icon name="cloud" />
        </div>
        <div class="stat-body">
          <div class="stat-number">{{ store.udpCount }}</div>
          <div class="stat-text">UDP</div>
        </div>
      </div>
    </div>

    <!-- 服务列表 -->
    <div class="content-section">
      <div v-if="filteredServices.length === 0" class="empty-state">
        <div class="empty-icon">
          <t-icon name="ai-terminal" />
        </div>
        <h3>暂无 Node 服务</h3>
        <p>启动 Node 应用后点击刷新按钮</p>
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
            <tr v-for="service in filteredServices" :key="service.id">
              <td class="align-center"><span class="cell-port">{{ service.port }}</span></td>
              <td class="align-center">
                <span :class="['protocol-tag', service.protocol === 'TCP' ? 'tcp' : 'udp']">
                  {{ service.protocol }}
                </span>
              </td>
              <td class="align-center"><span class="cell-mono">{{ service.pid }}</span></td>
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
                  <button class="action-btn danger" title="结束进程" @click="handleKill(service)">
                    <t-icon name="close-circle" />
                  </button>
                  <button class="action-btn" title="强制结束" @click="handleForceKill(service)">
                    <t-icon name="poweroff" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="store.loading" class="table-loading">正在刷新…</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs';
import { useNodeServicesStore } from "../../stores/nodeServices";
import { useConfirm } from "../../composables/useConfirm";

const store = useNodeServicesStore();
const { confirm } = useConfirm();

const search = ref("");

const filteredServices = computed(() => {
  if (!search.value) return store.services;
  const keyword = search.value.toLowerCase();
  return store.services.filter(
    (s) =>
      String(s.port).includes(keyword) ||
      String(s.pid).includes(keyword) ||
      s.command?.toLowerCase().includes(keyword) ||
      s.address?.toLowerCase().includes(keyword),
  );
});

async function refresh() {
  await store.fetchServices();
  if (store.services.length > 0) {
    MessagePlugin.success({
      content: `发现 ${store.services.length} 个 Node 服务`,
      placement: "bottom-right",
    });
  }
}

async function handleKill(service) {
  const confirmed = await confirm({
    title: "结束进程",
    content: `确定结束 PID ${service.pid} 吗？`,
    detail: `${service.command} 占用端口 ${service.port}`,
  });
  if (!confirmed) return;

  const result = await store.killProcess(service.pid, "SIGTERM");
  if (result.ok) {
    MessagePlugin.success({
      content: "已发送结束信号",
      placement: "bottom-right",
    });
    await refresh();
  } else {
    MessagePlugin.error({
      content: result.error || "操作失败",
      placement: "bottom-right",
    });
  }
}

async function handleForceKill(service) {
  const confirmed = await confirm({
    title: "强制结束",
    content: `确定强制结束 PID ${service.pid} 吗？`,
    detail: "强制结束不会给进程清理机会",
    theme: "warning",
  });
  if (!confirmed) return;

  const result = await store.killProcess(service.pid, "SIGKILL");
  if (result.ok) {
    MessagePlugin.success({
      content: "已强制结束进程",
      placement: "bottom-right",
    });
    await refresh();
  } else {
    MessagePlugin.error({
      content: result.error || "操作失败",
      placement: "bottom-right",
    });
  }
}

onMounted(() => {
  refresh();
});
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
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  transition: color var(--transition);
}

.node-search__clear:hover {
  color: var(--text-secondary);
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
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 28px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
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
  width: 120px;
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
</style>
