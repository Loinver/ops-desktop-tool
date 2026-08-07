<template>
  <div class="page">
    <header class="page-header">
      <div class="page-heading">
        <div class="page-eyebrow"><t-icon name="refresh" /> APPLICATION UPDATE</div>
        <h2 class="page-title">应用更新</h2>
        <p class="page-desc">从 GitHub Releases 检查、下载并校验当前平台的更新包。</p>
      </div>
      <div class="page-actions">
        <button
          type="button"
          class="update-button update-button--primary"
          :disabled="checking || downloading || installing || saving"
          @click="checkUpdate"
        >
          <t-icon name="refresh" :class="{ spinning: checking }" />
          <span>{{ checking ? '检查中…' : '检查更新' }}</span>
        </button>
      </div>
    </header>

    <main class="page-content">
      <section class="surface-panel page-section update-overview">
        <div class="update-overview__icon" :class="`update-overview__icon--${statusTone}`">
          <t-icon :name="statusIcon" />
        </div>
        <div class="update-overview__content">
          <div class="update-overview__title-row">
            <h3 class="section-title">{{ statusTitle }}</h3>
            <span class="status-pill" :class="`status-pill--${statusTone}`">{{ statusLabel }}</span>
          </div>
          <p class="update-overview__message">{{ state.message }}</p>
          <p v-if="state.error" class="update-error">{{ state.error }}</p>
          <dl class="version-grid">
            <div>
              <dt>当前版本</dt>
              <dd>v{{ state.currentVersion || '-' }}</dd>
            </div>
            <div>
              <dt>运行平台</dt>
              <dd>{{ platformLabel }}</dd>
            </div>
            <div>
              <dt>最新版本</dt>
              <dd>{{ state.release?.latestVersion ? `v${state.release.latestVersion}` : '-' }}</dd>
            </div>
            <div>
              <dt>上次检查</dt>
              <dd>{{ formatDate(state.settings?.lastCheckedAt) }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section v-if="state.release?.updateAvailable" class="surface-panel page-section">
        <div class="section-heading update-section-heading">
          <div>
            <h3 class="section-title">发现新版本 v{{ state.release.latestVersion }}</h3>
            <p class="section-desc">
              {{ state.release.asset?.name || '正在准备当前平台的更新包' }}
              <template v-if="state.release.asset?.size">
                · {{ formatBytes(state.release.asset.size) }}
              </template>
            </p>
          </div>
          <div class="update-actions">
            <button
              v-if="state.phase !== 'downloaded' && state.phase !== 'manual-install'"
              type="button"
              class="update-button update-button--primary"
              :disabled="downloading || checking || !state.isPackaged"
              @click="downloadUpdate"
            >
              <t-icon name="download" />
              <span>{{ downloading ? `下载中 ${downloadPercent}%` : '下载更新包' }}</span>
            </button>
            <button
              v-else
              type="button"
              class="update-button update-button--primary"
              :disabled="installing"
              @click="installUpdate"
            >
              <t-icon name="rocket" />
              <span>{{ installActionLabel }}</span>
            </button>
          </div>
        </div>

        <div v-if="state.download" class="download-progress" aria-live="polite">
          <div class="download-progress__header">
            <span>{{ state.download.fileName }}</span>
            <strong>{{ downloadPercent }}%</strong>
          </div>
          <div class="download-progress__track" role="progressbar" :aria-valuenow="downloadPercent">
            <span :style="{ width: `${downloadPercent}%` }"></span>
          </div>
          <div class="download-progress__meta">
            <span>
              {{ formatBytes(state.download.transferred) }} /
              {{ formatBytes(state.download.total) }}
            </span>
            <span v-if="state.download.verified" class="verified-label">
              <t-icon name="check-circle-filled" /> SHA-256 已校验
            </span>
          </div>
        </div>

        <div v-if="!state.isPackaged" class="update-notice update-notice--warning">
          当前是开发模式，只允许检查 Release；请在打包后的应用中下载和安装更新。
        </div>
        <div
          v-else-if="state.installMode === 'manual'"
          class="update-notice update-notice--warning"
        >
          当前 macOS 包未签名，因此应用会下载并校验 DMG，但最后一步需要你手动打开并替换应用。
        </div>

        <details v-if="state.release.notes" class="release-notes">
          <summary>查看 Release 说明</summary>
          <pre>{{ state.release.notes }}</pre>
        </details>
      </section>

      <section class="surface-panel page-section">
        <div class="section-heading">
          <h3 class="section-title">GitHub 私有仓库授权</h3>
          <p class="section-desc">
            Token 只在主进程中使用，并通过系统安全存储加密保存在本机；界面不会回显完整内容。
          </p>
        </div>

        <form class="token-form" @submit.prevent="saveSettings">
          <label class="update-field update-field--wide">
            <span>Fine-grained personal access token</span>
            <div class="token-input-row">
              <input
                v-model="tokenInput"
                type="password"
                autocomplete="new-password"
                maxlength="512"
                :placeholder="tokenPlaceholder"
              />
              <button
                v-if="state.settings?.tokenConfigured"
                type="button"
                class="update-button update-button--danger"
                :disabled="saving || checking || downloading || installing"
                @click="clearToken"
              >
                清除 Token
              </button>
            </div>
            <small>仅授权仓库 Loinver/ops-desktop-tool，并授予 Contents 只读权限即可。</small>
          </label>

          <label class="update-toggle">
            <input v-model="autoCheck" type="checkbox" />
            <span>
              <strong>启动后自动检查</strong>
              <small>应用启动约 12 秒后检查最新正式 Release。</small>
            </span>
          </label>

          <label class="update-toggle">
            <input v-model="autoDownload" type="checkbox" />
            <span>
              <strong>发现更新后自动下载</strong>
              <small>下载完成后仍需确认安装；macOS 需要手动替换应用。</small>
            </span>
          </label>

          <div class="form-actions">
            <button
              type="submit"
              class="update-button update-button--primary"
              :disabled="saving || checking || downloading || installing"
            >
              <t-icon name="save" />
              <span>{{ saving ? '保存中…' : '保存更新设置' }}</span>
            </button>
          </div>
        </form>
      </section>

      <section class="surface-panel page-section update-security">
        <div class="section-heading">
          <h3 class="section-title">更新安全策略</h3>
          <p class="section-desc">
            更新包必须来自目标 GitHub Release，并通过 Release 中的 SHA256SUMS.txt 校验。
          </p>
        </div>
        <ul>
          <li><t-icon name="check-circle" /> Token 不会发送到非 GitHub API 域名。</li>
          <li><t-icon name="check-circle" /> 自动选择当前操作系统与 CPU 架构对应的安装包。</li>
          <li><t-icon name="check-circle" /> 校验失败会删除下载文件并阻止安装。</li>
          <li><t-icon name="info-circle" /> SHA-256 用于校验文件一致性，不等同于代码签名。</li>
          <li><t-icon name="info-circle" /> 首个带更新功能的版本仍需手动安装一次。</li>
        </ul>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { opsApi } from '../../api/opsApi'

const state = ref({
  phase: 'idle',
  currentVersion: '',
  platform: '',
  arch: '',
  isPackaged: false,
  installMode: 'unsupported',
  settings: {
    autoCheck: true,
    autoDownload: true,
    tokenConfigured: false,
    maskedToken: '',
    lastCheckedAt: ''
  },
  release: null,
  download: null,
  message: '正在读取更新状态…',
  error: ''
})
const tokenInput = ref('')
const autoCheck = ref(true)
const autoDownload = ref(true)
const saving = ref(false)
let stopStateListener = null

const checking = computed(() => state.value.phase === 'checking')
const downloading = computed(() => state.value.phase === 'downloading')
const installing = computed(() => state.value.phase === 'installing')
const downloadPercent = computed(() => Math.max(0, Number(state.value.download?.percent) || 0))
const platformLabel = computed(() => {
  const platform =
    { darwin: 'macOS', win32: 'Windows' }[state.value.platform] || state.value.platform
  return `${platform || '-'} / ${state.value.arch || '-'}`
})
const tokenPlaceholder = computed(() =>
  state.value.settings?.tokenConfigured
    ? `已保存 ${state.value.settings.maskedToken || '安全 Token'}；留空表示不修改`
    : 'github_pat_...'
)
const installActionLabel = computed(() => {
  if (state.value.installMode === 'manual') return '打开 DMG 安装包'
  return installing.value ? '正在启动安装程序…' : '重启并安装'
})
const statusTone = computed(() => {
  if (state.value.error || state.value.phase === 'error') return 'danger'
  if (['available', 'downloading', 'downloaded', 'manual-install'].includes(state.value.phase)) {
    return 'warning'
  }
  if (state.value.phase === 'up-to-date') return 'success'
  if (state.value.phase === 'needs-auth') return 'muted'
  return 'primary'
})
const statusIcon = computed(
  () =>
    ({
      danger: 'close-circle',
      warning: 'download',
      success: 'check-circle',
      muted: 'lock-on',
      primary: 'refresh'
    })[statusTone.value]
)
const statusLabel = computed(
  () =>
    ({
      idle: '待检查',
      checking: '检查中',
      'needs-auth': '需要授权',
      available: '有新版本',
      downloading: '下载中',
      downloaded: '等待安装',
      installing: '安装中',
      'manual-install': '手动安装',
      'up-to-date': '已是最新',
      unsupported: '不支持',
      error: '操作失败'
    })[state.value.phase] || '更新状态'
)
const statusTitle = computed(() => {
  if (state.value.release?.updateAvailable) {
    return `Ops Desktop v${state.value.release.latestVersion}`
  }
  return 'Ops Desktop 更新状态'
})

watch(
  () => state.value.settings,
  (settings) => {
    autoCheck.value = settings?.autoCheck !== false
    autoDownload.value = settings?.autoDownload !== false
  },
  { immediate: true }
)

function applyState(nextState) {
  if (nextState && typeof nextState === 'object') state.value = nextState
}

async function loadState() {
  try {
    applyState(await opsApi.getAppUpdateState())
  } catch (error) {
    state.value = { ...state.value, phase: 'error', error: error?.message || '读取更新状态失败' }
  }
}

async function checkUpdate() {
  try {
    applyState(await opsApi.checkAppUpdate())
  } catch (error) {
    state.value = { ...state.value, phase: 'error', error: error?.message || '检查更新失败' }
  }
}

async function downloadUpdate() {
  try {
    applyState(await opsApi.downloadAppUpdate())
  } catch (error) {
    state.value = { ...state.value, phase: 'error', error: error?.message || '下载更新失败' }
  }
}

async function installUpdate() {
  const confirmed = await opsApi.confirm({
    title: state.value.installMode === 'manual' ? '打开更新包' : '重启并安装更新',
    message:
      state.value.installMode === 'manual'
        ? '确认打开已校验的 macOS DMG 更新包？'
        : '应用将退出并启动安装程序，确认继续？',
    detail:
      state.value.installMode === 'manual'
        ? '打开后请将 Ops Desktop 拖入“应用程序”并替换旧版本。'
        : '请先保存正在进行的工作。'
  })
  if (!confirmed) return
  try {
    applyState(await opsApi.installAppUpdate())
  } catch (error) {
    state.value = { ...state.value, phase: 'error', error: error?.message || '安装更新失败' }
  }
}

async function saveSettings() {
  saving.value = true
  try {
    const payload = {
      autoCheck: autoCheck.value,
      autoDownload: autoDownload.value
    }
    if (tokenInput.value.trim()) payload.token = tokenInput.value.trim()
    applyState(await opsApi.saveAppUpdateSettings(payload))
    tokenInput.value = ''
  } catch (error) {
    state.value = { ...state.value, phase: 'error', error: error?.message || '保存设置失败' }
  } finally {
    saving.value = false
  }
}

async function clearToken() {
  const confirmed = await opsApi.confirm({
    title: '清除 GitHub Token',
    message: '清除后将无法访问私有仓库 Release，确认继续？'
  })
  if (!confirmed) return
  saving.value = true
  try {
    applyState(
      await opsApi.saveAppUpdateSettings({
        autoCheck: autoCheck.value,
        autoDownload: autoDownload.value,
        clearToken: true
      })
    )
    tokenInput.value = ''
  } catch (error) {
    state.value = { ...state.value, phase: 'error', error: error?.message || '清除 Token 失败' }
  } finally {
    saving.value = false
  }
}

function formatBytes(value) {
  const bytes = Number(value) || 0
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const amount = bytes / 1024 ** index
  return `${amount.toFixed(index === 0 ? 0 : amount >= 100 ? 0 : 1)} ${units[index]}`
}

function formatDate(value) {
  if (!value) return '尚未检查'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

onMounted(() => {
  stopStateListener = opsApi.onAppUpdateStateChanged(applyState)
  loadState()
})

onUnmounted(() => {
  stopStateListener?.()
  stopStateListener = null
})
</script>

<style scoped>
.update-button {
  min-height: var(--header-control-height);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: 0 var(--button-padding-x);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card-bg);
  color: var(--text-secondary);
  font-size: var(--header-control-font-size);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
}

.update-button:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.update-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.update-button--primary {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}

.update-button--primary:hover:not(:disabled) {
  border-color: var(--primary-hover);
  background: var(--primary-hover);
  color: #fff;
}

.update-button--danger {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  color: var(--danger);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.update-overview {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--spacing-lg);
  align-items: flex-start;
}

.update-overview__icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-lg);
  font-size: 25px;
}

