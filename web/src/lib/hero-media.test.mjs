import assert from 'node:assert/strict'
import { heroMediaUrl } from './hero-media.js'

const input = '/media/seedance_2_5_mountain_lake_21x9_1080p.mp4'
assert.equal(heroMediaUrl(input), input)
assert.equal(heroMediaUrl(input, ''), input)
assert.equal(heroMediaUrl(input, 'https://media.example.test'), 'https://media.example.test/seedance_2_5_mountain_lake_21x9_1080p.mp4')
assert.equal(heroMediaUrl(input, 'https://media.example.test/'), 'https://media.example.test/seedance_2_5_mountain_lake_21x9_1080p.mp4')
assert.equal(heroMediaUrl('/media/seedance_2_5_mountain_lake_poster.webp', 'https://media.example.test'), 'https://media.example.test/seedance_2_5_mountain_lake_poster.webp')
for (const invalid of ['http://media.example.test', 'https://media.example.test/folder', 'https://user:pass@media.example.test', 'https://media.example.test/?t=1']) {
  assert.throws(() => heroMediaUrl(input, invalid), /public HTTPS origin/)
}
assert.throws(() => heroMediaUrl('/other/file.mp4', ''), /Invalid local hero media path/)
assert.throws(() => heroMediaUrl('/media/../../secret', ''), /Invalid local hero media path/)
console.log('Hero media origin mapping: local, CDN, and invalid-config cases passed')
