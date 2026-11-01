import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { DOC_NAV, isIndexSlug, loadDoc, resolveDocLink } from '../lib/docs'
import { C } from '../lib/theme'

const REPO_BLOB = 'https://github.com/qzyu999/inference-exchange/blob/main/'

export function Docs() {
  const slug = (useParams()['*'] || '').replace(/\/$/, '')
  const [content, setContent] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = loadDoc(slug)
    setContent(null)
    setMissing(!load)
    load?.then(text => { if (!cancelled) setContent(text) })
    return () => { cancelled = true }
  }, [slug])

  const fromIndex = isIndexSlug(slug)

  return (
    <div className="flex gap-8 flex-col lg:flex-row">
      <nav aria-label="Documentation" className="lg:w-52 shrink-0 lg:sticky lg:top-6 self-start">
        {DOC_NAV.map(section => (
          <div key={section.title} className="mb-5">
            <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: C.gold }}>
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map(item => {
                const active = item.slug === slug
                return (
                  <li key={item.slug}>
                    <Link
                      to={`/docs${item.slug ? '/' + item.slug : ''}`}
                      aria-current={active ? 'page' : undefined}
                      className="block px-2 py-1 rounded-md text-[13px]"
                      style={{ color: active ? C.blueBlack : '#777', background: active ? '#ecebe6' : 'transparent', fontWeight: active ? 600 : 400 }}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <article className="docs-body flex-1 min-w-0 bg-white rounded-2xl border border-gray-200/40 p-6 md:p-8">
        {missing ? (
          <div>
            <h1>Page not found</h1>
            <p>No document exists at <code>/docs/{slug}</code>. <Link to="/docs">Go to the docs index</Link>.</p>
          </div>
        ) : content === null ? (
          <div className="text-sm" style={{ color: '#aaa' }}>Loading...</div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href = '', children }) => {
                const route = resolveDocLink(href, slug, fromIndex)
                if (route) return <Link to={route}>{children}</Link>
                // Links to code files (tests/, scripts/) go to the repo
                if (!/^[a-z]+:/i.test(href) && !href.startsWith('#') && !href.startsWith('/')) {
                  return <a href={REPO_BLOB + href.replace(/^(\.\.\/)+/, '')} target="_blank" rel="noreferrer">{children}</a>
                }
                const external = /^https?:/.test(href)
                return <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>{children}</a>
              },
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </article>
    </div>
  )
}
