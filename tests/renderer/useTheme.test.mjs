import { beforeEach, describe, expect, it, vi } from 'vitest'

function installMatchMedia({ dark = false } = {}) {
  const listeners = new Set()
  const mediaQuery = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_type, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type, listener) => listeners.delete(listener)),
    emit(matches) {
      this.matches = matches
      for (const listener of listeners) listener({ matches, media: this.media })
    }
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mediaQuery)
  )
  return mediaQuery
}

async function loadThemeModule() {
  vi.resetModules()
  return import('../../src/renderer/composables/useTheme.js')
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-mode')
  vi.unstubAllGlobals()
})

describe('useTheme system appearance integration', () => {
  it('defaults to system appearance and follows live color-scheme changes', async () => {
    const mediaQuery = installMatchMedia({ dark: true })
    const mod = await loadThemeModule()

    mod.initTheme()
    const { theme, themeMode, followsSystem } = mod.useTheme()
    expect(themeMode.value).toBe('system')
    expect(followsSystem.value).toBe(true)
    expect(theme.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themeMode).toBe('system')

    mediaQuery.emit(false)
    expect(theme.value).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('keeps an explicit appearance when the system theme changes', async () => {
    window.localStorage.setItem('ops-desktop.theme', 'light')
    const mediaQuery = installMatchMedia({ dark: false })
    const mod = await loadThemeModule()

    mod.initTheme()
    const { theme, themeMode } = mod.useTheme()
    mediaQuery.emit(true)

    expect(themeMode.value).toBe('light')
    expect(theme.value).toBe('light')
  })

  it('persists system, light and dark appearance modes', async () => {
    installMatchMedia({ dark: false })
    const mod = await loadThemeModule()
    mod.initTheme()
    const { setThemeMode, theme, themeMode } = mod.useTheme()

    expect(setThemeMode('dark')).toBe(true)
    expect(themeMode.value).toBe('dark')
    expect(theme.value).toBe('dark')
    expect(window.localStorage.getItem(mod.THEME_KEY)).toBe('dark')

    expect(setThemeMode('system')).toBe(true)
    expect(themeMode.value).toBe('system')
    expect(theme.value).toBe('light')
    expect(window.localStorage.getItem(mod.THEME_KEY)).toBe('system')

    expect(setThemeMode('unsupported')).toBe(false)
    expect(themeMode.value).toBe('system')
  })

  it('keeps the compact toggle behavior by switching to an explicit opposite theme', async () => {
    installMatchMedia({ dark: true })
    const mod = await loadThemeModule()
    mod.initTheme()
    const { theme, themeMode, toggleTheme } = mod.useTheme()

    toggleTheme()
    expect(themeMode.value).toBe('light')
    expect(theme.value).toBe('light')

    toggleTheme()
    expect(themeMode.value).toBe('dark')
    expect(theme.value).toBe('dark')
  })
})
