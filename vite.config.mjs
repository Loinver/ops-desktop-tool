import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  root: 'src/renderer',
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('tdesign')) return 'tdesign'
          if (
            id.includes('/vue/') ||
            id.includes('/@vue/') ||
            id.includes('vue-router') ||
            id.includes('pinia')
          ) {
            return 'vue-vendor'
          }
        }
      }
    }
  },
  server: {
    port: 5173
  }
})
