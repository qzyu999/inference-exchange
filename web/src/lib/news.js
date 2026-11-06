/** Parse the documented single-line front matter; reject mistakes at build time. */
export function parseNewsPost(path, source) {
  const slug = path.split('/').pop().replace(/\.md$/, '')
  const fail = message => { throw new Error(`${path}: ${message}`) }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('use a lowercase, hyphenated filename')
  const match = source.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) fail('expected front matter between --- lines')
  const meta = {}
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue
    const field = line.match(/^(title|date|summary|draft):\s*(.+)$/)
    if (!field || field[1] in meta) fail('unknown or duplicate metadata field')
    let value = field[2].trim()
    if (value.startsWith('"')) {
      try { value = JSON.parse(value) } catch { fail('invalid quoted value') }
    }
    if (typeof value !== 'string' || !value.trim()) fail('metadata must be nonempty text')
    meta[field[1]] = value
  }
  for (const field of ['title', 'date', 'summary']) if (!meta[field]) fail(`missing ${field}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) fail('date must be YYYY-MM-DD')
  const date = new Date(`${meta.date}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== meta.date) fail('invalid calendar date')
  if (meta.draft && !['true', 'false'].includes(meta.draft)) fail('draft must be true or false')
  if (!match[2].trim()) fail('post body is empty')
  return { slug, title: meta.title, date: meta.date, summary: meta.summary, draft: meta.draft === 'true', body: match[2].trim() }
}

export function collectNewsPosts(files) {
  const posts = Object.entries(files).map(([path, source]) => parseNewsPost(path, source))
  if (new Set(posts.map(post => post.slug)).size !== posts.length) throw new Error('Duplicate news slug')
  return posts.filter(post => !post.draft).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
}

export function formatNewsDate(date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}
