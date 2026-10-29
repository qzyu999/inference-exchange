/**
 * Browser staging for #179 must never inherit the normal :8000 dev proxy.
 * This changes only the Vite dev server; it does not configure the API,
 * enable account creation, or modify the production reverse proxy.
 */
export function createDevServerConfig(stagingFlag) {
  if (stagingFlag !== undefined && stagingFlag !== '1') {
    throw new Error('IE_PROVIDER_STAGING_WEB must be unset or exactly 1')
  }

  const staging = stagingFlag === '1'
  const http = staging ? 'http://127.0.0.1:8001' : 'http://localhost:8000'
  const ws = staging ? 'ws://127.0.0.1:8001' : 'ws://localhost:8000'

  return {
    host: '127.0.0.1',
    port: staging ? 3001 : 3000,
    strictPort: staging,
    // /docs bundles ../docs/**/*.md
    fs: { allow: ['..'] },
    proxy: {
      '/v1': http,
      '/ws': { target: ws, ws: true },
      '/health': http,
    },
  }
}
