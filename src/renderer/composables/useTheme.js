import { ref } from 'vue'

const THEME_KEY = 'ops-desktop.theme'
const theme = ref('light')

function applyTheme(value) {
  document.documentElement.setAttribute('data-theme', value)
  try { window.localStorage.setItem(THEME_KEY, value) } catch {}
}

export function initTheme() {
  let saved
  try { saved = window.localStorage.getItem(THEME_KEY) } catch {}
  if (saved === 'light' || saved === 'dark') {
    theme.value = saved
  } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    theme.value = 'dark'
  }
  applyTheme(theme.value)
}

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    applyTheme(theme.value)
  }
  return { theme, toggleTheme }
}
