// #179: the browser test entrypoint must not proxy to production port 8000.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDevServerConfig } from './staging-dev-proxy.js'

const staging = createDevServerConfig('1')
assert.equal(staging.host, '127.0.0.1')
assert.equal(staging.port, 3001)
assert.equal(staging.strictPort, true)
assert.equal(staging.proxy['/v1'], 'http://127.0.0.1:8001')
assert.equal(staging.proxy['/health'], 'http://127.0.0.1:8001')
assert.deepEqual(staging.proxy['/ws'], { target: 'ws://127.0.0.1:8001', ws: true })
assert.doesNotMatch(JSON.stringify(staging), /(?:localhost|127\.0\.0\.1):8000/)
assert.doesNotMatch(JSON.stringify(staging), /0\.0\.0\.0/)

// Unmodified development workflow stays on its existing backend.
const normal = createDevServerConfig(undefined)
assert.equal(normal.port, 3000)
assert.equal(normal.proxy['/v1'], 'http://localhost:8000')
assert.equal(normal.proxy['/ws'].target, 'ws://localhost:8000')

// Incorrect opt-ins fail before Vite starts, rather than quietly using :8000.
for (const value of ['', '0', 'true', 'prod', '8000']) {
  assert.throws(() => createDevServerConfig(value), /must be unset or exactly 1/)
}

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
assert.equal(packageJson.scripts['dev:provider-staging'], 'IE_PROVIDER_STAGING_WEB=1 vite')
const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
assert.match(vite, /createDevServerConfig\(process\.env\.IE_PROVIDER_STAGING_WEB\)/)
console.log('#179 isolated Vite staging proxy happy and failure paths passed')
