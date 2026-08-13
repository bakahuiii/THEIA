import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { mainRendererMetaCsp } from './electron/renderer-security.mjs'

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    {
      name: 'theia-main-renderer-csp',
      transformIndexHtml(html) {
        return html.replace('__THEIA_MAIN_CSP__', mainRendererMetaCsp(command === 'serve'))
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: false,
    watch: {
      // Avoid EBUSY errors from watching Electron build output and large rendered-page snapshots
      ignored: ['**/release-bin/**', '**/.rendered-pages*/**', '**/.session-inspection*/**'],
    },
  },
  build: {
    target: 'es2022',
  },
}))
