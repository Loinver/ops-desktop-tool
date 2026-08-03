/**
 * 管理模型测试页可见期间的全局快捷键。
 * Keep-alive 页面在失活时必须移除监听，避免影响其他路由。
 */
export function useModelTestKeyboard({
  searchQuery,
  showScopeSettings,
  showModelListSettings,
  closeScopeSettings,
  closeModelListSettings
}) {
  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    return Boolean(target.closest("[contenteditable='true']"))
  }

  function focusSearchInput() {
    const input = document.querySelector('[data-model-test-search]')
    if (!input) return
    input.focus()
    input.select?.()
  }

  function onGlobalKeydown(event) {
    if (event.key === 'Escape') {
      if (showModelListSettings.value) {
        closeModelListSettings()
        return
      }
      if (showScopeSettings.value) {
        closeScopeSettings()
        return
      }
      if (searchQuery.value) {
        searchQuery.value = ''
        return
      }
      const active = document.activeElement
      if (active?.matches?.('[data-model-test-search]')) active.blur()
      return
    }

    // 斜杠聚焦搜索；输入框/对话框内不拦截。
    if (
      event.key === '/' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !showScopeSettings.value &&
      !showModelListSettings.value &&
      !isEditableTarget(event.target)
    ) {
      event.preventDefault()
      focusSearchInput()
    }
  }

  function attach() {
    window.addEventListener('keydown', onGlobalKeydown)
  }

  function detach() {
    window.removeEventListener('keydown', onGlobalKeydown)
  }

  return { attach, detach }
}
