import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createDevServerConfig } from './src/lib/staging-dev-proxy.js'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: createDevServerConfig(process.env.IE_PROVIDER_STAGING_WEB),
})
