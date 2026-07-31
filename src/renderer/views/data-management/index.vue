<template>
  <div class="page data-management-page">
    <header class="page-header">
      <div class="page-heading">
        <div class="page-eyebrow"><t-icon name="save" /> DATA &amp; BACKUP</div>
        <h2 class="page-title">本地数据管理</h2>
        <p class="page-desc">按功能分类导出加密备份；恢复前会先校验内容，并为当前数据保留本机恢复点。</p>
      </div>
      <div class="page-actions">
        <button class="btn-secondary" type="button" :disabled="loading || busy" @click="loadDataManagementState">
          <t-icon :name="loading ? 'loading' : 'refresh'" :class="{ spinning: loading }" /> 刷新概览
        </button>
      </div>
    </header>

    <main class="page-content">
      <section class="data-summary" aria-label="本地数据概览">
        <article class="surface-panel data-summary-card">
          <span>可备份分类</span>
          <strong>{{ availableGroupCount }}</strong>
          <small>共 {{ overview.groups.length }} 个功能分类</small>
        </article>
        <article class="surface-panel data-summary-card">
          <span>本地数据文件</span>
          <strong>{{ totalFiles }}</strong>
          <small>{{ formatBytes(totalSize) }} 可导出数据</small>
        </article>
        <article class="surface-panel data-summary-card" :class="{ 'data-summary-card--warning': invalidFiles.length }">
          <span>数据校验</span>
          <strong>{{ invalidFiles.length ? '需处理' : '正常' }}</strong>
          <small>{{ invalidFiles.length ? `${invalidFiles.length} 个文件无法纳入备份` : '导出前将再次验证内容' }}</small>
        </article>
      </section>

      <section class="surface-panel page-section" aria-labelledby="backup-title">
        <div class="section-heading">
          <div>
            <h3 id="backup-title" class="section-title">创建加密备份</h3>
            <p class="section-desc">备份采用 AES-256-GCM 加密；请妥善保存密码，应用无法找回。</p>
          </div>
          <span class="section-status"><t-icon name="secured" /> 仅保存在你选择的位置</span>
        </div>

        <div v-if="invalidFiles.length" class="validation-note validation-note--warning">
          <t-icon name="error-circle" /> 以下文件不是有效 JSON，已暂时排除：{{ invalidFiles.join('、') }}。
        </div>

        <div class="backup-group-grid">
          <label v-for="group in overview.groups" :key="group.id" :class="['backup-group', { 'is-disabled': !group.available }]">
            <input v-model="selectedGroups" type="checkbox" :value="group.id" :disabled="!group.available" />
            <span class="backup-group-copy">
              <strong>{{ group.label }}</strong>
              <small>{{ group.description }}</small>
              <em v-if="group.available">{{ group.fileCount }} 个文件 · {{ formatBytes(group.sizeBytes) }}</em>
              <em v-else>暂无可备份数据</em>
            </span>
          </label>
        </div>

        <div class="backup-form-grid">
          <label class="field-label">
            <span>备份密码</span>
            <input v-model="backupPassword" class="field-input" type="password" autocomplete="new-password" minlength="8" maxlength="256" placeholder="至少 8 个字符" />
          </label>
          <label class="field-label">
            <span>确认密码</span>
            <input v-model="backupPasswordConfirm" class="field-input" type="password" autocomplete="new-password" minlength="8" maxlength="256" placeholder="再次输入备份密码" />
          </label>
        </div>

        <div class="panel-actions">
          <p>已选择 {{ selectedGroups.length }} 个分类，{{ selectedFileCount }} 个数据文件。</p>
          <button class="btn-primary" type="button" :disabled="busy || !canExport" @click="exportBackup">
            <t-icon :name="busyAction === 'export' ? 'loading' : 'download'" :class="{ spinning: busyAction === 'export' }" /> 导出加密备份
          </button>
        </div>
      </section>

      <section class="surface-panel page-section" aria-labelledby="restore-title">
        <div class="section-heading">
          <div>
            <h3 id="restore-title" class="section-title">校验并恢复备份</h3>
            <p class="section-desc">恢复只替换备份中存在的数据文件，未包含的数据保持不变；完成后需要重启应用以重新加载服务和页面状态。</p>
          </div>
        </div>

        <div class="restore-controls">
          <label class="field-label restore-password">
            <span>备份密码</span>
            <input v-model="restorePassword" class="field-input" type="password" autocomplete="current-password" minlength="8" maxlength="256" placeholder="输入所选备份的密码" @keyup.enter="inspectBackup" />
          </label>
          <button class="btn-secondary" type="button" :disabled="busy || restorePassword.length < 8" @click="inspectBackup">
            <t-icon :name="busyAction === 'inspect' ? 'loading' : 'file-search'" :class="{ spinning: busyAction === 'inspect' }" /> 选择并校验备份
          </button>
        </div>

        <div v-if="backupPreview" class="restore-preview">
          <div class="restore-preview-heading">
            <div>
              <span class="preview-label">已校验备份</span>
              <strong>{{ backupPreview.fileName }}</strong>
            </div>
            <span class="preview-time">导出于 {{ formatDate(backupPreview.summary.createdAt) }}</span>
          </div>
          <dl class="preview-metrics">
            <div><dt>来源版本</dt><dd>{{ backupPreview.summary.appVersion || '未知版本' }}</dd></div>
            <div><dt>数据文件</dt><dd>{{ backupPreview.summary.fileCount }} 个</dd></div>
            <div><dt>恢复体积</dt><dd>{{ formatBytes(backupPreview.summary.sizeBytes) }}</dd></div>
          </dl>
          <div class="preview-groups">
            <span v-for="group in backupPreview.summary.groups" :key="group.id">{{ group.label }} · {{ group.fileCount }} 个</span>
          </div>
          <div class="panel-actions panel-actions--restore">
            <p><t-icon name="info-circle" /> 恢复前会保存当前同名文件的本机恢复点，仅保留最近 3 次。</p>
            <button class="btn-danger" type="button" :disabled="busy" @click="restoreBackup">
              <t-icon :name="busyAction === 'restore' ? 'loading' : 'upload'" :class="{ spinning: busyAction === 'restore' }" /> 恢复并重启
            </button>
          </div>
        </div>
        <div v-else class="restore-empty"><t-icon name="file" /> 选择备份并输入密码后，可在恢复前查看其中的分类、文件数和导出时间。</div>
      </section>

      <section class="surface-panel page-section" aria-labelledby="auto-backup-title">
        <div class="section-heading">
          <div>
            <h3 id="auto-backup-title" class="section-title">自动备份计划</h3>
            <p class="section-desc">主进程会按计划生成加密备份；密码仅使用系统安全存储保存，不会回显到页面。</p>
          </div>
          <span class="section-status" :class="{ 'section-status--muted': !autoSettings.enabled }">
            <t-icon :name="autoSettings.enabled ? 'check-circle' : 'stop-circle'" /> {{ autoSettings.enabled ? '计划已启用' : '计划未启用' }}
          </span>
        </div>

        <div class="auto-settings-grid">
          <label class="toggle-field">
            <input v-model="autoSettings.enabled" type="checkbox" />
            <span><strong>启用自动备份</strong><small>关闭后不会执行计划任务，也不会删除已有备份。</small></span>
          </label>
          <label class="field-label">
            <span>执行频率</span>
            <select v-model="autoSettings.interval" class="field-input"><option value="daily">每天一次</option><option value="weekly">每周一次</option></select>
          </label>
          <label class="field-label">
            <span>保留数量</span>
            <input v-model.number="autoSettings.retentionCount" class="field-input" type="number" min="1" max="30" />
          </label>
          <label class="field-label auto-directory-field">
            <span>自动备份目录</span>
            <div class="path-control"><input :value="autoSettings.outputDirectory" class="field-input" type="text" readonly placeholder="选择专用目录保存 .opsbackup 文件" /><button class="btn-secondary" type="button" :disabled="busy" @click="chooseAutoBackupDirectory"><t-icon name="folder-open" /> 选择目录</button></div>
          </label>
          <label class="field-label">
            <span>自动备份密码</span>
            <input v-model="autoPassword" class="field-input" type="password" autocomplete="new-password" minlength="8" maxlength="256" :placeholder="autoSettings.hasPassword ? '已安全保存；留空则继续使用' : '首次启用时至少 8 个字符'" />
          </label>
        </div>

        <div class="backup-group-grid backup-group-grid--auto">
          <label v-for="group in overview.groups" :key="`auto-${group.id}`" class="backup-group">
            <input v-model="autoSettings.categories" type="checkbox" :value="group.id" />
            <span class="backup-group-copy"><strong>{{ group.label }}</strong><small>{{ group.description }}</small><em>{{ group.fileCount }} 个当前数据文件</em></span>
          </label>
        </div>

        <div class="auto-status-line">
          <span>上次执行：{{ autoSettings.lastRunAt ? formatDate(autoSettings.lastRunAt) : '尚未执行' }}</span>
          <span>下次执行：{{ autoSettings.enabled && autoSettings.nextRunAt ? formatDate(autoSettings.nextRunAt) : '保存并启用后生成计划' }}</span>
          <span>{{ autoSettings.hasPassword ? '密码已由系统安全存储保护' : '尚未保存密码' }}</span>
        </div>
        <div class="panel-actions">
          <p>建议选择只用于本应用备份的目录；保留策略只清理本应用自动生成的备份文件。</p>
          <div class="panel-action-buttons">
            <button class="btn-secondary" type="button" :disabled="busy" @click="saveAutoBackup"><t-icon :name="busyAction === 'auto-save' ? 'loading' : 'save'" :class="{ spinning: busyAction === 'auto-save' }" /> 保存计划</button>
            <button class="btn-primary" type="button" :disabled="busy || !canRunAutoBackup" @click="runAutoBackup"><t-icon :name="busyAction === 'auto-run' ? 'loading' : 'play-circle'" :class="{ spinning: busyAction === 'auto-run' }" /> 立即备份</button>
          </div>
        </div>
      </section>

      <section class="surface-panel page-section" aria-labelledby="recovery-history-title">
        <div class="section-heading">
          <div>
            <h3 id="recovery-history-title" class="section-title">自动备份与恢复点</h3>
            <p class="section-desc">查看自动备份结果，或将本机数据一键回滚到恢复前的安全状态。</p>
          </div>
        </div>
        <div class="recovery-grid">
          <div class="recovery-column">
            <div class="subsection-heading"><strong>自动备份历史</strong><span>最近 {{ autoHistory.length }} 条</span></div>
            <div v-if="autoHistory.length" class="history-list">
              <article v-for="item in autoHistory" :key="item.id" class="history-item history-item--auto" :class="{ 'history-item--failed': item.status === 'failed', 'history-item--missing': item.availability === 'missing' }">
                <div><strong>{{ item.status === 'success' ? item.fileName : '自动备份失败' }}</strong><small>{{ formatDate(item.createdAt) }} · {{ item.status === 'success' ? formatBytes(item.sizeBytes) : item.error }}</small></div>
                <div class="history-item-side">
                  <span :class="{ 'history-status--missing': item.availability === 'missing' }">{{ autoBackupStateLabel(item) }}</span>
                  <div v-if="item.status === 'success'" class="history-item-actions">
                    <button class="btn-secondary" type="button" :disabled="busy" @click="openAutoBackupDirectory(item)"><t-icon name="folder-open" /> 目录</button>
                    <button v-if="item.availability === 'available'" class="btn-secondary" type="button" :disabled="busy" @click="inspectAutoHistoryBackup(item)"><t-icon :name="busyAction === `auto-inspect-${item.id}` ? 'loading' : 'file-search'" :class="{ spinning: busyAction === `auto-inspect-${item.id}` }" /> 校验</button>
                    <button v-if="item.availability === 'available'" class="btn-secondary" type="button" :disabled="busy" @click="restoreAutoHistoryBackup(item)"><t-icon :name="busyAction === `auto-restore-${item.id}` ? 'loading' : 'rollback'" :class="{ spinning: busyAction === `auto-restore-${item.id}` }" /> 恢复</button>
                    <button class="btn-danger btn-danger--compact" type="button" :disabled="busy" @click="deleteAutoHistoryBackup(item)"><t-icon :name="busyAction === `auto-delete-${item.id}` ? 'loading' : 'delete'" :class="{ spinning: busyAction === `auto-delete-${item.id}` }" /> {{ item.availability === 'missing' ? '清理记录' : '删除' }}</button>
                  </div>
                </div>
              </article>
            </div>
            <div v-else class="restore-empty"><t-icon name="time" /> 暂无自动备份记录。</div>
          </div>
          <div class="recovery-column">
            <div class="subsection-heading"><strong>本机恢复点</strong><span>最多保留 3 个</span></div>
            <div v-if="restorePoints.length" class="history-list">
              <article v-for="point in restorePoints" :key="point.id" class="history-item history-item--restore-point">
                <div><strong>{{ formatDate(point.createdAt) }}</strong><small>{{ point.fileCount }} 个文件 · {{ point.groups.join('、') || '本地数据' }}</small></div>
                <button class="btn-secondary" type="button" :disabled="busy" @click="restorePoint(point)"><t-icon :name="busyAction === `restore-point-${point.id}` ? 'loading' : 'rollback'" :class="{ spinning: busyAction === `restore-point-${point.id}` }" /> 回滚</button>
              </article>
            </div>
            <div v-else class="restore-empty"><t-icon name="file" /> 暂无恢复点；恢复外部备份前会自动创建。</div>
          </div>
        </div>
      </section>

      <section class="data-security-note" aria-label="备份说明">
        <t-icon name="secured" />
        <div><strong>安全说明</strong><p>备份文件已由你的密码加密。已保存的 SFTP 与 AI 凭证仍使用系统安全存储保护；跨设备恢复后，如系统安全存储无法解密旧凭证，请在对应页面重新输入密码或 API Key。</p></div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import MessagePlugin from 'tdesign-vue-next/es/message/plugin.mjs'

