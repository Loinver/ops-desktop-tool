<template>
  <div class="page">
    <!-- 页头 -->
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">系统发布</h2>
        <p class="page-desc" v-if="connectionStatus?.success">
          <t-icon name="check-circle-filled" class="status-icon success" />
          {{ connectionStatus.message }}
        </p>
        <p class="page-desc" v-else-if="connectionStatus?.success === false">
          <t-icon name="close-circle-filled" class="status-icon error" />
          {{ connectionStatus.message }}
        </p>
      </div>
      <div class="header-actions">
        <select v-if="releaseProfiles.length" v-model="activeProfileId" class="profile-select" :disabled="syncing || savingSftpSettings" @change="switchReleaseProfile">
          <option v-for="profile in releaseProfiles" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
        </select>
        <button class="btn-settings profile-add" title="新建发布环境" :disabled="syncing || savingSftpSettings" @click="startNewReleaseProfile"><t-icon name="add" /><span>新建环境</span></button>
        <button class="btn-settings" :disabled="syncing || savingSftpSettings" @click="openReleaseHistory"><t-icon name="history" /><span>发布历史</span></button>
        <button class="btn-settings" :disabled="syncing || savingSftpSettings" @click="openExistingSftpSettings">
          <t-icon name="setting" />
          <span>连接设置</span>
        </button>
        <button class="btn-refresh" @click="refresh" :disabled="refreshing || syncing || savingSftpSettings">
          <t-icon name="refresh" :class="{ spinning: refreshing }" />
          <span>刷新</span>
        </button>
      </div>
    </div>

    <div
      v-if="showSftpSettings"
      class="sftp-modal-mask"
    >
      <form class="sftp-settings-dialog" @submit.prevent="saveSftpSettings">
        <div class="sftp-dialog-header">
          <div>
            <h3>发布设置</h3>
            <p>连接和目录配置会保存在本机，下次进入时自动读取。</p>
          </div>
          <button
            type="button"
            class="sftp-icon-button"
            title="关闭"
            @click="closeSftpSettings"
          >
            <t-icon name="close" />
          </button>
        </div>

        <div class="sftp-settings-body">
          <p
            v-if="sftpConfigSource === 'environment'"
            class="sftp-settings-hint"
          >
            当前连接使用环境变量配置；保存的配置会在未设置环境变量时生效。
          </p>
          <div class="sftp-settings-grid">
            <label class="sftp-form-field sftp-field-name">
              <span>环境名称 <em>*</em></span>
              <input v-model.trim="profileSettings.name" type="text" placeholder="例如：生产环境 / 预发布" required />
            </label>
            <label class="sftp-form-field sftp-field-host">
              <span>服务器地址 <em>*</em></span>
              <input
                v-model.trim="sftpSettings.host"
                type="text"
                placeholder="例如：example.com 或 192.168.1.10"
                autocomplete="off"
                required
              />
            </label>
            <label class="sftp-form-field sftp-field-port">
              <span>端口</span>
              <input
                v-model.number="sftpSettings.port"
                type="number"
                min="1"
                max="65535"
                placeholder="22"
                required
              />
            </label>
            <label class="sftp-form-field sftp-field-username">
              <span>用户名 <em>*</em></span>
              <input
                v-model.trim="sftpSettings.username"
                type="text"
                placeholder="用户名"
                autocomplete="username"
                required
              />
            </label>
            <label class="sftp-form-field sftp-field-password">
              <span>密码</span>
              <input
                v-model="sftpSettings.password"
                type="password"
                :placeholder="sftpSettings.hasPassword ? `${sftpSettings.passwordMasked}（留空表示不修改）` : '密码（如使用 SSH Agent 可留空）'"
                autocomplete="current-password"
                @input="sftpSettings.clearPassword = false"
              />
              <small v-if="sftpSettings.hasPassword" class="sftp-secret-hint">
                密码已由系统安全存储加密保存。
              </small>
              <div v-if="sftpSettings.hasPassword" class="sftp-clear-secret">
                <input v-model="sftpSettings.clearPassword" type="checkbox" />
                <span>清除已保存密码</span>
              </div>
            </label>
            <div class="sftp-settings-section-title">发布目录</div>
            <label class="sftp-form-field sftp-field-local-dir">
              <span>本地目录 <em>*</em></span>
              <div class="sftp-path-field">
                <input
                  v-model.trim="sftpPathSettings.localDir"
                  type="text"
                  placeholder="请选择或输入本地构建目录"
                  required
                />
                <button
                  type="button"
                  class="sftp-path-browse"
                  title="选择本地目录"
                  @click="browseSettingsLocalDir"
                >
                  <t-icon name="folder-open" />
                </button>
              </div>
            </label>
            <label class="sftp-form-field sftp-field-remote-dir">
              <span>服务器目录 <em>*</em></span>
              <input
                v-model.trim="sftpPathSettings.remoteDir"
                type="text"
                placeholder="例如：/home/app/dist"
                required
              />
            </label>
            <div class="sftp-settings-section-title">忽略规则</div>
            <label class="sftp-form-field sftp-field-ignore">
              <span>每行一条，支持 *、**、? 和 ! 反向规则</span>
              <textarea v-model="profileSettings.ignoreText" rows="3" placeholder="node_modules/
