import { computed, ref } from 'vue'

const THEME_KEY = 'ops-desktop.theme'
const THEME_MODES = Object.freeze(['system', 'light', 'dark'])
const themeMode = ref('system')
const theme = ref('light')
let colorSchemeQuery = null
let stopColorSchemeListener = null

function isThemeMode(value) {
  return THEME_MODES.includes(value)
}

function systemTheme() {
  return colorSchemeQuery?.matches ? 'dark' : 'light'
}

function resolveTheme(mode) {
  return mode === 'system' ? systemTheme() : mode
}

function applyTheme() {
  theme.value = resolveTheme(themeMode.value)
  document.documentElement.setAttribute('data-theme', theme.value)
  document.documentElement.setAttribute('data-theme-mode', themeMode.value)
}

function persistThemeMode() {
  try {
    window.localStorage.setItem(THEME_KEY, themeMode.value)
  } catch {}
}

function handleSystemThemeChange() {
  if (themeMode.value === 'system') applyTheme()
}

function watchSystemTheme() {
  stopColorSchemeListener?.()
  stopColorSchemeListener = null
  colorSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)') || null
  if (!colorSchemeQuery) return

  if (typeof colorSchemeQuery.addEventListener === 'function') {
    colorSchemeQuery.addEventListener('change', handleSystemThemeChange)
    stopColorSchemeListener = () =>
      colorSchemeQuery?.removeEventListener('change', handleSystemThemeChange)
  } else if (typeof colorSchemeQuery.addListener === 'function') {
    colorSchemeQuery.addListener(handleSystemThemeChange)
    stopColorSchemeListener = () => colorSchemeQuery?.removeListener(handleSystemThemeChange)
  }
}

export function initTheme() {
  watchSystemTheme()
  let saved
  try {
    saved = window.localStorage.getItem(THEME_KEY)
  } catch {}
  themeMode.value = isThemeMode(saved) ? saved : 'system'
  applyTheme()
}

export function useTheme() {
  const followsSystem = computed(() => themeMode.value === 'system')

  function setThemeMode(value) {
    if (!isThemeMode(value)) return false
    themeMode.value = value
    applyTheme()
    persistThemeMode()
    return true
  }

  function toggleTheme() {
    setThemeMode(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { followsSystem, setThemeMode, theme, themeMode, toggleTheme }
}

export { THEME_KEY, THEME_MODES }