const overview = ref({ groups: [] })
const selectedGroups = ref([])
const loading = ref(false)
const busyAction = ref('')
const backupPassword = ref('')
const backupPasswordConfirm = ref('')
const restorePassword = ref('')
const backupPreview = ref(null)
const autoSettings = ref({ enabled: false, outputDirectory: '', interval: 'weekly', retentionCount: 7, categories: [], hasPassword: false, lastRunAt: 0, nextRunAt: 0 })
const autoPassword = ref('')
const autoHistory = ref([])
const restorePoints = ref([])

const busy = computed(() => Boolean(busyAction.value))
const availableGroupCount = computed(() => overview.value.groups.filter(group => group.available).length)
const totalFiles = computed(() => overview.value.groups.reduce((total, group) => total + group.fileCount, 0))
const totalSize = computed(() => overview.value.groups.reduce((total, group) => total + group.sizeBytes, 0))
const invalidFiles = computed(() => overview.value.groups.flatMap(group => group.invalidFiles || []))
const selectedFileCount = computed(() => overview.value.groups
  .filter(group => selectedGroups.value.includes(group.id))
  .reduce((total, group) => total + group.fileCount, 0))
const canExport = computed(() => selectedGroups.value.length > 0 && backupPassword.value.length >= 8 && backupPassword.value === backupPasswordConfirm.value)
const canRunAutoBackup = computed(() => autoSettings.value.enabled && autoSettings.value.outputDirectory && autoSettings.value.hasPassword && autoSettings.value.categories.length > 0)

