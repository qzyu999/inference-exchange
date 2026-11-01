// #174 / PRIV-004: public metadata must not promise confidentiality for L0/Open.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1]
assert.ok(description, 'page metadata must include a description')
assert.match(description, /L0\/Open/i)
assert.match(description, /plaintext prompts and responses/i)
assert.match(description, /not end-to-end encrypted/i)
assert.doesNotMatch(description, /(?:^|\.\s*)E2E encrypted\./i)

const landing = readFileSync(new URL('../pages/Landing.tsx', import.meta.url), 'utf8')
const chat = readFileSync(new URL('../pages/Chat.tsx', import.meta.url), 'utf8')
const provide = readFileSync(new URL('../pages/Provide.tsx', import.meta.url), 'utf8')
// Retain a correct, visible privacy notice at the point of use, without
// repeating transport-layer details throughout the landing-page story.
assert.doesNotMatch(landing, /Browser chat uses TLS|end-to-end encrypted/i)
assert.match(chat, /Browser chat uses TLS, not end-to-end encryption/)
assert.match(chat, /The coordinator can read prompts and responses/)
assert.match(chat, /responses regardless of the provider trust selection/)
assert.match(provide, /provider operator can inspect plaintext/)
console.log('#174 L0/Open public privacy claim checks passed')
