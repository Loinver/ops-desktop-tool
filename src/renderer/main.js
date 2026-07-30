import { createApp, defineComponent, h } from 'vue'
import { Icon } from 'tdesign-icons-vue-next'
import 'tdesign-vue-next/es/style/index.css'
import 'tdesign-vue-next/es/message/style/index.css'
import App from './App.vue'
import router from './router'
import pinia from './stores'
import './assets/styles/base.css'

const LocalIcon = defineComponent({
  name: 'LocalIcon',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => h(Icon, { ...attrs, loadDefaultIcons: false })
  },
})

function loadLocalIconSprite() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = './assets/icons/index.js'
    script.defer = true
    script.addEventListener('load', resolve, { once: true })
    script.addEventListener('error', () => reject(new Error('本地图标资源加载失败')), { once: true })
    document.head.appendChild(script)
  })
}

async function bootstrap() {
  try {
    await loadLocalIconSprite()
  } catch (error) {
    console.error(error)
  }

  const app = createApp(App)
  app.component('TIcon', LocalIcon)
  app.use(router)
  app.use(pinia)
  app.mount('#app')
}

void bootstrap()