function formatBytes(value) {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value) {
  const timestamp = Number(value)
  return timestamp ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '未知时间'
}

function autoBackupStateLabel(item) {
  if (item.status === 'failed') return '失败'
  return item.availability === 'available' ? '可恢复' : '文件缺失'
}

async function loadOverview() {
  loading.value = true
  try {
    const next = await window.opsApi.getDataBackupOverview()
    overview.value = next || { groups: [] }
    const available = next?.groups?.filter(group => group.available).map(group => group.id) || []
    selectedGroups.value = selectedGroups.value.filter(id => available.includes(id))
    if (!selectedGroups.value.length) selectedGroups.value = available
  } catch (error) {
    MessagePlugin.error({ content: error.message || '无法读取本地数据概览', placement: 'bottom-right' })
  } finally {
    loading.value = false
  }
}

async function exportBackup() {
  if (!canExport.value) {
    MessagePlugin.warning({ content: backupPassword.value !== backupPasswordConfirm.value ? '两次输入的备份密码不一致' : '请选择分类并设置至少 8 位的备份密码', placement: 'bottom-right' })
    return
  }
  busyAction.value = 'export'
  try {
    const result = await window.opsApi.exportDataBackup({ categories: selectedGroups.value, password: backupPassword.value })
    if (!result?.canceled) {
      MessagePlugin.success({ content: `已导出 ${result.fileName}（${formatBytes(result.sizeBytes)}）`, placement: 'bottom-right' })
      backupPassword.value = ''
      backupPasswordConfirm.value = ''
    }
  } catch (error) {
    MessagePlugin.error({ content: error.message || '导出备份失败', placement: 'bottom-right' })
  } finally {
    busyAction.value = ''
  }
}

