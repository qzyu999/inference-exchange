// The same named landscape files are served by Vite locally and R2 in production.
// VITE_HERO_MEDIA_ORIGIN is public build-time config, never a credential.
// R2 object key: seedance_2_5_mountain_lake_21x9_1080p.mp4 (bucket root).
// Local Vite URL: /media/seedance_2_5_mountain_lake_21x9_1080p.mp4
export function heroMediaUrl(localPath, origin = '') {
  if (!/^\/media\/[a-zA-Z0-9_.-]+$/.test(localPath)) {
    throw new Error('Invalid local hero media path')
  }

  const base = String(origin || '').trim().replace(/\/+$/, '')
  if (!base) return localPath

  const parsed = new URL(base)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('VITE_HERO_MEDIA_ORIGIN must be a public HTTPS origin without a path')
  }

  return `${parsed.origin}${localPath.slice('/media'.length)}`
}