*.log
*.map"></textarea>
            </label>
          </div>
        </div>

        <div class="sftp-dialog-footer">
          <button v-if="profileSettings.id && releaseProfiles.length > 1" type="button" class="sftp-btn-danger" @click="removeCurrentProfile">删除环境</button>
          <span class="sftp-dialog-spacer"></span>
          <button type="button" class="sftp-btn-secondary" @click="closeSftpSettings">取消</button>
          <button
            type="submit"
            class="sftp-btn-primary"
            :disabled="savingSftpSettings"
          >
            <t-icon v-if="savingSftpSettings" name="loading" class="spinning" />
            {{ savingSftpSettings ? "保存中..." : "保存并连接" }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="showReleaseHistory" class="sftp-modal-mask">
      <div class="release-history-dialog">
        <div class="sftp-dialog-header"><div><h3>{{ activeReleaseProfileName }} · 发布历史</h3><p>仅显示当前发布环境的记录；成功发布会保留远端备份，可一键回滚。</p></div><button class="sftp-icon-button" @click="showReleaseHistory = false"><t-icon name="close" /></button></div>
        <div class="release-history-list">
          <div v-for="item in releaseHistory" :key="item.id" class="release-history-item">
            <span class="release-status" :class="item.status"></span>
            <div><strong>{{ item.label }}</strong><p>{{ item.profileName || '默认环境' }} · {{ item.remoteDir }}</p><small>{{ formatTime(item.finishedAt) }} · {{ item.message }}</small></div>
            <button v-if="item.status === 'success' && item.backupPath" :disabled="rollingBackId === item.id" @click="rollbackRelease(item)">{{ rollingBackId === item.id ? '回滚中…' : '一键回滚' }}</button>
          </div>
          <div v-if="!releaseHistory.length" class="log-empty">暂无发布历史</div>
        </div>
      </div>
    </div>

    <!-- 路径栏 -->
    <div class="path-bar">
      <div class="path-group">
        <label>本地</label>
        <div class="path-select">
          <input
            v-model.trim="localDir"
            type="text"
            class="path-input"
            @keyup.enter="applyLocalDir"
          />
          <button
            class="browse-btn"
            title="选择并保存本地目录"
            @click="browseLocalDir()"
          >
            <t-icon name="folder-open" />
          </button>
          <button class="go-btn" @click="applyLocalDir">应用</button>
        </div>
      </div>
      <div class="path-group">
        <label>服务器</label>
        <div class="path-select">
          <input
            v-model="currentPath"
            type="text"
            class="path-input"
            @keyup.enter="navigateTo(currentPath)"
          />
          <button class="go-btn" @click="navigateTo(currentPath)">应用</button>
        </div>
      </div>
    </div>

    <!-- 统一对比表格 -->
    <div class="compare-container">
      <!-- 加载中 -->
      <div v-if="loading || localLoading" class="loading-state">
        <div class="loading-spinner"></div>
        <span>加载中...</span>
      </div>

      <!-- 空状态 -->
      <div v-else-if="mergedRows.length === 0" class="empty-state">
        <t-icon name="folder-open" />
        <span>无文件</span>
      </div>

      <!-- 表格 -->
      <div v-else class="compare-scroll">
        <!-- 表头 -->
        <div class="compare-header">
          <div class="col-name">本地文件</div>
          <div class="col-time">修改时间</div>
          <div class="col-status"></div>
          <div class="col-time">修改时间</div>
          <div class="col-name">服务器文件</div>
          <div class="col-action"></div>
        </div>

        <!-- 表体 -->
        <div class="compare-body">
          <div
            v-for="row in mergedRows"
            :key="row.key"
            :class="['compare-row', row.status]"
          >
            <!-- 本地文件 -->
            <div class="col-name">
              <div class="cell-file" v-if="row.local">
                <t-icon
                  :name="row.local.type === 'directory' ? 'folder' : 'file'"
                  class="file-icon"
                />
                <span class="file-name">{{ row.local.name }}</span>
              </div>
            </div>
            <div class="col-time">
              <span v-if="row.local" class="time-text">{{
                formatTime(row.local.modifyTime)
              }}</span>
            </div>

            <!-- 状态 + 操作 -->
            <div class="col-status">
              <template v-if="row.status === 'only-local'">
                <button
                  class="status-btn publish"
                  @click="deploySingleFile(row.local)"
                  title="发布到服务器"
                >
                  <t-icon name="arrow-right" />
                </button>
              </template>
              <template v-else-if="row.status === 'modified'">
                <button
                  class="status-btn update"
                  @click="deploySingleFile(row.local)"
                  title="更新到服务器"
                >
                  <t-icon name="refresh" />
                </button>
              </template>
              <template v-else-if="row.status === 'only-remote'">
                <button
                  class="status-btn delete"
                  @click="confirmDelete(row.remote)"
                  :disabled="syncing"
                  title="同步队列执行时不能删除"
                >
                  <t-icon name="delete" />
                </button>
              </template>
              <template v-else>
                <t-icon name="check" class="synced-icon" />
              </template>
            </div>

            <!-- 远程文件 -->
            <div class="col-time">
              <span v-if="row.remote" class="time-text">{{
                row.remote.modifyTimeFormatted
              }}</span>
            </div>
            <div class="col-name">
              <div class="cell-file" v-if="row.remote">
                <t-icon
                  :name="row.remote.type === 'directory' ? 'folder' : 'file'"
                  class="file-icon"
                />
                <span class="file-name">{{ row.remote.name }}</span>
              </div>
            </div>

            <!-- 操作 -->
            <div class="col-action">
              <button
                v-if="
                  row.status === 'only-local' && row.local?.type === 'directory'
                "
                class="deploy-folder-btn"
                @click="deployFolder(row.local)"
                title="部署文件夹到服务器"
              >
                <t-icon name="upload" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="bottom-bar">
      <!-- 同步中：显示进度 -->
      <div v-if="syncing" class="sync-progress">
        <div class="sync-progress-info">
          <div class="loading-spinner small"></div>
          <span class="sync-progress-label">同步进行中</span>
          <span class="sync-progress-count" v-if="syncProgress.total > 0">
            {{ syncProgress.current }}/{{ syncProgress.total }} · {{ syncPercent }}%
          </span>
          <span class="sync-queue-count" v-if="queuedSyncCount > 0">
            待执行 {{ queuedSyncCount }} 项
          </span>
        </div>
        <div class="sync-progress-track">
          <div
            class="sync-progress-fill"
            :class="{ indeterminate: syncProgress.total === 0 }"
            :style="syncProgress.total > 0 ? { width: syncPercent + '%' } : {}"
          ></div>
        </div>
      </div>

      <!-- 空闲：显示统计与操作 -->
      <template v-else>
        <div class="stats">
          <span class="stat-item">
            <span class="stat-dot local"></span>
            仅本地: {{ summary.onlyLocal }}
          </span>
          <span class="stat-item">
            <span class="stat-dot modified"></span>
            已修改: {{ summary.modified }}
          </span>
          <span class="stat-item">
            <span class="stat-dot synced"></span>
            已同步: {{ summary.synced }}
          </span>
          <span class="stat-item">
            <span class="stat-dot remote"></span>
            仅远程: {{ summary.onlyRemote }}
          </span>
        </div>
        <div class="actions">
          <button
            v-if="summary.onlyLocal > 0"
            class="action-btn publish"
            @click="publishAll"
            :disabled="syncing"
          >
            <t-icon name="upload" />
            发布全部新增 ({{ summary.onlyLocal }})
          </button>
          <button
            v-if="summary.modified > 0"
            class="action-btn update"
            @click="updateAll"
            :disabled="syncing"
          >
            <t-icon name="refresh" />
            更新全部修改 ({{ summary.modified }})
          </button>
        </div>
      </template>
    </div>

    <!-- 同步日志面板：运行中、等待队列与最近任务记录分层展示 -->
    <div class="log-panel" :class="{ collapsed: !showLogPanel }">
      <div class="log-header" @click="showLogPanel = !showLogPanel">
        <div class="log-header-left">
          <t-icon name="file" />
          <span>同步日志</span>
          <span v-if="activeSyncTask" class="log-running-badge">同步中</span>
          <span v-if="queuedSyncCount > 0" class="log-queue-badge">
            待执行 {{ queuedSyncCount }}
          </span>
          <span v-if="retryableErrors.length > 0" class="log-error-badge">
            {{ retryableErrors.length }} 个失败
          </span>
        </div>
        <div class="log-header-right">
          <button
            v-if="retryableErrors.length > 0 && !syncing"
            class="log-retry-btn"
            @click.stop="retryFailedUploads"
            title="重新执行全部失败任务"
          >
            <t-icon name="refresh" />
            <span>重试失败</span>
          </button>
          <button
            v-if="syncHistory.length > 0 || syncErrors.length > 0"
            class="log-clear-btn"
            @click.stop="clearSyncLog"
            title="清空同步记录"
          >
            <t-icon name="delete" />
          </button>
          <t-icon :name="showLogPanel ? 'chevron-down' : 'chevron-up'" />
        </div>
      </div>

      <div v-if="showLogPanel" class="log-body">
        <div
          v-if="activeSyncTask || queuedSyncCount > 0 || syncHistory.length > 0"
          class="log-timeline"
        >
          <div v-if="activeSyncTask" class="log-timeline-item running">
            <t-icon name="play-circle-filled" class="log-timeline-icon" />
            <div class="log-timeline-content">
              <div class="log-timeline-title">
                <span class="log-timeline-label">{{ activeSyncTask.label }}</span>
                <span class="log-task-type">{{ taskTypeLabel(activeSyncTask.type) }}</span>
              </div>
              <p class="log-timeline-message">
                {{ syncMessage || "正在准备同步任务..." }}
              </p>
            </div>
            <span v-if="syncProgress.total > 0" class="log-timeline-meta">
              {{ syncProgress.current }}/{{ syncProgress.total }} · {{ syncPercent }}%
            </span>
          </div>

          <div
            v-for="(task, index) in syncQueue"
            :key="task.id"
            class="log-timeline-item queued"
          >
            <span class="log-queue-position">{{ index + 1 }}</span>
            <div class="log-timeline-content">
              <div class="log-timeline-title">
                <span class="log-timeline-label">{{ task.label }}</span>
                <span class="log-task-type">{{ taskTypeLabel(task.type) }}</span>
              </div>
              <p class="log-timeline-message">等待前方任务完成后自动执行</p>
            </div>
            <span class="log-timeline-meta">排队中</span>
          </div>

          <div
            v-for="entry in syncHistory"
            :key="entry.id"
            class="log-timeline-item"
            :class="entry.status"
          >
            <t-icon
              :name="entry.status === 'success' ? 'check-circle-filled' : 'close-circle-filled'"
              class="log-timeline-icon"
            />
            <div class="log-timeline-content">
              <div class="log-timeline-title">
                <span class="log-timeline-label">{{ entry.label }}</span>
                <span class="log-task-type">{{ taskTypeLabel(entry.type) }}</span>
              </div>
              <p class="log-timeline-message">{{ entry.message }}</p>
            </div>
            <time class="log-timeline-meta">{{ formatLogTime(entry.timestamp) }}</time>
            <button
              v-if="canRetryHistoryEntry(entry)"
              class="log-item-retry"
              @click="retryHistoryEntry(entry)"
              title="重新执行此任务"
            >
              <t-icon name="refresh" />
            </button>
          </div>
        </div>

        <div
          v-else
          class="log-empty"
        >
          暂无同步任务；开始发布或更新后，任务进度和结果会显示在这里。
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, shallowRef, computed, onMounted } from "vue";
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs';

defineOptions({
  name: "SystemRelease",
});