async function inspectBackup() {
  if (restorePassword.value.length < 8) return
  busyAction.value = 'inspect'
  backupPreview.value = null
  try {
    const result = await window.opsApi.inspectDataBackup({ password: restorePassword.value })
    if (!result?.canceled) {
      backupPreview.value = result
      MessagePlugin.success({ content: '备份校验通过，请核对恢复范围', placement: 'bottom-right' })
    }
  } catch (error) {
    MessagePlugin.error({ content: error.message || '备份校验失败', placement: 'bottom-right' })
  } finally {
    busyAction.value = ''
  }
}

async function restoreBackup() {
  if (!backupPreview.value?.token) return
  const confirmed = await window.opsApi.confirm({
    title: '确认恢复本地数据',
    message: `将恢复 ${backupPreview.value.summary.fileCount} 个数据文件。`,
    detail: '当前同名文件会先保存为本机恢复点；恢复完成后应用将立即重启。',
  })
  if (!confirmed) return
  busyAction.value = 'restore'
  try {
    await window.opsApi.restoreDataBackup({ token: backupPreview.value.token })
    MessagePlugin.success({ content: '数据已恢复，正在重启应用…', placement: 'bottom-right' })
    await window.opsApi.relaunchApp()
  } catch (error) {
    MessagePlugin.error({ content: error.message || '恢复备份失败', placement: 'bottom-right' })
  } finally {
    busyAction.value = ''
  }
}

