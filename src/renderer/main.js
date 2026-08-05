import { createApp, defineComponent, h } from 'vue'
import { Icon } from 'tdesign-icons-vue-next'
import 'tdesign-vue-next/es/message/style/index.css'
import App from './App.vue'
import router from './router'
import pinia from './stores'
import './assets/styles/base.css'
import { initTheme, useTheme } from './composables/useTheme'
import { opsApi } from './api/opsApi.js'

const LocalIcon = defineComponent({
  name: 'LocalIcon',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => h(Icon, { ...attrs, loadDefaultIcons: false })
  }
})

function loadLocalIconSprite() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = './assets/icons/index.js'
    script.defer = true
    script.addEventListener('load', resolve, { once: true })
    script.addEventListener('error', () => reject(new Error('本地图标资源加载失败')), {
      once: true
    })
    document.head.appendChild(script)
  })
}

async function applyRuntimePlatform() {
  try {
    const appInfo = await opsApi.getAppInfo()
    const platform = ['darwin', 'win32', 'linux'].includes(appInfo?.platform)
      ? appInfo.platform
      : 'unknown'
    document.documentElement.dataset.platform = platform
  } catch {
    document.documentElement.dataset.platform = 'unknown'
  }
}

async function bootstrap() {
  try {
    await loadLocalIconSprite()
  } catch (error) {
    console.error(error)
  }

  initTheme()
  await applyRuntimePlatform()

  try {
    const nativeMenuDisposers = []
    const stopNativeMenuNavigation = opsApi.onAppNavigate?.((path) => {
      if (typeof path === 'string' && path.startsWith('/')) void router.push(path)
    })
    if (typeof stopNativeMenuNavigation === 'function') {
      nativeMenuDisposers.push(stopNativeMenuNavigation)
    }

    const { setThemeMode } = useTheme()
    const stopNativeThemeMode = opsApi.onAppThemeMode?.((mode) => setThemeMode(mode))
    if (typeof stopNativeThemeMode === 'function') nativeMenuDisposers.push(stopNativeThemeMode)

    if (nativeMenuDisposers.length > 0) {
      window.addEventListener(
        'beforeunload',
        () => nativeMenuDisposers.forEach((dispose) => dispose()),
        { once: true }
      )
    }
  } catch {
    // 浏览器预览环境没有 preload bridge，保持路由和主题正常启动。
  }

  const app = createApp(App)
  app.component('TIcon', LocalIcon)
  app.use(router)
  app.use(pinia)

  app.config.errorHandler = (err, _instance, info) => {
    console.error('[Vue error]', info, err)
    import('tdesign-vue-next/es/message/plugin.mjs').then(({ default: MessagePlugin }) => {
      MessagePlugin.error({ content: '页面发生错误，请刷新或重启应用', placement: 'bottom-right' })
    })
  }

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Unhandled promise]', event.reason)
  })

  app.mount('#app')
}

void bootstrap()
