import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

function formatVolume(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(4)}`
  if (usd > 0) return `$${usd.toFixed(6)}`
  return '$0'
}

function Stat({ value, label, highlight }: { value: string | number; label: string; highlight?: boolean }) {
  return (
    <div className="text-center px-6">
      <div className={`text-3xl font-bold tracking-tight ${highlight ? 'text-amber-600' : 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1.5 uppercase tracking-wider">{label}</div>
    </div>
  )
}

export function Landing() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 10000 })
  const { data: pricing } = useSWR('pricing', api.pricing, { refreshInterval: 10000 })

  return (
    <div className="space-y-24 pb-20">
      {/* Hero */}
      <div className="text-center pt-16 relative">
        {/* Subtle radial glow */}
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-amber-100/40 to-transparent rounded-full blur-3xl" />
        </div>

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

      {/* Live stats */}
      {stats && (
        <div className="flex justify-center">
          <div className="inline-flex divide-x divide-gray-100 bg-white rounded-2xl px-4 py-6 border border-gray-200/60 shadow-sm">
            <Stat value={stats.providers_online} label="Providers" />
            <Stat value={stats.models_available} label="Models" />
            <Stat value={stats.total_requests.toLocaleString()} label="Requests" />
            <Stat value={formatVolume(stats.total_volume_usd)} label="Volume" highlight />
          </div>
        </div>
      )}

      {/* How it works */}
      <div>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">How it works</h2>
          <p className="text-gray-400 mt-3 text-sm">Three parties. Nobody trusts anybody. Cryptography handles the rest.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {[
            { step: '01', title: 'You send a prompt', desc: 'Use the OpenAI SDK or our encrypted SDK. Your prompt is encrypted before it leaves.', color: 'from-blue-500 to-indigo-600' },
            { step: '02', title: 'The exchange matches', desc: 'Providers compete on price, speed, and trust. The best match wins. The exchange sees nothing.', color: 'from-amber-500 to-orange-600' },
            { step: '03', title: 'Inference runs privately', desc: 'Inside a hardened process the machine owner cannot observe. Response encrypted back to you.', color: 'from-emerald-500 to-teal-600' },
          ].map(s => (
            <div key={s.step} className="group relative bg-white rounded-2xl p-7 border border-gray-200/60 shadow-sm hover:shadow-md transition-shadow">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center mb-4`}>
                <span className="text-white text-xs font-bold">{s.step}</span>
              </div>
              <div className="font-semibold text-gray-900 mb-2">{s.title}</div>
              <div className="text-sm text-gray-500 leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Trust levels */}
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Choose your privacy level</h2>
          <p className="text-gray-400 mt-3 text-sm">From open to confidential. You pick the tradeoff.</p>
        </div>
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
      </div>

      {/* Features */}
      <div>
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Built for developers</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {[
            { icon: 'from-violet-500 to-purple-600', letter: 'AI', title: 'OpenAI compatible', desc: 'Change one line. Works with any OpenAI SDK, LangChain, Cursor, Continue.' },
            { icon: 'from-amber-500 to-orange-600', letter: 'E2E', title: 'End-to-end encrypted', desc: 'X25519 per-request forward secrecy. Nobody in the middle can read your data.' },
            { icon: 'from-emerald-500 to-teal-600', letter: '$', title: 'Competitive pricing', desc: 'Providers set prices. The matching engine finds you the best deal.' },
            { icon: 'from-blue-500 to-indigo-600', letter: '#', title: 'Per-token billing', desc: 'Pay for what you use. Sub-cent precision. 90% goes to providers.' },
            { icon: 'from-pink-500 to-rose-600', letter: 'RT', title: 'Real-time exchange', desc: 'Live depth chart, provider ladder, trade ticker. See the market move.' },
            { icon: 'from-gray-600 to-gray-800', letter: '<>', title: 'Open protocol', desc: 'OCIP is Apache 2.0. Anyone can implement a provider. Zero lock-in.' },
          ].map(f => (
            <div key={f.title} className="group bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${f.icon} flex items-center justify-center mb-4`}>
                <span className="text-white text-[10px] font-bold">{f.letter}</span>
              </div>
              <div className="font-semibold text-gray-900 mb-1.5">{f.title}</div>
              <div className="text-sm text-gray-500 leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      {pricing?.pricing && pricing.pricing.length > 0 && (
        <div>
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Live market prices</h2>
            <p className="text-gray-400 mt-3 text-sm">Updated in real time from the exchange.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl mx-auto">
            {pricing.pricing.map(p => (
              <div key={p.model} className="bg-white rounded-2xl p-7 border border-gray-200/60 shadow-sm text-center">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">{p.model}</div>
                <div className="text-4xl font-bold text-gray-900 tracking-tight">
                  ${p.output.toFixed(2)}
                </div>
                <div className="text-xs text-gray-400 mt-1">per million output tokens</div>
                <div className="text-xs text-gray-300 mt-3">
                  {p.providers_available} provider{p.providers_available !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
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
    </div>
  )
}