async function loadAutoBackupState() {
  try {
    const [settings, history] = await Promise.all([
      window.opsApi.getAutoBackupSettings(),
      window.opsApi.getAutoBackupHistory(),
    ])
    autoSettings.value = { ...autoSettings.value, ...(settings || {}) }
    autoHistory.value = Array.isArray(history) ? history : []
  } catch (error) {
    MessagePlugin.error({ content: error.message || '无法读取自动备份状态', placement: 'bottom-right' })
  }
}

async function loadRestorePoints() {
  try {
    const points = await window.opsApi.getDataRestorePoints()
    restorePoints.value = Array.isArray(points) ? points : []
  } catch (error) {
    MessagePlugin.error({ content: error.message || '无法读取本机恢复点', placement: 'bottom-right' })
  }
}

async function loadDataManagementState() {
  await Promise.all([loadOverview(), loadAutoBackupState(), loadRestorePoints()])
}

async function chooseAutoBackupDirectory() {
  const directory = await window.opsApi.browseFile({ directory: true, defaultPath: autoSettings.value.outputDirectory })
  if (directory) autoSettings.value.outputDirectory = directory
}

async function saveAutoBackup() {
  busyAction.value = 'auto-save'
  try {
    const result = await window.opsApi.saveAutoBackupSettings({
      enabled: autoSettings.value.enabled,
      outputDirectory: autoSettings.value.outputDirectory,
      interval: autoSettings.value.interval,
      retentionCount: autoSettings.value.retentionCount,
      categories: autoSettings.value.categories,
      password: autoPassword.value,
    })
    autoSettings.value = { ...autoSettings.value, ...(result?.settings || {}) }
    autoPassword.value = ''
    MessagePlugin.success({ content: autoSettings.value.enabled ? '自动备份计划已保存' : '自动备份计划已关闭', placement: 'bottom-right' })
  } catch (error) {
    MessagePlugin.error({ content: error.message || '保存自动备份计划失败', placement: 'bottom-right' })
  } finally {
    busyAction.value = ''
  }
}

async function runAutoBackup() {
  busyAction.value = 'auto-run'
  try {
    const result = await window.opsApi.runAutoBackupNow()
    if (result?.settings) autoSettings.value = { ...autoSettings.value, ...result.settings }
    MessagePlugin.success({ content: `已创建自动备份 ${result?.entry?.fileName || ''}`, placement: 'bottom-right' })
    await loadAutoBackupState()
  } catch (error) {
    MessagePlugin.error({ content: error.message || '立即自动备份失败', placement: 'bottom-right' })
    await loadAutoBackupState()
  } finally {
    busyAction.value = ''
  }
}

async function openAutoBackupDirectory(item) {
  busyAction.value = `auto-open-${item.id}`
  try {
    await window.opsApi.openAutoBackupDirectory(item.id)
  } catch (error) {
    MessagePlugin.error({ content: error.message || '无法打开自动备份目录', placement: 'bottom-right' })
  } finally {
    busyAction.value = ''
  }
}

