import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { HeroScene } from '../components/HeroScene'

// ─── Helpers ─────────────────────────────────────────────────

function formatVolume(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(4)}`
  if (usd > 0) return `$${usd.toFixed(6)}`
  return '$0'
}

function useScrollProgress(ref: React.RefObject<HTMLDivElement | null>): number {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onScroll = () => {
      const rect = el.getBoundingClientRect()
      const total = el.scrollHeight - window.innerHeight
      const scrolled = -rect.top
      setProgress(Math.min(1, Math.max(0, scrolled / total)))
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [ref])

  return progress
}

/** Fade-in-on-scroll wrapper */
function Reveal({ children, className = '', delay = 0 }: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.15 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${className}`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(32px)',
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

// ─── Scroll overlay text panels ──────────────────────────────

function ScrollOverlay({ progress }: { progress: number }) {
  // Each overlay fades in and out at specific scroll ranges
  const overlays: {
    text: string
    sub?: string
    from: number
    peak: number
    to: number
  }[] = [
    {
      text: 'Inference Exchange',
      sub: 'Supply meets demand',
      from: 0.0,
      peak: 0.08,
      to: 0.22,
    },
    {
      text: 'Two forces converge',
      sub: 'Consumers bid. Providers offer. The exchange matches.',
      from: 0.15,
      peak: 0.25,
      to: 0.38,
    },
    {
      text: 'The intersection is the product',
      from: 0.32,
      peak: 0.42,
      to: 0.55,
    },
    {
      text: 'End-to-end encrypted',
      sub: 'The coordinator never sees your data. X25519 forward secrecy on every request.',
      from: 0.48,
      peak: 0.58,
      to: 0.68,
    },
    {
      text: 'Providers compete. You benefit.',
      sub: 'Price, speed, privacy — the matching engine optimizes for what you care about.',
      from: 0.60,
      peak: 0.70,
      to: 0.80,
    },
    {
      text: 'Private AI inference, powered by everyone.',
      from: 0.75,
      peak: 0.83,
      to: 0.93,
    },
  ]

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center">
      {overlays.map((o, i) => {
        let opacity = 0
        if (progress >= o.from && progress <= o.to) {
          if (progress <= o.peak) {
            opacity = (progress - o.from) / (o.peak - o.from)
          } else {
            opacity = 1 - (progress - o.peak) / (o.to - o.peak)
          }
        }
        opacity = Math.max(0, Math.min(1, opacity))

        // Subtle vertical shift synced with opacity
        const yShift = (1 - opacity) * 20

        return (
          <div
            key={i}
            className="absolute text-center px-6 max-w-2xl"
            style={{
              opacity,
              transform: `translateY(${yShift}px)`,
              transition: 'none',
            }}
          >
            <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight leading-tight">
              {o.text}
            </h2>
            {o.sub && (
              <p className="text-base md:text-lg text-gray-400 mt-4 leading-relaxed max-w-lg mx-auto">
                {o.sub}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Stat pill ───────────────────────────────────────────────

function Stat({ value, label, highlight }: { value: string | number; label: string; highlight?: boolean }) {
  return (
    <div className="text-center px-6">
      <div className={`text-3xl font-bold tracking-tight ${highlight ? 'text-amber-500' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className="text-xs text-gray-400 mt-1.5 uppercase tracking-wider">{label}</div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export function Landing() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 10000 })
  const { data: pricing } = useSWR('pricing', api.pricing, { refreshInterval: 10000 })

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const progress = useScrollProgress(scrollContainerRef)

  // Whether the scroll sequence is complete
  const sequenceDone = progress >= 0.95

  return (
    <>
      {/* ── Scroll sequence ──────────────────────────────── */}
      <div ref={scrollContainerRef} style={{ height: '500vh' }} className="relative">
        {/* Sticky canvas that stays in viewport during scroll */}
        <div className="sticky top-0 left-0 w-full h-screen overflow-hidden z-10">
          <HeroScene scrollProgress={progress} />
          <ScrollOverlay progress={progress} />

          {/* Scroll hint at the very start */}
          <div
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-30 transition-opacity duration-500"
            style={{ opacity: progress < 0.05 ? 1 : 0 }}
          >
            <span className="text-gray-500 text-xs tracking-wider uppercase">Scroll to explore</span>
            <div className="w-5 h-8 rounded-full border border-gray-600 flex items-start justify-center p-1.5">
              <div className="w-1 h-2 bg-gray-500 rounded-full animate-bounce" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Main landing content (below the scroll sequence) ── */}
      <div
        className="relative z-10 bg-[#fafafa]"
        style={{
          opacity: sequenceDone ? 1 : 0,
          transition: 'opacity 0.6s ease',
        }}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-28 pb-24">

          {/* ── Hero text + CTAs ─────────────────────────── */}
          <Reveal>
            <div className="text-center pt-20">
              <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 text-xs font-medium px-4 py-1.5 rounded-full mb-8 border border-amber-200/50">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Open protocol. Open marketplace. Your data stays yours.
              </div>

              <h1 className="text-5xl md:text-6xl font-bold text-gray-900 tracking-tight leading-[1.1] max-w-3xl mx-auto">
                Private AI inference,{' '}
                <span className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 bg-clip-text text-transparent">
                  powered by everyone.
                </span>
              </h1>

              <p className="text-lg text-gray-500 max-w-xl mx-auto mt-6 leading-relaxed">
                Providers compete to serve your requests. Prompts and responses are
                encrypted end-to-end. The coordinator never sees your data.
              </p>

              <div className="flex gap-3 justify-center mt-10">
                <Link to="/chat" className="group px-7 py-3.5 bg-gray-900 text-white rounded-2xl font-medium text-sm hover:bg-gray-800 transition-all shadow-lg shadow-gray-900/20 hover:shadow-xl hover:shadow-gray-900/30 hover:-translate-y-0.5">
                  Start a conversation
                  <span className="inline-block ml-1 group-hover:translate-x-0.5 transition-transform">&rarr;</span>
                </Link>
                <Link to="/providers" className="px-7 py-3.5 bg-white text-gray-700 rounded-2xl font-medium text-sm border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all">
                  Become a provider
                </Link>
              </div>
            </div>
          </Reveal>

          {/* ── Live stats ────────────────────────────────── */}
          {stats && (
            <Reveal>
              <div className="flex justify-center">
                <div className="inline-flex divide-x divide-gray-100 bg-white rounded-2xl px-4 py-6 border border-gray-200/60 shadow-sm">
                  <Stat value={stats.providers_online} label="Providers" />
                  <Stat value={stats.models_available} label="Models" />
                  <Stat value={stats.total_requests.toLocaleString()} label="Requests" />
                  <Stat value={formatVolume(stats.total_volume_usd)} label="Volume" highlight />
                </div>
              </div>
            </Reveal>
          )}

          {/* ── How it works ──────────────────────────────── */}
          <div>
            <Reveal>
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-gray-900 tracking-tight">How it works</h2>
                <p className="text-gray-400 mt-3 text-sm">Three parties. Nobody trusts anybody. Cryptography handles the rest.</p>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {[
                { step: '01', title: 'You send a prompt', desc: 'Use the OpenAI SDK or our encrypted SDK. Your prompt is encrypted before it leaves your device.', color: 'from-blue-500 to-indigo-600' },
                { step: '02', title: 'The exchange matches', desc: 'Providers compete on price, speed, and trust. The best match wins. The exchange sees nothing.', color: 'from-amber-500 to-orange-600' },
                { step: '03', title: 'Inference runs privately', desc: 'Inside a hardened process the machine owner cannot observe. Response encrypted back to you.', color: 'from-emerald-500 to-teal-600' },
              ].map((s, i) => (
                <Reveal key={s.step} delay={i * 120}>
                  <div className="group relative bg-white rounded-2xl p-7 border border-gray-200/60 shadow-sm hover:shadow-md transition-shadow h-full">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center mb-4`}>
                      <span className="text-white text-xs font-bold">{s.step}</span>
                    </div>
                    <div className="font-semibold text-gray-900 mb-2">{s.title}</div>
                    <div className="text-sm text-gray-500 leading-relaxed">{s.desc}</div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          {/* ── Trust levels ──────────────────────────────── */}
          <div className="max-w-2xl mx-auto">
            <Reveal>
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Choose your privacy level</h2>
                <p className="text-gray-400 mt-3 text-sm">From open to confidential. You pick the tradeoff.</p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="bg-white rounded-2xl p-8 border border-gray-200/60 shadow-sm">
                {[
                  { level: 'L0', name: 'Open', desc: 'No isolation. Fast and cheap. Good for non-sensitive work.', color: 'bg-gray-400', bar: 'w-1/12' },
                  { level: 'L1', name: 'Contained', desc: 'Requests encrypted in transit. Provider runs any engine.', color: 'bg-blue-500', bar: 'w-4/12' },
                  { level: 'L2', name: 'Hardened', desc: 'Hardened binary. Debugger blocked. Requires kernel exploit.', color: 'bg-amber-500', bar: 'w-8/12' },
                  { level: 'L3', name: 'Confidential', desc: 'Hardware memory encryption. Even the hypervisor cannot read.', color: 'bg-emerald-600', bar: 'w-full' },
                ].map((t, i) => (
                  <div key={t.level} className={`flex items-center gap-5 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                    <div className={`w-10 h-10 rounded-xl ${t.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                      {t.level}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">{t.name}</span>
                      </div>
                      <div className="text-sm text-gray-500">{t.desc}</div>
                      <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${t.color} rounded-full ${t.bar} transition-all`} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* ── Features ──────────────────────────────────── */}
          <div>
            <Reveal>
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Built for developers</h2>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
              {[
                { icon: 'from-violet-500 to-purple-600', letter: 'AI', title: 'OpenAI compatible', desc: 'Change one line. Works with any OpenAI SDK, LangChain, Cursor, Continue.' },
                { icon: 'from-amber-500 to-orange-600', letter: 'E2E', title: 'End-to-end encrypted', desc: 'X25519 per-request forward secrecy. Nobody in the middle can read your data.' },
                { icon: 'from-emerald-500 to-teal-600', letter: '$', title: 'Competitive pricing', desc: 'Providers set prices. The matching engine finds you the best deal.' },
                { icon: 'from-blue-500 to-indigo-600', letter: '#', title: 'Per-token billing', desc: 'Pay for what you use. Sub-cent precision. 90% goes to providers.' },
                { icon: 'from-pink-500 to-rose-600', letter: 'RT', title: 'Real-time exchange', desc: 'Live depth chart, provider ladder, trade ticker. See the market move.' },
                { icon: 'from-gray-600 to-gray-800', letter: '<>', title: 'Open protocol', desc: 'OCIP is Apache 2.0. Anyone can implement a provider. Zero lock-in.' },
              ].map((f, i) => (
                <Reveal key={f.title} delay={i * 80}>
                  <div className="group bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 h-full">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${f.icon} flex items-center justify-center mb-4`}>
                      <span className="text-white text-[10px] font-bold">{f.letter}</span>
                    </div>
                    <div className="font-semibold text-gray-900 mb-1.5">{f.title}</div>
                    <div className="text-sm text-gray-500 leading-relaxed">{f.desc}</div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          {/* ── Pricing ───────────────────────────────────── */}
          {pricing?.pricing && pricing.pricing.length > 0 && (
            <div>
              <Reveal>
                <div className="text-center mb-10">
                  <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Live market prices</h2>
                  <p className="text-gray-400 mt-3 text-sm">Updated in real time from the exchange.</p>
                </div>
              </Reveal>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl mx-auto">
                {pricing.pricing.map((p: any, i: number) => (
                  <Reveal key={p.model} delay={i * 100}>
                    <div className="bg-white rounded-2xl p-7 border border-gray-200/60 shadow-sm text-center h-full">
                      <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">{p.model}</div>
                      <div className="text-4xl font-bold text-gray-900 tracking-tight">
                        ${p.output.toFixed(2)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">per million output tokens</div>
                      <div className="text-xs text-gray-300 mt-3">
                        {p.providers_available} provider{p.providers_available !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          )}

          {/* ── CTA ───────────────────────────────────────── */}
          <Reveal>
            <div className="relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-3xl" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(251,191,36,0.1),transparent_60%)] rounded-3xl" />
              <div className="relative text-center py-16 px-8 max-w-4xl mx-auto">
                <h2 className="text-3xl font-bold text-white tracking-tight mb-4">Ready to try it?</h2>
                <p className="text-gray-400 mb-10 max-w-lg mx-auto text-sm leading-relaxed">
                  No signup needed for the playground. Or create an account and get $10 in free credits.
                </p>
                <div className="flex gap-3 justify-center">
                  <Link to="/chat" className="px-7 py-3.5 bg-white text-gray-900 rounded-2xl font-medium text-sm hover:bg-gray-100 transition-colors shadow-lg">
                    Open playground
                  </Link>
                  <Link to="/login" className="px-7 py-3.5 bg-gray-700 text-white rounded-2xl font-medium text-sm border border-gray-600 hover:bg-gray-600 transition-colors">
                    Create account
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>

        </div>
      </div>
    </>
  )
}