const LEGACY_RELEASE_PATHS_STORAGE_KEY = "ops-desktop.release-paths";
let legacyPathsNoticeShown = false;

const loading = ref(false);
const localLoading = ref(false);
const refreshing = ref(false);
const currentPath = ref("");
const localDir = ref("");
// fileList / localFiles 用 shallowRef 持有从 IPC 回来的纯 JS 数组，
// 避免子元素被包成 reactive Proxy 后无法通过 IPC 的 structuredClone。
// 数组替换通过整体赋值完成，不要 .push / .splice 否则 Vue 会再 wrap 一层。
const fileList = shallowRef([]);
const localFiles = shallowRef([]);
// 目录请求可能因网络延迟乱序返回；只允许最后一次请求更新界面与持久化路径。
let remoteDirectoryLoadGeneration = 0;
let localDirectoryLoadGeneration = 0;
const connectionStatus = ref(null);
const showSftpSettings = ref(false);
const savingSftpSettings = ref(false);
const sftpConfigSource = ref(null);
const releaseProfiles = ref([]);
const activeProfileId = ref("");
const showReleaseHistory = ref(false);
const releaseHistory = ref([]);
const rollingBackId = ref("");
const creatingProfile = ref(false);
const profileSettings = reactive({ id: "", name: "默认环境", ignoreText: ".DS_Store\nThumbs.db\n.git/\nnode_modules/\n*.log" });
const activeIgnoreRules = ref([".DS_Store", "Thumbs.db", ".git/", "node_modules/", "*.log"]);
const activeReleaseProfileName = computed(() =>
  releaseProfiles.value.find((item) => item.id === activeProfileId.value)?.name || "当前环境",
);
const sftpSettings = reactive({
  host: "",
  port: 22,
  username: "",
  password: "",
  hasPassword: false,
  passwordMasked: "",
  clearPassword: false,
});
const sftpPathSettings = reactive({
  localDir: "",
  remoteDir: "",
});

// 同步相关
const syncing = ref(false);
const syncMessage = ref("");
const syncErrors = ref([]);
const syncHistory = ref([]);
const syncProgress = ref({ current: 0, total: 0 });
const showLogPanel = ref(true);

// 所有同步请求都经过同一个 FIFO 队列：用户可在 A 打包/上传期间继续选择 B，
// B 会使用点击时的路径快照，在 A 完成后再执行，不会与 A 争用同一条 SFTP 连接。
const syncQueue = ref([]);
const activeSyncTask = ref(null);
const queueRunning = ref(false);
const queuedSyncCount = computed(() => syncQueue.value.length);
let nextSyncTaskId = 1;
let nextSyncErrorId = 1;
let nextSyncHistoryId = 1;
const MAX_SYNC_HISTORY = 30;

function taskTypeLabel(type) {
  return type === "zip" ? "打包部署" : "文件上传";
}

function formatLogTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

// 错误列表用于失败重试；最近记录则作为用户可见的任务日志，两者职责分开。
function addError(file, message, task = null) {
  const error = { id: nextSyncErrorId++, file, message, ...task };
  syncErrors.value.push(error);
  showLogPanel.value = true;
  return error;
}

function recordSyncHistory(task, status, message, error = null) {
  syncHistory.value.unshift({
    id: nextSyncHistoryId++,
    taskId: task.id,
    label: task.label,
    type: task.type,
    status,
    message,
    errorId: error?.id || null,
    timestamp: Date.now(),
  });
  if (syncHistory.value.length > MAX_SYNC_HISTORY) {
    syncHistory.value.length = MAX_SYNC_HISTORY;
  }
}

// 新的一轮同步不再抹去已完成记录，只清除旧失败的重试状态。
function clearErrors() {
  syncErrors.value = [];
}

function clearSyncLog() {
  syncErrors.value = [];
  syncHistory.value = [];
}

// 更新进度
function updateProgress(current, total) {
  syncProgress.value = { current, total };
}

// 同步进度百分比
const syncPercent = computed(() => {
  const { current, total } = syncProgress.value;
  if (!total) return 0;
  return Math.min(100, Math.round((current / total) * 100));
});

const retryableErrors = computed(() =>
  syncErrors.value.filter(
    (err) => err.zipDeploy || (err.localPath && err.remotePath),
  ),
);

function canRetryHistoryEntry(entry) {
  return (
    !syncing.value &&
    entry.status === "failed" &&
    syncErrors.value.some((error) => error.id === entry.errorId)
  );
}

function retryHistoryEntry(entry) {
  const error = syncErrors.value.find((item) => item.id === entry.errorId);
  if (error) void retryFailedUpload(error);
}

// 构建合并行：两侧文件按名称对齐，同一行显示
// fileList/localFiles 是 shallowRef，元素不会被 wrap 成 reactive Proxy，
// 可以直接走 IPC 而无需再 JSON.parse(JSON.stringify(...))。
const mergedRows = computed(() => {
  const localMap = new Map(localFiles.value.map((f) => [f.name, f]));
  const remoteMap = new Map(fileList.value.map((f) => [f.name, f]));

  // 收集所有文件名并排序
  const allNames = new Set([...localMap.keys(), ...remoteMap.keys()]);
  const sorted = [...allNames].sort((a, b) => a.localeCompare(b));

  return sorted.map((name) => {
    const local = localMap.get(name) || null;
    const remote = remoteMap.get(name) || null;

    let status = "synced";
    if (local && !remote) status = "only-local";
    else if (!local && remote) status = "only-remote";
    else if (local && remote) {
      // 比较大小和修改时间判断是否已修改
      if (
        local.size !== remote.size ||
        local.modifyTime > (remote.modifyTime || 0)
      ) {
        status = "modified";
      }
    }

    return { key: name, local, remote, status };
  });
});

const summary = computed(() => {
  const rows = mergedRows.value;
  return {
    onlyLocal: rows.filter((r) => r.status === "only-local").length,
    onlyRemote: rows.filter((r) => r.status === "only-remote").length,
    modified: rows.filter((r) => r.status === "modified").length,
    synced: rows.filter((r) => r.status === "synced").length,
  };
});