async function inspectAutoHistoryBackup(item) {
  busyAction.value = `auto-inspect-${item.id}`
  try {
    const result = await window.opsApi.inspectAutoBackup(item.id)
    const summary = result?.summary
    MessagePlugin.success({ content: `校验通过：${summary?.fileCount || 0} 个数据文件，${formatBytes(summary?.sizeBytes)}`, placement: 'bottom-right' })
  } catch (error) {
    MessagePlugin.error({ content: error.message || '自动备份校验失败', placement: 'bottom-right' })
    await loadAutoBackupState()
  } finally {
    busyAction.value = ''
  }
}

async function restoreAutoHistoryBackup(item) {
  const confirmed = await window.opsApi.confirm({
    title: '确认恢复自动备份',
    message: `将从 ${item.fileName} 恢复本地数据。`,
    detail: '恢复前会保存当前同名文件的本机恢复点；完成后应用将立即重启。',
  })
  if (!confirmed) return
  busyAction.value = `auto-restore-${item.id}`
  try {
    await window.opsApi.restoreAutoBackup(item.id)
    MessagePlugin.success({ content: '自动备份已恢复，正在重启应用…', placement: 'bottom-right' })
    await window.opsApi.relaunchApp()
  } catch (error) {
    MessagePlugin.error({ content: error.message || '恢复自动备份失败', placement: 'bottom-right' })
    await loadAutoBackupState()
  } finally {
    busyAction.value = ''
  }
}

async function deleteAutoHistoryBackup(item) {
  const confirmed = await window.opsApi.confirm({
    title: item.availability === 'missing' ? '清理自动备份记录' : '删除自动备份',
    message: item.availability === 'missing' ? `将移除 ${item.fileName} 的缺失记录。` : `将永久删除 ${item.fileName}。`,
    detail: '此操作不会影响当前本地数据或本机恢复点，且无法撤销。',
  })
  if (!confirmed) return
  busyAction.value = `auto-delete-${item.id}`
  try {
    const result = await window.opsApi.deleteAutoBackup(item.id)
    MessagePlugin.success({ content: result?.deleted ? '自动备份文件及记录已删除' : '缺失的自动备份记录已清理', placement: 'bottom-right' })
    await loadAutoBackupState()
  } catch (error) {
    MessagePlugin.error({ content: error.message || '删除自动备份失败', placement: 'bottom-right' })
  } finally {
    busyAction.value = ''
  }
}

async function restorePoint(point) {
  const confirmed = await window.opsApi.confirm({
    title: '确认回滚本机恢复点',
    message: `将回滚 ${point.fileCount} 个本地数据文件。`,
    detail: '回滚前会额外创建当前数据的恢复点，完成后应用将立即重启。',
  })
  if (!confirmed) return
  busyAction.value = `restore-point-${point.id}`
  try {
    await window.opsApi.restoreDataRestorePoint(point.id)
    MessagePlugin.success({ content: '数据已回滚，正在重启应用…', placement: 'bottom-right' })
    await window.opsApi.relaunchApp()
  } catch (error) {
    MessagePlugin.error({ content: error.message || '回滚恢复点失败', placement: 'bottom-right' })
  } finally {
    busyAction.value = ''
  }
}

onMounted(loadDataManagementState)
</script>