.update-overview__icon--primary {
  color: var(--primary);
  background: var(--primary-light);
}

.update-overview__icon--success {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
}

.update-overview__icon--warning {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}

.update-overview__icon--danger {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.update-overview__icon--muted {
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.update-overview__content {
  min-width: 0;
}

.update-overview__title-row,
.update-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--content-gap);
}

.update-overview__title-row .section-title,
.update-section-heading .section-title {
  margin: 0;
}

.update-overview__message {
  margin: var(--spacing-xs) 0 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

.update-error {
  margin: var(--spacing-sm) 0 0;
  color: var(--danger);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

.status-pill {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: var(--font-size-xs);
  font-weight: 700;
}

.status-pill--success {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
}

.status-pill--warning {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}

.status-pill--danger {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.status-pill--muted {
  color: var(--text-muted);
  background: var(--bg-subtle);
}

.version-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--content-gap);
  margin: var(--spacing-lg) 0 0;
}

.version-grid div {
  min-width: 0;
  padding: var(--spacing-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--bg-subtle);
}

.version-grid dt {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.version-grid dd {
  margin: var(--spacing-xs) 0 0;
  overflow: hidden;
  color: var(--text);
  font-size: var(--font-size-body);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-heading {
  margin-bottom: var(--spacing-lg);
}

.section-title {
  margin: 0;
}

.section-desc {
  margin: var(--spacing-xs) 0 0;
  color: var(--text-muted);
  line-height: 1.6;
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.download-progress {
  margin-top: var(--spacing-lg);
  padding: var(--spacing-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--bg-subtle);
}

.download-progress__header,
.download-progress__meta {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-md);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.download-progress__header span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-progress__track {
  height: 8px;
  margin: var(--spacing-sm) 0;
  overflow: hidden;
  border-radius: 999px;
  background: var(--border-light);
}

.download-progress__track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
  transition: width 180ms ease;
}

.verified-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--success);
  font-weight: 600;
}

.update-notice {
  margin-top: var(--spacing-lg);
  padding: var(--spacing-md);
  border-radius: var(--radius);
  font-size: var(--font-size-sm);
  line-height: 1.65;
}

.update-notice--warning {
  border: 1px solid color-mix(in srgb, var(--warning) 30%, var(--border));
  background: color-mix(in srgb, var(--warning) 9%, transparent);
  color: var(--text-secondary);
}

.release-notes {
  margin-top: var(--spacing-lg);
  border-top: 1px solid var(--border-light);
  padding-top: var(--spacing-md);
}

.release-notes summary {
  color: var(--primary);
  font-weight: 600;
  cursor: pointer;
}

.release-notes pre {
  max-height: 320px;
  margin: var(--spacing-md) 0 0;
  overflow: auto;
  color: var(--text-secondary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.token-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--content-gap);
}

.update-field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.update-field--wide,
.form-actions {
  grid-column: 1 / -1;
}

.update-field > span {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.update-field small,
.update-toggle small {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

.token-input-row {
  display: flex;
  gap: var(--spacing-sm);
}

.token-input-row input {
  min-width: 0;
  flex: 1;
  height: var(--header-control-height);
  padding: 0 var(--spacing-md);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card-bg);
  color: var(--text);
  outline: none;
}

.token-input-row input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 12%, transparent);
}

.update-toggle {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--bg-subtle);
  cursor: pointer;
}

.update-toggle input {
  width: var(--checkbox-size);
  height: var(--checkbox-size);
  margin-top: 2px;
  accent-color: var(--primary);
}

.update-toggle span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.update-toggle strong {
  color: var(--text);
  font-size: var(--font-size-sm);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.update-security ul {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-md);
  margin: 0;
  padding: 0;
  list-style: none;
}

.update-security li {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.6;
}

.update-security li .t-icon {
  flex-shrink: 0;
  margin-top: 3px;
  color: var(--success);
}

@media (max-width: 900px) {
  .version-grid,
  .update-security ul {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .update-overview {
    grid-template-columns: 1fr;
  }

  .update-overview__title-row,
  .update-section-heading,
  .token-input-row {
    align-items: stretch;
    flex-direction: column;
  }

  .version-grid,
  .token-form,
  .update-security ul {
    grid-template-columns: 1fr;
  }

  .update-field--wide,
  .form-actions {
    grid-column: auto;
  }

  .form-actions,
  .form-actions .update-button,
  .update-actions,
  .update-actions .update-button {
    width: 100%;
  }
}
</style>
