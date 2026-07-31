<template>
  <div class="page data-management-page">
    <header class="page-header">
      <div class="page-heading">
        <div class="page-eyebrow"><t-icon name="save" /> DATA &amp; BACKUP</div>
        <h2 class="page-title">本地数据管理</h2>
        <p class="page-desc">按功能分类导出加密备份；恢复前会先校验内容，并为当前数据保留本机恢复点。</p>
      </div>
      <div class="page-actions">
        <button class="btn-secondary" type="button" :disabled="loading || busy" @click="loadOverview">
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

const busy = computed(() => Boolean(busyAction.value))
const availableGroupCount = computed(() => overview.value.groups.filter(group => group.available).length)
const totalFiles = computed(() => overview.value.groups.reduce((total, group) => total + group.fileCount, 0))
const totalSize = computed(() => overview.value.groups.reduce((total, group) => total + group.sizeBytes, 0))
const invalidFiles = computed(() => overview.value.groups.flatMap(group => group.invalidFiles || []))
const selectedFileCount = computed(() => overview.value.groups
  .filter(group => selectedGroups.value.includes(group.id))
  .reduce((total, group) => total + group.fileCount, 0))
const canExport = computed(() => selectedGroups.value.length > 0 && backupPassword.value.length >= 8 && backupPassword.value === backupPasswordConfirm.value)

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

onMounted(loadOverview)
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
@media (max-width: 900px) { .data-summary,.preview-metrics { grid-template-columns: 1fr; } .backup-group-grid { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .backup-form-grid { grid-template-columns: 1fr; } .restore-controls { align-items: stretch; flex-direction: column; } .restore-password { max-width: none; } .restore-preview-heading { flex-direction: column; } .preview-time { flex-basis: auto; } .panel-actions > .btn-primary,.panel-actions > .btn-danger,.restore-controls > .btn-secondary { width: 100%; justify-content: center; } }
</style>