<style scoped>
.data-management-page :deep(.btn-primary),
.data-management-page :deep(.btn-secondary),
.data-management-page :deep(.btn-danger) { height: var(--header-control-height); display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; border-radius: var(--radius-md); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast); }
.data-management-page :deep(.btn-primary) { border: 1px solid var(--primary); background: var(--primary); color: #fff; }
.data-management-page :deep(.btn-primary:hover:not(:disabled)) { border-color: var(--primary-hover); background: var(--primary-hover); box-shadow: var(--shadow-xs); }
.data-management-page :deep(.btn-secondary) { border: 1px solid var(--border); background: var(--card-bg); color: var(--text); }
.data-management-page :deep(.btn-secondary:hover:not(:disabled)) { border-color: color-mix(in srgb, var(--primary) 40%, var(--border)); color: var(--primary); background: var(--primary-soft); }
.data-management-page :deep(.btn-danger) { border: 1px solid color-mix(in srgb, var(--danger) 48%, var(--border)); background: var(--danger); color: #fff; }
.data-management-page :deep(.btn-danger:hover:not(:disabled)) { background: #dc2626; box-shadow: var(--shadow-xs); }
.data-management-page :deep(.btn-primary:disabled),
.data-management-page :deep(.btn-secondary:disabled),
.data-management-page :deep(.btn-danger:disabled) { cursor: not-allowed; opacity: .55; }
.data-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--content-gap); }
.data-summary-card { min-width: 0; padding: 16px 18px; }
.data-summary-card > span { display: block; color: var(--text-muted); font-size: 12px; }
.data-summary-card strong { display: block; margin-top: 6px; color: var(--text); font-size: 24px; line-height: 30px; }
.data-summary-card small { display: block; margin-top: 4px; color: var(--text-muted); font-size: 12px; line-height: 18px; }
.data-summary-card--warning strong { color: var(--warning); }
.section-status { display: inline-flex; align-items: center; gap: 5px; color: var(--success); font-size: 12px; white-space: nowrap; }
.validation-note { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 var(--spacing-md); padding: 10px 12px; border-radius: var(--radius-md); font-size: 12px; line-height: 18px; }
.validation-note--warning { border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border-light)); background: var(--warning-light); color: #92400e; }
.backup-group-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.backup-group { min-width: 0; display: flex; gap: 10px; align-items: flex-start; padding: 12px; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--card-bg); cursor: pointer; transition: border-color var(--transition-fast), background var(--transition-fast); }
.backup-group:hover { border-color: color-mix(in srgb, var(--primary) 35%, var(--border-light)); background: var(--primary-soft); }
.backup-group.is-disabled { opacity: .6; cursor: not-allowed; }
.backup-group input { width: 16px; height: 16px; flex: 0 0 auto; margin: 2px 0 0; accent-color: var(--primary); }
.backup-group-copy { min-width: 0; }
.backup-group-copy strong,.backup-group-copy small,.backup-group-copy em { display: block; }
.backup-group-copy strong { color: var(--text); font-size: 13px; line-height: 20px; }
.backup-group-copy small { margin-top: 2px; color: var(--text-muted); font-size: 12px; line-height: 18px; }
.backup-group-copy em { margin-top: 6px; color: var(--text-secondary); font-size: 11px; font-style: normal; }
.backup-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--spacing-md); margin-top: var(--spacing-md); }
.field-label { min-width: 0; display: grid; gap: 6px; color: var(--text-secondary); font-size: 12px; font-weight: 600; }
.field-input { width: 100%; height: var(--header-control-height); min-width: 0; padding: 0 11px; border: 1px solid var(--border-light); border-radius: var(--radius-md); outline: none; background: var(--card-bg); color: var(--text); font: inherit; font-weight: 400; transition: border-color var(--transition-fast), box-shadow var(--transition-fast); }
.field-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent); }
.panel-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--spacing-md); margin-top: var(--spacing-lg); }
.panel-actions p { color: var(--text-muted); font-size: 12px; line-height: 18px; }
.restore-controls { display: flex; align-items: end; gap: var(--spacing-md); }
.restore-password { flex: 1; max-width: 460px; }
.restore-preview { margin-top: var(--spacing-lg); padding: 16px; border: 1px solid color-mix(in srgb, var(--success) 25%, var(--border-light)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--success) 5%, var(--card-bg)); }
.restore-preview-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--spacing-md); }
.preview-label,.restore-preview-heading strong { display: block; }
.preview-label { color: var(--success); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.restore-preview-heading strong { margin-top: 3px; color: var(--text); font-size: 14px; line-height: 20px; word-break: break-all; }
.preview-time { flex: 0 0 auto; color: var(--text-muted); font-size: 12px; }
.preview-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
.preview-metrics div { padding: 9px 10px; border-radius: var(--radius-sm); background: var(--card-bg); }
.preview-metrics dt { color: var(--text-muted); font-size: 11px; }
.preview-metrics dd { margin-top: 3px; overflow: hidden; color: var(--text); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.preview-groups { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
.preview-groups span { padding: 4px 8px; border-radius: 99px; background: var(--card-bg); color: var(--text-secondary); font-size: 11px; }
.panel-actions--restore p { display: inline-flex; align-items: flex-start; gap: 5px; }
.restore-empty { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 100px; margin-top: var(--spacing-md); padding: 16px; border: 1px dashed var(--border-light); border-radius: var(--radius-md); color: var(--text-muted); font-size: 12px; text-align: center; }
.data-security-note { display: flex; align-items: flex-start; gap: 10px; padding: 14px 16px; border: 1px solid var(--border-light); border-radius: var(--radius-lg); background: color-mix(in srgb, var(--primary) 4%, var(--card-bg)); color: var(--text-secondary); }
.data-security-note > .t-icon { flex: 0 0 auto; margin-top: 2px; color: var(--primary); }
.data-security-note strong { color: var(--text); font-size: 13px; }
.data-security-note p { margin-top: 3px; color: var(--text-muted); font-size: 12px; line-height: 19px; }
.auto-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--spacing-md); margin-top: var(--spacing-md); }
.auto-directory-field { grid-column: 1 / -1; }
.path-control { display: flex; gap: 8px; min-width: 0; }
.path-control .field-input { min-width: 0; }
.toggle-field { display: flex; align-items: flex-start; gap: 10px; min-height: var(--header-control-height); padding: 10px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-md); color: var(--text-secondary); cursor: pointer; }
.toggle-field input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--primary); }
.toggle-field strong,.toggle-field small { display: block; }
.toggle-field strong { color: var(--text); font-size: 13px; line-height: 18px; }
.toggle-field small { margin-top: 2px; color: var(--text-muted); font-size: 11px; line-height: 16px; }
.backup-group-grid--auto { margin-top: var(--spacing-lg); }
.auto-status-line { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: var(--spacing-md); color: var(--text-muted); font-size: 12px; line-height: 18px; }
.panel-action-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.recovery-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--spacing-lg); margin-top: var(--spacing-md); }
.recovery-column { min-width: 0; }
.subsection-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-md); margin-bottom: 10px; color: var(--text); font-size: 13px; }
.subsection-heading span { color: var(--text-muted); font-size: 11px; }
.history-list { display: grid; gap: 8px; }
.history-item { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-md); padding: 10px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--card-bg); }
.history-item > div { min-width: 0; }
.history-item strong,.history-item small { display: block; }
.history-item strong { overflow: hidden; color: var(--text); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.history-item small { margin-top: 2px; overflow: hidden; color: var(--text-muted); font-size: 11px; line-height: 17px; text-overflow: ellipsis; white-space: nowrap; }
.history-item > span { flex: 0 0 auto; color: var(--success); font-size: 11px; font-weight: 600; }
.history-item--failed { border-color: color-mix(in srgb, var(--danger) 32%, var(--border-light)); }
.history-item--missing { border-color: color-mix(in srgb, var(--warning) 32%, var(--border-light)); }
.history-item > .history-item-side { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; }
.history-item-side > span { flex: 0 0 auto; color: var(--success); font-size: 11px; font-weight: 600; white-space: nowrap; }
.history-item--failed .history-item-side > span { color: var(--danger); }
.history-item-side > .history-status--missing { color: var(--warning); }
.history-item-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.history-item-actions .btn-secondary,.history-item-actions .btn-danger { flex: 0 0 auto; height: 30px; padding: 0 9px; font-size: 11px; }
.history-item-actions .btn-danger--compact { border-color: color-mix(in srgb, var(--danger) 48%, var(--border)); background: var(--card-bg); color: var(--danger); }
.history-item-actions .btn-danger--compact:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 8%, var(--card-bg)); box-shadow: none; }
.history-item--restore-point .btn-secondary { flex: 0 0 auto; }
.section-status--muted { color: var(--text-muted); background: var(--bg-soft); }
@media (max-width: 900px) { .data-summary,.preview-metrics,.recovery-grid { grid-template-columns: 1fr; } .backup-group-grid { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .backup-form-grid,.auto-settings-grid { grid-template-columns: 1fr; } .path-control { flex-direction: column; } .path-control .btn-secondary { width: 100%; } .restore-controls { align-items: stretch; flex-direction: column; } .restore-password { max-width: none; } .restore-preview-heading,.history-item--auto,.history-item--auto > .history-item-side { align-items: stretch; flex-direction: column; } .preview-time { flex-basis: auto; } .history-item--auto .history-item-side,.history-item--auto .history-item-actions { justify-content: flex-start; } .panel-actions > .btn-primary,.panel-actions > .btn-danger,.restore-controls > .btn-secondary { width: 100%; justify-content: center; } }
</style>
