import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { HeroScene } from '../components/HeroScene'

// ─── Brand palette ───────────────────────────────────────────
// RED        #B7443B    ORANGE     #D77A2F    GOLD       #C49A45
// WHITE      #D8D1BE    MAROON     #702F32    BLACK      #292B2A
// GREEN      #3F8055    TURQUOISE  #4D9A91    DEEP BLUE  #315B72
// BLUE-BLACK #292F35    INDIGO     #4A465F

const C = {
  red: '#B7443B',
  orange: '#D77A2F',
  gold: '#C49A45',
  white: '#D8D1BE',
  maroon: '#702F32',
  black: '#292B2A',
  green: '#3F8055',
  turquoise: '#4D9A91',
  deepBlue: '#315B72',
  blueBlack: '#292F35',
  indigo: '#4A465F',
}

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

// ─── Scroll overlay ──────────────────────────────────────────

function ScrollOverlay({ progress }: { progress: number }) {
  const overlays: {
    text: string
    sub?: string
    from: number
    peak: number
    to: number
  }[] = [
    { text: 'Inference Exchange', sub: 'Supply meets demand', from: 0.0, peak: 0.08, to: 0.22 },
    { text: 'Two forces converge', sub: 'Consumers bid. Providers offer. The exchange matches.', from: 0.15, peak: 0.25, to: 0.38 },
    { text: 'The intersection is the product', from: 0.32, peak: 0.42, to: 0.55 },
    { text: 'End-to-end encrypted', sub: 'The coordinator never sees your data. X25519 forward secrecy on every request.', from: 0.48, peak: 0.58, to: 0.68 },
    { text: 'Providers compete. You benefit.', sub: 'Price, speed, privacy — the matching engine optimizes for what you care about.', from: 0.60, peak: 0.70, to: 0.80 },
    { text: 'Private AI inference, powered by everyone.', from: 0.75, peak: 0.83, to: 0.93 },
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
        const yShift = (1 - opacity) * 20

        return (
          <div
            key={i}
            className="absolute text-center px-6 max-w-2xl"
            style={{ opacity, transform: `translateY(${yShift}px)`, transition: 'none' }}
          >
            <h2 style={{ color: C.white }} className="text-3xl md:text-5xl font-bold tracking-tight leading-tight">
              {o.text}
            </h2>
            {o.sub && (
              <p className="text-base md:text-lg mt-4 leading-relaxed max-w-lg mx-auto" style={{ color: '#8a8578' }}>
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
      <div className="text-3xl font-bold tracking-tight" style={{ color: highlight ? C.gold : C.blueBlack }}>
        {value}
      </div>
      <div className="text-xs mt-1.5 uppercase tracking-wider" style={{ color: '#888' }}>{label}</div>
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────

export function Landing() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 10000 })
  const { data: pricing } = useSWR('pricing', api.pricing, { refreshInterval: 10000 })

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const progress = useScrollProgress(scrollContainerRef)
  const [webglFailed, setWebglFailed] = useState(false)

  const sequenceDone = progress >= 0.95

  return (
    <>
      {/* ── Scroll sequence ──────────────────────────────── */}
      <div ref={scrollContainerRef} style={{ height: webglFailed ? '100vh' : '500vh' }} className="relative">
        <div className="sticky top-0 left-0 w-full h-screen overflow-hidden z-10">
          <HeroScene scrollProgress={progress} onInitFailed={() => setWebglFailed(true)} />

          {webglFailed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: C.black }}>
              <img
                src="/logo.svg"
                alt="Inference Exchange"
                className="w-40 h-40 md:w-56 md:h-56 animate-spin"
                style={{ animationDuration: '20s' }}
              />
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight mt-8 text-center px-6" style={{ color: C.white }}>
                Private AI inference,{' '}
                <span style={{ color: C.red }}>powered by everyone.</span>
              </h1>
              <p className="text-base mt-4 max-w-md text-center px-6" style={{ color: '#8a8578' }}>
                Providers compete to serve your requests. Prompts and responses are encrypted end-to-end.
              </p>
              <div className="flex gap-3 mt-8">
                <Link to="/chat" className="px-6 py-3 rounded-2xl font-medium text-sm transition-colors" style={{ background: C.white, color: C.black }}>
                  Start a conversation &rarr;
                </Link>
                <Link to="/providers" className="px-6 py-3 rounded-2xl font-medium text-sm border transition-colors" style={{ color: C.white, borderColor: 'rgba(216,209,190,0.3)', background: 'rgba(216,209,190,0.08)' }}>
                  Become a provider
                </Link>
              </div>
            </div>
          )}

          <ScrollOverlay progress={progress} />

          <div
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-30 transition-opacity duration-500"
            style={{ opacity: progress < 0.05 ? 1 : 0 }}
          >
            <span className="text-xs tracking-wider uppercase" style={{ color: '#8a8578' }}>Scroll to explore</span>
            <div className="w-5 h-8 rounded-full flex items-start justify-center p-1.5" style={{ border: `1px solid ${C.indigo}` }}>
              <div className="w-1 h-2 rounded-full animate-bounce" style={{ background: C.white }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────── */}
      <div
        className="relative z-10 bg-[#fafafa]"
        style={{ opacity: webglFailed || sequenceDone ? 1 : 0, transition: 'opacity 0.6s ease' }}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6 space-y-28 pb-24">

          {/* Hero text */}
          <Reveal>
            <div className="text-center pt-20">
              <div
                className="inline-flex items-center gap-2 text-xs font-medium px-4 py-1.5 rounded-full mb-8"
                style={{ background: 'rgba(196,154,69,0.08)', color: C.gold, border: `1px solid rgba(196,154,69,0.2)` }}
              >
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: C.gold }} />
                Open protocol. Open marketplace. Your data stays yours.
              </div>

              <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] max-w-3xl mx-auto" style={{ color: C.blueBlack }}>
                Private AI inference,{' '}
                <span className="bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(to right, ${C.gold}, ${C.orange}, ${C.red})` }}>
                  powered by everyone.
                </span>
              </h1>

              <p className="text-lg max-w-xl mx-auto mt-6 leading-relaxed" style={{ color: '#6b6b6b' }}>
                Providers compete to serve your requests. Prompts and responses are
                encrypted end-to-end. The coordinator never sees your data.
              </p>

              <div className="flex gap-3 justify-center mt-10">
                <Link to="/chat" className="group px-7 py-3.5 rounded-2xl font-medium text-sm transition-all shadow-lg hover:-translate-y-0.5" style={{ background: C.blueBlack, color: C.white }}>
                  Start a conversation
                  <span className="inline-block ml-1 group-hover:translate-x-0.5 transition-transform">&rarr;</span>
                </Link>
                <Link to="/providers" className="px-7 py-3.5 rounded-2xl font-medium text-sm border transition-all" style={{ color: C.blueBlack, borderColor: '#ddd' }}>
                  Become a provider
                </Link>
              </div>
            </div>
          </Reveal>

          {/* Live stats */}
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

          {/* How it works */}
          <div>
            <Reveal>
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold tracking-tight" style={{ color: C.blueBlack }}>How it works</h2>
                <p className="mt-3 text-sm" style={{ color: '#888' }}>Three parties. Nobody trusts anybody. Cryptography handles the rest.</p>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {[
                { step: '01', title: 'You send a prompt', desc: 'Use the OpenAI SDK or our encrypted SDK. Your prompt is encrypted before it leaves your device.', bg: C.deepBlue },
                { step: '02', title: 'The exchange matches', desc: 'Providers compete on price, speed, and trust. The best match wins. The exchange sees nothing.', bg: C.gold },
                { step: '03', title: 'Inference runs privately', desc: 'Inside a hardened process the machine owner cannot observe. Response encrypted back to you.', bg: C.green },
              ].map((s, i) => (
                <Reveal key={s.step} delay={i * 120}>
                  <div className="group relative bg-white rounded-2xl p-7 border border-gray-200/60 shadow-sm hover:shadow-md transition-shadow h-full">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: s.bg }}>
                      <span className="text-white text-xs font-bold">{s.step}</span>
                    </div>
                    <div className="font-semibold mb-2" style={{ color: C.blueBlack }}>{s.title}</div>
                    <div className="text-sm leading-relaxed" style={{ color: '#6b6b6b' }}>{s.desc}</div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          {/* Trust levels */}
          <div className="max-w-2xl mx-auto">
            <Reveal>
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold tracking-tight" style={{ color: C.blueBlack }}>Choose your privacy level</h2>
                <p className="mt-3 text-sm" style={{ color: '#888' }}>From open to confidential. You pick the tradeoff.</p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="bg-white rounded-2xl p-8 border border-gray-200/60 shadow-sm">
                {[
                  { level: 'L0', name: 'Open', desc: 'No isolation. Fast and cheap. Good for non-sensitive work.', color: '#999', bar: 'w-1/12' },
                  { level: 'L1', name: 'Contained', desc: 'Requests encrypted in transit. Provider runs any engine.', color: C.deepBlue, bar: 'w-4/12' },
                  { level: 'L2', name: 'Hardened', desc: 'Hardened binary. Debugger blocked. Requires kernel exploit.', color: C.gold, bar: 'w-8/12' },
                  { level: 'L3', name: 'Confidential', desc: 'Hardware memory encryption. Even the hypervisor cannot read.', color: C.green, bar: 'w-full' },
                ].map((t, i) => (
                  <div key={t.level} className={`flex items-center gap-5 py-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: t.color }}>
                      {t.level}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold" style={{ color: C.blueBlack }}>{t.name}</span>
                      <div className="text-sm" style={{ color: '#6b6b6b' }}>{t.desc}</div>
                      <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${t.bar} transition-all`} style={{ background: t.color }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* Features */}
          <div>
            <Reveal>
              <div className="text-center mb-12">
                <h2 className="text-3xl font-bold tracking-tight" style={{ color: C.blueBlack }}>Built for developers</h2>
              </div>
            </Reveal>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
              {[
                { bg: C.indigo, letter: 'AI', title: 'OpenAI compatible', desc: 'Change one line. Works with any OpenAI SDK, LangChain, Cursor, Continue.' },
                { bg: C.turquoise, letter: 'E2E', title: 'End-to-end encrypted', desc: 'X25519 per-request forward secrecy. Nobody in the middle can read your data.' },
                { bg: C.green, letter: '$', title: 'Competitive pricing', desc: 'Providers set prices. The matching engine finds you the best deal.' },
                { bg: C.deepBlue, letter: '#', title: 'Per-token billing', desc: 'Pay for what you use. Sub-cent precision. 90% goes to providers.' },
                { bg: C.red, letter: 'RT', title: 'Real-time exchange', desc: 'Live depth chart, provider ladder, trade ticker. See the market move.' },
                { bg: C.blueBlack, letter: '<>', title: 'Open protocol', desc: 'OCIP is Apache 2.0. Anyone can implement a provider. Zero lock-in.' },
              ].map((f, i) => (
                <Reveal key={f.title} delay={i * 80}>
                  <div className="group bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5 h-full">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: f.bg }}>
                      <span className="text-white text-[10px] font-bold">{f.letter}</span>
                    </div>
                    <div className="font-semibold mb-1.5" style={{ color: C.blueBlack }}>{f.title}</div>
                    <div className="text-sm leading-relaxed" style={{ color: '#6b6b6b' }}>{f.desc}</div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          {/* Pricing */}
          {pricing?.pricing && pricing.pricing.length > 0 && (
            <div>
              <Reveal>
                <div className="text-center mb-10">
                  <h2 className="text-3xl font-bold tracking-tight" style={{ color: C.blueBlack }}>Live market prices</h2>
                  <p className="mt-3 text-sm" style={{ color: '#888' }}>Updated in real time from the exchange.</p>
                </div>
              </Reveal>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl mx-auto">
                {pricing.pricing.map((p: any, i: number) => (
                  <Reveal key={p.model} delay={i * 100}>
                    <div className="bg-white rounded-2xl p-7 border border-gray-200/60 shadow-sm text-center h-full">
                      <div className="text-xs uppercase tracking-wider mb-3" style={{ color: '#888' }}>{p.model}</div>
                      <div className="text-4xl font-bold tracking-tight" style={{ color: C.blueBlack }}>
                        ${p.output.toFixed(2)}
                      </div>
                      <div className="text-xs mt-1" style={{ color: '#888' }}>per million output tokens</div>
                      <div className="text-xs mt-3" style={{ color: '#bbb' }}>
                        {p.providers_available} provider{p.providers_available !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl">
              <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${C.blueBlack}, ${C.black})` }} />
              <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 30% 50%, rgba(196,154,69,0.1), transparent 60%)` }} />
              <div className="relative text-center py-16 px-8 max-w-4xl mx-auto">
                <h2 className="text-3xl font-bold tracking-tight mb-4" style={{ color: C.white }}>Ready to try it?</h2>
                <p className="mb-10 max-w-lg mx-auto text-sm leading-relaxed" style={{ color: '#8a8578' }}>
                  No signup needed for the playground. Or create an account and get $10 in free credits.
                </p>
                <div className="flex gap-3 justify-center">
                  <Link to="/chat" className="px-7 py-3.5 rounded-2xl font-medium text-sm transition-colors shadow-lg" style={{ background: C.white, color: C.black }}>
                    Open playground
                  </Link>
                  <Link to="/login" className="px-7 py-3.5 rounded-2xl font-medium text-sm border transition-colors" style={{ background: 'rgba(216,209,190,0.08)', color: C.white, borderColor: 'rgba(216,209,190,0.2)' }}>
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
