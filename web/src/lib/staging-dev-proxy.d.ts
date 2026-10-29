/** Local Vite staging fixture for issue #179 (not an ingress or auth control). */
export function createDevServerConfig(stagingFlag: string | undefined): {
  host: string
  port: number
  strictPort: boolean
  fs: { allow: string[] }
  proxy: {
    '/v1': string
    '/ws': { target: string; ws: boolean }
    '/health': string
  }
}
