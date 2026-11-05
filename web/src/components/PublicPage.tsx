import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LandingNav } from './LandingNav'
import './public-page.css'

export function PublicPage({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    const previous = document.title
    document.title = `${title} | Inference Exchange`
    return () => { document.title = previous }
  }, [title])
  return (
    <div className="ie-public-page">
      <LandingNav />
      <main id="public-main" className="ie-public-page-content" tabIndex={-1}>
        <p className="ie-public-page-label">Inference Exchange</p>
        <h1>{title}</h1>
        {children}
      </main>
      <footer className="ie-public-page-footer"><Link to="/">Inference Exchange</Link><Link to="/start">Getting Started</Link><Link to="/news">News</Link><Link to="/about">About Us</Link></footer>
    </div>
  )
}