function formatTime(timestamp) {
  if (!timestamp) return "-";
  const ts = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(ts);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}/${m}/${d} ${h}:${min}:${s}`;
}

function normalizeReleasePaths(paths = {}) {
  const localDir = String(paths.localDir || "").trim();
  const rawRemoteDir = String(paths.remoteDir || "").trim();
  const remoteDir = rawRemoteDir
    ? cleanPath(
        rawRemoteDir.startsWith("/") ? rawRemoteDir : `/${rawRemoteDir}`,
      )
    : "";
  return { localDir, remoteDir };
}

function readLegacyReleasePaths() {
  try {
    return normalizeReleasePaths(
      JSON.parse(localStorage.getItem(LEGACY_RELEASE_PATHS_STORAGE_KEY) || "{}"),
    );
  } catch {
    return { localDir: "", remoteDir: "" };
  }
}

function writeLegacyReleasePaths(paths) {
  localStorage.setItem(
    LEGACY_RELEASE_PATHS_STORAGE_KEY,
    JSON.stringify(normalizeReleasePaths(paths)),
  );
}

function applyReleasePaths(paths = {}) {
  const { localDir: savedLocalDir, remoteDir: savedRemoteDir } = paths;
  // 环境切换时必须整体覆盖，避免新环境缺少配置时沿用上一个环境的目录。
  localDir.value = savedLocalDir || "";
  currentPath.value = savedRemoteDir || "";
}

function notifyLegacyPathsFallback() {
  if (legacyPathsNoticeShown) return;
  legacyPathsNoticeShown = true;
  MessagePlugin.warning({
    content: "目录已保存到本地缓存；请重启桌面应用以启用应用配置同步",
    placement: "bottom-right",
  });
}

async function loadSftpPaths({ showError = false } = {}) {
  if (typeof window.opsApi?.getSftpPaths !== "function") {
    const savedPaths = readLegacyReleasePaths();
    applyReleasePaths(savedPaths);
    return Boolean(savedPaths.localDir && savedPaths.remoteDir);
  }

  try {
    const result = await window.opsApi.getSftpPaths();
    if (!result.success) throw new Error(result.error || "读取发布目录配置失败");

    applyReleasePaths(result.data);
    return true;
  } catch (err) {
    if (showError) {
      MessagePlugin.error({
        content: err.message || "读取发布目录配置失败",
        placement: "bottom-right",
      });
    }
    return false;
  }
}

async function saveSftpPaths({ showSuccess = false, paths = null } = {}) {
  const nextPaths = normalizeReleasePaths(
    paths || {
      localDir: localDir.value,
      remoteDir: currentPath.value,
    },
  );
  if (!nextPaths.localDir || !nextPaths.remoteDir) {
    MessagePlugin.error({
      content: "请填写本地目录和服务器目录",
      placement: "bottom-right",
    });
    return false;
  }

  if (typeof window.opsApi?.saveSftpPaths !== "function") {
    try {
      writeLegacyReleasePaths(nextPaths);
      applyReleasePaths(nextPaths);
      notifyLegacyPathsFallback();
      return true;
    } catch (err) {
      MessagePlugin.error({
        content: err.message || "保存发布目录配置失败",
        placement: "bottom-right",
      });
      return false;
    }
  }

  try {
    const result = await window.opsApi.saveSftpPaths(nextPaths);
    if (!result.success) throw new Error(result.error || "保存发布目录配置失败");

    applyReleasePaths(result.data);
    if (showSuccess) {
      MessagePlugin.success({
        content: "发布目录已保存",
        placement: "bottom-right",
      });
    }
    return true;
  } catch (err) {
    MessagePlugin.error({
      content: err.message || "保存发布目录配置失败",
      placement: "bottom-right",
    });
    return false;
  }
}

async function loadReleaseProfiles() {
  if (typeof window.opsApi?.getSftpProfiles !== "function") return;
  const result = await window.opsApi.getSftpProfiles();
  if (!result.success) return;
  releaseProfiles.value = result.data?.profiles || [];
  activeProfileId.value = result.data?.activeProfileId || "";
  const active = releaseProfiles.value.find((item) => item.id === activeProfileId.value);
  if (active) {
    applyReleasePaths(active);
    activeIgnoreRules.value = active.ignoreRules || [];
  }
}

async function switchReleaseProfile() {
  if (syncing.value || savingSftpSettings.value) {
    MessagePlugin.info({ content: "同步任务执行中，暂不能切换发布环境", placement: "bottom-right" });
    await loadReleaseProfiles();
    return;
  }
  const result = await window.opsApi.activateSftpProfile(activeProfileId.value);
  if (!result.success) return MessagePlugin.error({ content: result.error, placement: "bottom-right" });
  applyReleasePaths(result.data);
  activeIgnoreRules.value = result.data.ignoreRules || [];
  // 发布历史与环境绑定；切换环境后不能继续显示或回滚旧环境的记录。
  releaseHistory.value = [];
  showReleaseHistory.value = false;
  connectionStatus.value = null;
  await refresh();
}

async function openReleaseHistory() {
  if (syncing.value || savingSftpSettings.value) {
    MessagePlugin.info({ content: "同步任务执行中，暂不能查看发布历史", placement: "bottom-right" });
    return;
  }
  const result = await window.opsApi.getSftpHistory();
  if (!result.success) return MessagePlugin.error({ content: result.error, placement: "bottom-right" });
  releaseHistory.value = result.data || [];
  showReleaseHistory.value = true;
}

async function rollbackRelease(item) {
  const confirmed = await window.opsApi.confirm({ title: "确认回滚", message: `确定回滚“${item.label}”吗？`, detail: "将恢复该次发布前的远端文件。" });
  if (!confirmed) return;
  rollingBackId.value = item.id;
  try {
    const result = await window.opsApi.rollbackSftpRelease(item.id);
    if (!result.success) throw new Error(result.error || "回滚失败");
    MessagePlugin.success({ content: result.message, placement: "bottom-right" });
    await openReleaseHistory();
    await refresh();
  } catch (error) { MessagePlugin.error({ content: error.message, placement: "bottom-right" }); }
  finally { rollingBackId.value = ""; }
}

async function startNewReleaseProfile() {
  if (syncing.value || savingSftpSettings.value) {
    MessagePlugin.info({ content: "同步任务执行中，暂不能新建发布环境", placement: "bottom-right" });
    return;
  }
  creatingProfile.value = true;
  await openSftpSettings();
  Object.assign(profileSettings, { id: "", name: `新环境 ${releaseProfiles.value.length + 1}` });
  Object.assign(sftpSettings, { password: "", hasPassword: false, passwordMasked: "", clearPassword: false });
}

async function removeCurrentProfile() {
  const confirmed = await window.opsApi.confirm({ title: "删除发布环境", message: `确定删除“${profileSettings.name}”吗？` });
  if (!confirmed) return;
  const result = await window.opsApi.deleteSftpProfile(profileSettings.id);
  if (!result.success) return MessagePlugin.error({ content: result.error, placement: "bottom-right" });
  showSftpSettings.value = false;
  creatingProfile.value = false;
  await loadReleaseProfiles();
  await refresh();
}

async function openExistingSftpSettings() {
  if (syncing.value || savingSftpSettings.value) {
    MessagePlugin.info({ content: "同步任务执行中，暂不能修改连接设置", placement: "bottom-right" });
    return;
  }
  creatingProfile.value = false;
  await openSftpSettings();
}

async function openSftpSettings() {
  Object.assign(sftpPathSettings, {
    localDir: localDir.value,
    remoteDir: currentPath.value,
  });
  const activeProfile = creatingProfile.value ? null : releaseProfiles.value.find((item) => item.id === activeProfileId.value);
  Object.assign(profileSettings, {
    id: activeProfile?.id || "",
    name: activeProfile?.name || "默认环境",
    ignoreText: (activeProfile?.ignoreRules || activeIgnoreRules.value).join("\n"),
  });
  try {
    const result = await window.opsApi.getSftpConfig();
    if (result.success) {
      const { config = {}, source = null } = result.data || {};
      Object.assign(sftpSettings, {
        host: config.host || "",
        port: Number(config.port) || 22,
        username: config.username || "",
        password: "",
        hasPassword: Boolean(config.hasPassword),
        passwordMasked: config.passwordMasked || "",
        clearPassword: false,
      });
      sftpConfigSource.value = source;
    } else {
      MessagePlugin.error({
        content: result.error || "读取 SFTP 配置失败",
        placement: "bottom-right",
      });
    }
  } catch (err) {
    MessagePlugin.error({
      content: err.message || "读取 SFTP 配置失败",
      placement: "bottom-right",
    });
  }
  showSftpSettings.value = true;
}

function closeSftpSettings() {
  if (!savingSftpSettings.value) showSftpSettings.value = false;
}

async function browseSettingsLocalDir() {
  try {
    const result = await window.opsApi.browseFile({
      directory: true,
      defaultPath: sftpPathSettings.localDir || localDir.value,
    });
    if (result) sftpPathSettings.localDir = result;
  } catch (err) {
    MessagePlugin.error({
      content: err.message || "选择本地目录失败",
      placement: "bottom-right",
    });
  }
}

async function saveSftpSettings() {
  savingSftpSettings.value = true;
  try {
    // 在 IPC 边界显式构造普通对象。不要直接传 reactive() 对象，否则 Electron
    // 无法 structured-clone Vue Proxy，进而报 “An object could not be cloned”。
    const profilePayload = {
      id: String(profileSettings.id || ""),
      name: String(profileSettings.name || ""),
      host: String(sftpSettings.host || ""),
      port: Number(sftpSettings.port) || 22,
      username: String(sftpSettings.username || ""),
      password: String(sftpSettings.password || ""),
      clearPassword: Boolean(sftpSettings.clearPassword),
      localDir: String(sftpPathSettings.localDir || ""),
      remoteDir: String(sftpPathSettings.remoteDir || ""),
      ignoreRules: String(profileSettings.ignoreText || "")
        .split(/\r?\n/)
        .map((rule) => rule.trim())
        .filter(Boolean),
    };
    const result = typeof window.opsApi?.saveSftpProfile === "function"
      ? await window.opsApi.saveSftpProfile(profilePayload)
      : await window.opsApi.saveSftpConfig({
          host: profilePayload.host,
          port: profilePayload.port,
          username: profilePayload.username,
          password: profilePayload.password,
          clearPassword: profilePayload.clearPassword,
        });
    if (!result.success) {
      MessagePlugin.error({ content: result.error || "保存发布环境失败", placement: "bottom-right" });
      return;
    }
    if (result.data?.id) {
      await loadReleaseProfiles();
      activeProfileId.value = result.data.id;
      activeIgnoreRules.value = result.data.ignoreRules || [];
    }
    Object.assign(sftpSettings, {
      password: "",
      hasPassword: Boolean(result.data?.hasPassword),
      passwordMasked: result.data?.passwordMasked || "",
      clearPassword: false,
    });

    // profile 保存 IPC 已在写入前一次性校验并持久化本地/远端目录；
    // 不再拆成第二次 paths 保存，避免出现“连接已保存、路径保存失败”的半成功状态。
    applyReleasePaths(result.data || profilePayload);

    const testResult = await window.opsApi.sftpTest();
    if (!testResult.success) {
      connectionStatus.value = { success: false, message: testResult.error };
      MessagePlugin.error({
        content: `配置已保存，但连接失败：${testResult.error}`,
        placement: "bottom-right",
      });
      return;
    }

    connectionStatus.value = { success: true, message: testResult.message };
    showSftpSettings.value = false;
    creatingProfile.value = false;
    MessagePlugin.success({
      content: "SFTP 已连接",
      placement: "bottom-right",
    });
    await refresh();
  } catch (err) {
    connectionStatus.value = { success: false, message: err.message };
    MessagePlugin.error({
      content: err.message || "保存 SFTP 配置失败",
      placement: "bottom-right",
    });
  } finally {
    savingSftpSettings.value = false;
  }
}

// 加载远程目录。连续切换目录时旧请求可能晚返回，必须忽略它，
// 否则会把文件列表和保存的发布路径回退到过期目录。
async function loadDirectory(dirPath) {
  const requestId = ++remoteDirectoryLoadGeneration;
  loading.value = true;
  try {
    const result = await window.opsApi.sftpList(dirPath);
    if (requestId !== remoteDirectoryLoadGeneration) return false;
    if (result.success) {
      currentPath.value = result.data.currentPath;
      // 过滤掉不需要显示的文件
      fileList.value = result.data.items.filter((item) => {
        if (item.name.endsWith(".tar.gz")) return false;
        if (item.name.endsWith(".tar")) return false;
        if (item.name.endsWith(".gz")) return false;
        return true;
      });
      return true;
    }
    connectionStatus.value = { success: false, message: result.error };
    return false;
  } catch (err) {
    if (requestId !== remoteDirectoryLoadGeneration) return false;
    connectionStatus.value = { success: false, message: err.message };
    return false;
  } finally {
    if (requestId === remoteDirectoryLoadGeneration) loading.value = false;
  }
}

// 加载本地目录，同样避免旧请求覆盖用户刚选择的新目录。
async function loadLocalDir() {
  const requestId = ++localDirectoryLoadGeneration;
  const requestedLocalDir = localDir.value;
  localLoading.value = true;
  try {
    const result = await window.opsApi.sftpLocalList(requestedLocalDir);
    if (requestId !== localDirectoryLoadGeneration) return false;
    if (result.success) {
      // 过滤掉不需要显示的文件
      localFiles.value = result.data.items.filter((item) => {
        if (item.name === ".DS_Store") return false;
        if (item.name === "Thumbs.db") return false;
        return true;
      });
      return true;
    }
    MessagePlugin.error({
      content: result.error || "加载本地目录失败",
      placement: "bottom-right",
    });
    return false;
  } catch (err) {
    if (requestId !== localDirectoryLoadGeneration) return false;
    MessagePlugin.error({
      content: err.message || "加载本地目录失败",
      placement: "bottom-right",
    });
    return false;
  } finally {
    if (requestId === localDirectoryLoadGeneration) localLoading.value = false;
  }
}

async function navigateTo(dirPath) {
  const normalizedPath = String(dirPath || "")
    .trim()
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";
  const loaded = await loadDirectory(normalizedPath);
  if (loaded) await saveSftpPaths();
}

async function refresh() {
  refreshing.value = true;
  try {
    await Promise.all([loadDirectory(currentPath.value), loadLocalDir()]);
  } finally {
    refreshing.value = false;
  }
}

async function applyLocalDir() {
  const loaded = await loadLocalDir();
  if (loaded) await saveSftpPaths();
}

async function browseLocalDir({ save = true } = {}) {
  try {
    const result = await window.opsApi.browseFile({
      directory: true,
      defaultPath: localDir.value,
    });
    if (result) {
      localDir.value = result;
      const loaded = await loadLocalDir();
      if (save && loaded) await saveSftpPaths({ showSuccess: true });
    }
  } catch (err) {
    MessagePlugin.error({
      content: err.message || "选择本地目录失败",
      placement: "bottom-right",
    });
  }
}

// 清空远程目录
async function clearRemoteDir(remotePath) {
  try {
    const result = await window.opsApi.sftpList(remotePath);
    if (result.success) {
      for (const item of result.data.items) {
        await window.opsApi.sftpDelete(item.path);
      }
    }
  } catch (err) {
    // 忽略
  }
}

// 清理路径中的双斜杠
function cleanPath(p) {
  return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function remoteDirname(p) {
  const cleaned = cleanPath(p);
  const index = cleaned.lastIndexOf("/");
  return index <= 0 ? "/" : cleaned.slice(0, index);
}

// 确保远程目录存在（递归创建）
async function ensureRemoteDir(remotePath) {
  const cleaned = cleanPath(remotePath);
  // sftpList 失败时返回 { success: false }（不会 throw），需显式判断
  const result = await window.opsApi.sftpList(cleaned);
  if (result && result.success) return;

  // 目录不存在，递归创建（sftpMkdir 内部为 recursive）
  const r = await window.opsApi.sftpMkdir(cleaned);
  if (r && r.success === false) {
    addError(cleaned, `创建目录失败: ${r.error || "未知错误"}`);
  }
}

function isIgnoredLocalFile(name) {
  return name === ".DS_Store" || name === "Thumbs.db";
}

// 递归统计实际需要上传的文件数
async function countUploadFiles(localPath) {
  const result = await window.opsApi.sftpLocalList(localPath);
  if (!result.success) {
    throw new Error(result.error || `读取本地目录失败: ${localPath}`);
  }

  let total = 0;
  for (const item of result.data.items) {
    if (isIgnoredLocalFile(item.name)) continue;
    if (item.type === "directory") {
      total += await countUploadFiles(cleanPath(localPath + "/" + item.name));
    } else {
      total++;
    }
  }
  return total;
}

async function countRowsUploadFiles(rows) {
  let total = 0;
  for (const row of rows) {
    if (row.local.type === "directory") {
      total += await countUploadFiles(
        cleanPath(localDir.value + "/" + row.local.name),
      );
    } else {
      total++;
    }
  }
  return total;
}

async function uploadFile(localPath, remotePath, fileName) {
  try {
    const result = await window.opsApi.sftpUpload(localPath, remotePath);
    if (!result.success) {
      addError(fileName, result.error, { localPath, remotePath });
      return false;
    }
    return true;
  } catch (err) {
    addError(fileName, err.message, { localPath, remotePath });
    return false;
  }
}

function createZipDeployPayload(
  entries,
  remoteDir,
  clearRemotePaths = [],
  { ignoreRules = [], label = "" } = {},
) {
  // syncQueue 是深度响应式 ref；任务从队列取出后 entries、ignoreRules 等可能成为
  // Vue Proxy。Electron IPC 只能传递 structured-clone 支持的数据，因此每一次
  // 调用（预检和 ZIP 部署）都在此处重建纯数据请求，不能直接传入任务对象或其数组。
  return {
    entries: Array.from(entries || [], (entry) => ({
      localPath: cleanPath(String(entry?.localPath || "")),
      archivePath: String(entry?.archivePath || "").replace(/^\/+/, ""),
    })),
    remoteDir: cleanPath(String(remoteDir || "/")),
    clearRemotePaths: Array.from(clearRemotePaths || [], (remotePath) =>
      cleanPath(String(remotePath || "/")),
    ),
    ignoreRules: Array.from(ignoreRules || [], (rule) => String(rule)),
    label: String(label || ""),
  };
}

async function deployZip(entries, remoteDir, clearRemotePaths, fileName, ignoreRules = activeIgnoreRules.value) {
  const payload = createZipDeployPayload(entries, remoteDir, clearRemotePaths, {
    ignoreRules,
    label: fileName,
  });

  try {
    const result = await window.opsApi.sftpDeployZip(payload);
    if (!result.success) {
      addError(fileName, result.error, {
        zipDeploy: true,
        entries,
        remoteDir: cleanPath(remoteDir),
        clearRemotePaths: clearRemotePaths.map(cleanPath),
      });
      return false;
    }
    return true;
  } catch (err) {
    addError(fileName, err.message, {
      zipDeploy: true,
      entries,
      remoteDir: cleanPath(remoteDir),
      clearRemotePaths: clearRemotePaths.map(cleanPath),
    });
    return false;
  }
}

// 递归上传文件夹
async function uploadFolder(localPath, remotePath, progress) {
  // 确保远程目录存在
  await ensureRemoteDir(remotePath);

  const result = await window.opsApi.sftpLocalList(localPath);
  if (!result.success) {
    addError(localPath, `读取本地目录失败: ${result.error || "未知错误"}`);
    return;
  }

  for (const item of result.data.items) {
    // 跳过不需要上传的文件
    if (isIgnoredLocalFile(item.name)) continue;

    const itemLocalPath = cleanPath(localPath + "/" + item.name);
    const itemRemotePath = cleanPath(remotePath + "/" + item.name);

    if (item.type === "directory") {
      await uploadFolder(itemLocalPath, itemRemotePath, progress);
    } else {
      syncMessage.value = `上传: ${item.name}`;
      await uploadFile(itemLocalPath, itemRemotePath, item.name);
      progress.current++;
      updateProgress(progress.current, progress.total);
    }
  }
}

// 构建任务快照。不要在执行时读取 currentPath/localDir，避免用户切换目录后
// 已排队的任务被错误地部署到新位置。
function createZipSyncTask({
  label,
  entries,
  remoteDir,
  clearRemotePaths = [],
  total,
  successMessage,
}) {
  const normalizedRemoteDir = cleanPath(remoteDir);
  const normalizedEntries = entries.map((entry) => ({
    localPath: cleanPath(entry.localPath),
    archivePath: String(entry.archivePath || "").replace(/^\/+/, ""),
  }));
  const conflictKeys = [
    ...new Set(
      normalizedEntries.map((entry) => {
        const root = entry.archivePath.split("/")[0];
        return cleanPath(`${normalizedRemoteDir}/${root}`);
      }),
    ),
  ];

  return {
    id: nextSyncTaskId++,
    type: "zip",
    label,
    entries: normalizedEntries,
    remoteDir: normalizedRemoteDir,
    clearRemotePaths: clearRemotePaths.map(cleanPath),
    total: total || normalizedEntries.length || 1,
    successMessage,
    ignoreRules: [...activeIgnoreRules.value],
    conflictKeys,
  };
}

function createUploadSyncTask({
  label,
  localPath,
  remotePath,
  successMessage,
}) {
  return {
    id: nextSyncTaskId++,
    type: "upload",
    label,
    localPath: cleanPath(localPath),
    remotePath: cleanPath(remotePath),
    total: 1,
    successMessage,
    // 普通上传与 zip 部署写入相同远程文件时也不能并发。
    conflictKeys: [cleanPath(remotePath)],
  };
}

function syncTargetsOverlap(firstPath, secondPath) {
  return (
    firstPath === secondPath ||
    firstPath.startsWith(`${secondPath}/`) ||
    secondPath.startsWith(`${firstPath}/`)
  );
}

function findConflictingSyncTask(task) {
  const candidates = [activeSyncTask.value, ...syncQueue.value].filter(Boolean);
  return candidates.find((candidate) =>
    task.conflictKeys.some((taskTarget) =>
      candidate.conflictKeys.some((candidateTarget) =>
        syncTargetsOverlap(taskTarget, candidateTarget),
      ),
    ),
  );
}

function enqueueSyncTask(task, { preserveErrors = false } = {}) {
  const conflictingTask = findConflictingSyncTask(task);
  if (conflictingTask) {
    MessagePlugin.info({
      content: `“${task.label}” 已在同步队列中（${conflictingTask.label}），未重复加入`,
      placement: "bottom-right",
    });
    return false;
  }

  // 新一轮同步开始时清理旧错误；同一队列中的错误应保留，便于集中重试。
  if (
    !preserveErrors &&
    !queueRunning.value &&
    !activeSyncTask.value &&
    syncQueue.value.length === 0
  ) {
    clearErrors();
  }

  const queuePosition = syncQueue.value.length + (activeSyncTask.value ? 1 : 0);
  syncQueue.value.push(task);
  if (queuePosition > 0) {
    // 有待执行任务时自动展开日志，用户可以随时确认队列顺序。
    showLogPanel.value = true;
    MessagePlugin.info({
      content: `“${task.label}” 已加入同步队列，前方还有 ${queuePosition} 项`,
      placement: "bottom-right",
    });
  }

  // processSyncQueue 会在第一个 await 前立即设置 queueRunning，防止连续点击启动并发 worker。
  void processSyncQueue();
  return true;
}

async function executeSyncTask(task) {
  if (task.type === "zip") {
    return deployZip(
      task.entries,
      task.remoteDir,
      task.clearRemotePaths,
      task.label,
      task.ignoreRules,
    );
  }

  await ensureRemoteDir(remoteDirname(task.remotePath));
  return uploadFile(task.localPath, task.remotePath, task.label);
}

async function processSyncQueue() {
  if (queueRunning.value) return;

  queueRunning.value = true;
  syncing.value = true;
  let ranTask = false;

  try {
    // 任务执行完后刷新目录时，用户仍可能继续加入新任务；因此外层循环会再次检查队列。
    while (syncQueue.value.length > 0 || ranTask) {
      while (syncQueue.value.length > 0) {
        const task = syncQueue.value.shift();
        activeSyncTask.value = task;
        ranTask = true;
        updateProgress(0, task.total);
        const pendingCount = syncQueue.value.length;
        syncMessage.value = `打包并同步: ${task.label}${
          pendingCount > 0 ? `（队列剩余 ${pendingCount} 项）` : ""
        }`;

        let success = false;
        let failureError = null;
        const errorCountBefore = syncErrors.value.length;
        try {
          if (task.type === "zip" && typeof window.opsApi?.sftpPreflight === "function") {
            syncMessage.value = `发布前预检: ${task.label}`;
            const preflight = await window.opsApi.sftpPreflight(
              createZipDeployPayload(task.entries, task.remoteDir, [], {
                ignoreRules: task.ignoreRules,
                label: task.label,
              }),
            );
            if (!preflight.success) throw new Error(`发布前预检失败：${preflight.error}`);
            const summary = preflight.data?.summary;
            syncMessage.value = `预检通过：${summary?.files || 0} 个文件，开始发布 ${task.label}`;
          }
          success = await executeSyncTask(task);
        } catch (err) {
          failureError = addError(
            task.label,
            err.message || "同步失败",
            task.type === "zip"
              ? {
                  zipDeploy: true,
                  entries: task.entries,
                  remoteDir: task.remoteDir,
                  clearRemotePaths: task.clearRemotePaths,
                }
              : {
                  localPath: task.localPath,
                  remotePath: task.remotePath,
                },
          );
        }

        if (success) {
          updateProgress(task.total, task.total);
          recordSyncHistory(
            task,
            "success",
            task.total > 1 ? `已完成，共同步 ${task.total} 项` : "已完成",
          );
          if (task.successMessage) {
            MessagePlugin.success({
              content: task.successMessage,
              placement: "bottom-right",
            });
          }
        } else {
          failureError ||= syncErrors.value.slice(errorCountBefore).at(-1);
          if (!failureError) {
            failureError = addError(task.label, "同步失败，未收到具体错误信息");
          }
          recordSyncHistory(task, "failed", failureError.message, failureError);
        }
      }

      if (ranTask) {
        syncMessage.value = "同步完成，正在刷新文件列表...";
        await refresh();
        ranTask = false;
      }
    }
  } finally {
    activeSyncTask.value = null;
    queueRunning.value = false;
    syncing.value = false;
    syncMessage.value = "";
    updateProgress(0, 0);
  }
}

// 部署单个文件（目录会打包部署）
async function deploySingleFile(file) {
  if (file.type === "directory") {
    await deployFolder(file);
    return;
  }

  const localPath = cleanPath(`${localDir.value}/${file.name}`);
  const remoteDir = cleanPath(currentPath.value);
  enqueueSyncTask(
    createZipSyncTask({
      label: file.name,
      entries: [{ localPath, archivePath: file.name }],
      remoteDir,
      successMessage: `${file.name} 上传成功`,
    }),
  );
}

// 部署文件夹（带确认框；确认后只加入队列，不与当前任务并发）
async function deployFolder(folder) {
  const confirmed = await window.opsApi.confirm({
    title: "部署文件夹",
    message: `确定要将本地文件夹 "${folder.name}" 部署到服务器吗？`,
    detail:
      "只会替换服务器上的同名文件夹；当前目录中的其它文件和文件夹会保留。",
  });
  if (!confirmed) return;

  const localPath = cleanPath(`${localDir.value}/${folder.name}`);
  const remoteDir = cleanPath(currentPath.value);
  enqueueSyncTask(
    createZipSyncTask({
      label: folder.name,
      entries: [{ localPath, archivePath: folder.name }],
      remoteDir,
      clearRemotePaths: [cleanPath(`${remoteDir}/${folder.name}`)],
      successMessage: `文件夹 “${folder.name}” 部署成功`,
    }),
  );
}

function enqueueBatchSync(status, label) {
  const items = mergedRows.value.filter((row) => row.status === status);
  if (items.length === 0) return;

  // 必须在点击时建立 entries 快照，不能等到队列执行时再依赖已刷新的表格行。
  const remoteDir = cleanPath(currentPath.value);
  const entries = items.map((row) => ({
    localPath: cleanPath(`${localDir.value}/${row.local.name}`),
    archivePath: row.local.name,
  }));
  const clearRemotePaths = items
    .filter((row) => row.local.type === "directory")
    .map((row) => cleanPath(`${remoteDir}/${row.local.name}`));

  enqueueSyncTask(
    createZipSyncTask({
      label,
      entries,
      remoteDir,
      clearRemotePaths,
      total: items.length,
      successMessage: `${label}完成，共 ${items.length} 项`,
    }),
  );
}

// 发布全部新增文件
async function publishAll() {
  enqueueBatchSync("only-local", "批量发布");
}

// 更新全部修改文件
async function updateAll() {
  enqueueBatchSync("modified", "批量更新");
}

async function retryUploadTasks(tasks) {
  if (tasks.length === 0) return;

  const acceptedTasks = [];
  for (const task of tasks) {
    const retryTask = task.zipDeploy
      ? createZipSyncTask({
          label: `重新同步: ${task.file}`,
          entries: task.entries,
          remoteDir: task.remoteDir,
          clearRemotePaths: task.clearRemotePaths || [],
        })
      : createUploadSyncTask({
          label: `重新上传: ${task.file}`,
          localPath: task.localPath,
          remotePath: task.remotePath,
        });

    if (enqueueSyncTask(retryTask, { preserveErrors: true }))
      acceptedTasks.push(task);
  }

  if (acceptedTasks.length > 0) {
    const acceptedSet = new Set(acceptedTasks);
    syncErrors.value = syncErrors.value.filter((err) => !acceptedSet.has(err));
  }
}

async function retryFailedUpload(error) {
  await retryUploadTasks([error]);
}

async function retryFailedUploads() {
  await retryUploadTasks([...retryableErrors.value]);
}

// 确认删除
async function confirmDelete(item) {
  if (syncing.value) {
    MessagePlugin.info({
      content: "同步队列执行中，请等待完成后再删除服务器文件",
      placement: "bottom-right",
    });
    return;
  }

  const type = item.type === "directory" ? "目录" : "文件";
  const confirmed = await window.opsApi.confirm({
    title: `删除${type}`,
    message: `确定要删除远程${type} "${item.name}" 吗？`,
    detail: item.type === "directory" ? "目录下的所有内容都将被删除！" : "",
  });
  if (confirmed) {
    try {
      const result = await window.opsApi.sftpDelete(item.path);
      if (result.success) {
        await refresh();
      } else {
        addError(item.name, `删除失败: ${result.error}`);
      }
    } catch (err) {
      addError(item.name, `删除失败: ${err.message}`);
    }
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    await loadReleaseProfiles();
    await loadSftpPaths();
    const result = await window.opsApi.sftpTest();
    if (result.success) {
      connectionStatus.value = { success: true, message: result.message };
      await refresh();
    } else {
      connectionStatus.value = { success: false, message: result.error };
      if (result.error?.includes("SFTP 配置未配置")) {
        await openSftpSettings();
      }
    }
  } catch (err) {
    connectionStatus.value = { success: false, message: err.message };
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.page {
  height: 100%;
  min-height: 0;
  padding: var(--page-padding-y) var(--page-padding-x);
  overflow-y: auto;
  background: transparent;
  display: flex;
  flex-direction: column;
  gap: var(--content-gap);
}

/* 页头 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-md);
  margin-bottom: calc(var(--page-header-gap) - var(--content-gap));
}

.page-title {
  font-size: var(--page-title-size);
  line-height: var(--page-title-line-height);
  font-weight: 700;
  color: var(--text);
  letter-spacing: var(--page-title-letter-spacing);
}

.page-desc {
  font-size: var(--page-desc-size);
  line-height: var(--page-desc-line-height);
  color: var(--text-muted);
  margin-top: var(--spacing-xs);
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-icon.success {
  color: var(--success);
}
.status-icon.error {
  color: var(--danger);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--header-actions-gap);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.btn-settings,
.btn-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--header-control-height);
  padding: 0 18px;
  border-radius: var(--radius);
  font-size: var(--header-control-font-size);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}

.btn-settings {
  border: 1px solid var(--border);
  background: var(--card-bg);
  color: var(--text-secondary);
}

.btn-settings:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-light);
}

.btn-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
}

.btn-refresh:hover:not(:disabled) {
  background: var(--primary-hover);
}

.btn-refresh:disabled {
  opacity: 0.5;
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

.sftp-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.38);
}

.sftp-settings-dialog {
  width: min(880px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: #fff;
  box-shadow: var(--shadow-xl);
}

.sftp-dialog-header {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--border-light);
}

.sftp-dialog-header h3 {
  color: var(--text);
  font-size: 18px;
  font-weight: 700;
}

.sftp-dialog-header p,
.sftp-settings-hint {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}

.sftp-icon-button {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: #f8fafc;
  cursor: pointer;
}

.sftp-icon-button:hover {
  color: var(--danger);
  background: var(--danger-light);
}

.sftp-settings-body {
  min-height: 0;
  padding: 14px 24px 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.sftp-settings-hint {
  margin: 0 0 14px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--primary-light);
  color: var(--primary);
}

.sftp-settings-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 12px 14px;
}

.sftp-field-name { grid-column: span 3; }
.sftp-field-host { grid-column: span 4; }
.sftp-field-port { grid-column: span 2; }
.sftp-field-username { grid-column: span 3; }
.sftp-field-password,
.sftp-field-ignore { grid-column: 1 / -1; }
.sftp-field-local-dir,
.sftp-field-remote-dir { grid-column: span 6; }

.sftp-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sftp-form-field-wide {
  grid-column: 1 / -1;
}

.sftp-settings-section-title {
  grid-column: 1 / -1;
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px solid var(--border-light);
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}

.sftp-path-field {
  display: flex;
  gap: 8px;
}

.sftp-path-field input {
  flex: 1;
  min-width: 0;
}

.sftp-path-browse {
  width: 38px;
  height: 36px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
}

.sftp-path-browse:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-light);
}

.sftp-form-field span {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.sftp-form-field em {
  color: var(--danger);
  font-style: normal;
}

.sftp-form-field input {
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13px;
  outline: none;
}

.sftp-form-field input:focus {
  border-color: var(--primary);
}

.sftp-secret-hint {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.sftp-clear-secret {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 12px;
}

.sftp-clear-secret input {
  width: 14px;
  height: 14px;
  padding: 0;
}

.sftp-dialog-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 24px 16px;
  border-top: 1px solid var(--border-light);
}

.sftp-btn-secondary,
.sftp-btn-primary {
  height: 36px;
  padding: 0 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.sftp-btn-secondary {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-secondary);
}

.sftp-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: var(--primary);
  color: #fff;
}

.sftp-btn-primary:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}


@media (max-width: 760px) {
  .sftp-modal-mask {
    align-items: flex-start;
    padding: 16px;
    overflow-y: auto;
  }

  .sftp-settings-dialog {
    width: 100%;
    max-height: none;
    margin: auto 0;
  }

  .sftp-settings-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sftp-field-name,
  .sftp-field-host,
  .sftp-field-password,
  .sftp-field-local-dir,
  .sftp-field-remote-dir,
  .sftp-field-ignore {
    grid-column: 1 / -1;
  }

  .sftp-field-port,
  .sftp-field-username {
    grid-column: span 1;
  }
}

/* 路径栏 */
.path-bar {
  display: flex;
  gap: 16px;
  flex-wrap: nowrap;
}

.path-group {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.path-group label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  flex-shrink: 0;
  white-space: nowrap;
}

.path-select {
  flex: 1;
  display: flex;
  gap: 6px;
}

.path-input {
  flex: 1;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text);
  outline: none;
}

.path-input:focus {
  border-color: var(--primary);
}

.browse-btn,
.go-btn {
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all var(--transition);
}

.browse-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.go-btn {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.go-btn:hover {
  background: var(--primary-hover);
}

/* 统一对比表格 */
.compare-container {
  flex: 1;
  min-height: 0;
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.compare-scroll {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 表头 */
.compare-header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  background: #f8fafc;
  border-bottom: 2px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

/* 表体 */
.compare-body {
  flex: 1;
  overflow-y: auto;
}

/* 行 */
.compare-row {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-light);
  transition: background var(--transition-fast);
}

.compare-row:hover {
  background: #f8fafc;
}

.compare-row.only-local {
  background: rgba(59, 130, 246, 0.03);
}

.compare-row.only-local:hover {
  background: rgba(59, 130, 246, 0.07);
}

.compare-row.modified {
  background: rgba(245, 158, 11, 0.03);
}

.compare-row.modified:hover {
  background: rgba(245, 158, 11, 0.07);
}

.compare-row.only-remote {
  background: rgba(239, 68, 68, 0.03);
}

.compare-row.only-remote:hover {
  background: rgba(239, 68, 68, 0.07);
}

/* 列 */
.col-name {
  flex: 1;
  min-width: 0;
}

.col-time {
  width: 160px;
  flex-shrink: 0;
}

.col-status {
  width: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.col-action {
  width: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 文件单元格 */
.cell-file {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-icon {
  flex-shrink: 0;
  font-size: 15px;
  color: var(--text-muted);
}

.compare-row .col-name:first-child .file-icon {
  color: var(--primary);
}

.compare-row .col-name:last-child .file-icon {
  color: #10b981;
}

.file-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time-text {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* 状态按钮 */
.status-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition);
}

.status-btn.publish {
  color: #3b82f6;
}

.status-btn.publish:hover {
  background: rgba(59, 130, 246, 0.1);
}

.status-btn.update {
  color: #f59e0b;
}

.status-btn.update:hover {
  background: rgba(245, 158, 11, 0.1);
}

.status-btn.delete {
  color: #ef4444;
}

.status-btn.delete:hover {
  background: rgba(239, 68, 68, 0.1);
}

.synced-icon {
  color: #10b981;
  font-size: 14px;
}

.deploy-folder-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: all var(--transition);
}

.compare-row:hover .deploy-folder-btn {
  opacity: 1;
}

.deploy-folder-btn:hover {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

/* 空状态 & 加载状态 */
.empty-state,
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px;
  gap: 12px;
  color: var(--text-muted);
  font-size: 14px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-spinner.small {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

/* 底部操作栏 */
.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--card-bg);
  border-radius: var(--radius);
  border: 1px solid var(--border-light);
}

.stats {
  display: flex;
  gap: 20px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.stat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.stat-dot.local {
  background: #3b82f6;
}
.stat-dot.modified {
  background: #f59e0b;
}
.stat-dot.synced {
  background: #10b981;
}
.stat-dot.remote {
  background: #ef4444;
}

.actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}

.action-btn.publish {
  background: #3b82f6;
  color: #fff;
}

.action-btn.publish:hover:not(:disabled) {
  background: #2563eb;
}

.action-btn.update {
  background: #f59e0b;
  color: #fff;
}

.action-btn.update:hover:not(:disabled) {
  background: #d97706;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 同步进度（占据底部操作栏） */
.sync-progress {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sync-progress-info {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.sync-progress-label {
  font-weight: 600;
}

.sync-progress-count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.sync-queue-count {
  color: var(--text-muted);
  font-size: 12px;
}

.sync-progress-track {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: var(--border-light);
  overflow: hidden;
}

.sync-progress-fill {
  height: 100%;
  border-radius: 3px;
  background: #3b82f6;
  transition: width 0.2s ease;
}

.sync-progress-fill.indeterminate {
  width: 40%;
  animation: progress-indeterminate 1.2s ease-in-out infinite;
}

@keyframes progress-indeterminate {
  0% {
    margin-left: -40%;
  }
  100% {
    margin-left: 100%;
  }
}

/* 同步日志面板 */
.log-panel {
  background: var(--card-bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  overflow: hidden;
}

.log-panel.collapsed {
  max-height: 42px;
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40px;
  padding: 8px 12px;
  background: #f8fafc;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition);
}

.log-header:hover {
  background: #f1f5f9;
}

.log-header-left,
.log-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.log-header-left {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.log-header-right {
  color: var(--text-muted);
}

.log-running-badge,
.log-queue-badge,
.log-error-badge {
  flex-shrink: 0;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  padding: 0 7px;
}

.log-running-badge {
  background: var(--primary);
  color: #fff;
}

.log-queue-badge {
  background: #e0edff;
  color: #2563eb;
}

.log-error-badge {
  background: var(--danger);
  color: #fff;
}

.log-retry-btn,
.log-clear-btn {
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition);
}

.log-retry-btn {
  height: 26px;
  padding: 0 8px;
  gap: 4px;
  color: var(--primary);
  font-size: 12px;
}

.log-clear-btn {
  width: 26px;
  height: 26px;
}

.log-clear-btn:hover {
  background: var(--danger-light);
  color: var(--danger);
}

.log-retry-btn:hover {
  background: var(--primary-light);
  color: var(--primary);
}

.log-body {
  max-height: 320px;
  overflow-y: auto;
  border-top: 1px solid var(--border-light);
}

.log-timeline {
  padding: 4px 0;
}

.log-timeline-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
  padding: 8px 12px;
}

.log-timeline-item + .log-timeline-item {
  border-top: 1px solid var(--border-light);
}

.log-timeline-item.running {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.1), rgba(59, 130, 246, 0.025));
}

.log-timeline-item.queued {
  background: rgba(148, 163, 184, 0.035);
}

.log-timeline-icon {
  flex-shrink: 0;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 15px;
}

.log-timeline-item.running .log-timeline-icon {
  color: var(--primary);
}

.log-timeline-item.success .log-timeline-icon {
  color: var(--success);
}

.log-timeline-item.failed .log-timeline-icon {
  color: var(--danger);
}

.log-queue-position {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 50%;
  background: #e0edff;
  color: #2563eb;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.log-timeline-content {
  min-width: 0;
  flex: 1;
}

.log-timeline-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.log-timeline-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text);
}

.log-task-type {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 0 7px;
  background: #f1f5f9;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
}

.log-timeline-message {
  margin: 2px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 12px;
}

.log-timeline-item.failed .log-timeline-message {
  color: var(--danger);
}

.log-timeline-meta {
  flex-shrink: 0;
  padding-top: 2px;
  color: var(--text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.log-item-retry {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  margin-top: -3px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition);
}

.log-item-retry:hover {
  background: var(--primary-light);
  color: var(--primary);
}

.log-empty {
  padding: 28px 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

.profile-select{height:var(--header-control-height);max-width:160px;font-size:var(--header-control-font-size);border:1px solid var(--border);border-radius:8px;background:#fff;padding:0 10px;color:var(--text)}
.sftp-form-field textarea{width:100%;resize:vertical;border:1px solid var(--border);border-radius:8px;padding:10px 12px;font:12px/1.6 var(--font-mono);color:var(--text);outline:none}.sftp-form-field textarea:focus{border-color:var(--primary)}
.release-history-dialog{width:min(760px,calc(100vw - 48px));max-height:80vh;background:#fff;border-radius:14px;box-shadow:0 24px 70px rgba(15,23,42,.24);overflow:hidden}.release-history-list{max-height:62vh;overflow:auto;padding:8px 22px 22px}.release-history-item{display:grid;grid-template-columns:12px 1fr auto;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border)}.release-history-item p,.release-history-item small{margin:3px 0 0;color:var(--text-muted);font-size:12px}.release-history-item button{border:0;border-radius:8px;background:#fff7ed;color:#c2410c;padding:8px 12px;cursor:pointer}.release-status{width:10px;height:10px;border-radius:50%;background:#94a3b8}.release-status.success{background:#10b981}.release-status.failed{background:#ef4444}.release-status.rolled-back{background:#f59e0b}
.sftp-dialog-spacer{flex:1}.sftp-btn-danger{border:1px solid #fecaca;border-radius:8px;background:#fff;color:#dc2626;padding:9px 14px;cursor:pointer}
</style>
