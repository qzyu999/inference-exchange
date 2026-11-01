import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createDevServerConfig } from './src/lib/staging-dev-proxy.js'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // The Stream player lazy-imports hls.js. If Vite discovers that import only
  // after React and React Router are already loaded, dev-time dependency
  // re-optimization may mix two React chunk generations and crash hooks.
  // Pre-bundle the dynamic dependency up front and resolve one React copy.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom', 'hls.js'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: createDevServerConfig(mode),
}))
