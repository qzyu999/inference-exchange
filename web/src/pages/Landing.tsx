import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm">
      <div className="text-3xl mb-3">{icon}</div>
      <div className="font-semibold text-gray-900 mb-1">{title}</div>
      <div className="text-sm text-gray-500 leading-relaxed">{desc}</div>
    </div>
  )
}

function TrustLevel({ level, name, desc, color }: { level: string; name: string; desc: string; color: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0 ${color}`}>
        {level}
      </div>
      <div>
        <div className="font-semibold text-gray-900">{name}</div>
        <div className="text-sm text-gray-500">{desc}</div>
      </div>
    </div>
  )
}

export function Landing() {
  const { data: stats } = useSWR('stats', api.stats, { refreshInterval: 10000 })
  const { data: pricing } = useSWR('pricing', api.pricing, { refreshInterval: 10000 })

  return (
    <div className="space-y-20 pb-16">
      {/* Hero */}
      <div className="text-center pt-12">
        <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 text-sm font-medium px-4 py-1.5 rounded-full mb-6">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          Open protocol. Open marketplace. Your data stays yours.
        </div>
        <h1 className="text-5xl font-bold text-gray-900 tracking-tight leading-tight max-w-3xl mx-auto">
          Private AI inference,{' '}
          <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
            powered by everyone.
          </span>
        </h1>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto mt-5 leading-relaxed">
          An open marketplace where providers compete to serve your inference.
          Prompts and responses are encrypted end-to-end. The coordinator never sees your data.
        </p>
        <div className="flex gap-3 justify-center mt-8">
          <Link to="/chat" className="px-6 py-3 bg-gray-900 text-white rounded-xl font-medium text-sm hover:bg-gray-800 transition-colors shadow-lg shadow-gray-900/10">
            Start a conversation
          </Link>
          <Link to="/providers" className="px-6 py-3 bg-white text-gray-700 rounded-xl font-medium text-sm border border-gray-200 hover:border-gray-300 transition-colors">
            Become a provider
          </Link>
        </div>
      </div>

      {/* Live stats */}
      {stats && (
        <div className="flex justify-center">
          <div className="inline-flex gap-12 bg-white rounded-2xl px-10 py-6 border border-gray-200/60 shadow-sm">
            <Stat value={stats.providers_online} label="Providers online" />
            <Stat value={stats.models_available} label="Models available" />
            <Stat value={stats.total_requests.toLocaleString()} label="Requests served" />
            <Stat value={`$${stats.total_volume_usd.toFixed(2)}`} label="Volume traded" />
          </div>
        </div>
      )}

      {/* How it works */}
      <div>
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-gray-900">How it works</h2>
          <p className="text-gray-500 mt-2">Three parties. Nobody trusts anybody. The math handles the rest.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm text-center">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">👤</span>
            </div>
            <div className="font-semibold text-gray-900 mb-2">You send a prompt</div>
            <div className="text-sm text-gray-500">
              Use the OpenAI SDK or our private SDK. Your prompt is encrypted before it leaves your machine.
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚖️</span>
            </div>
            <div className="font-semibold text-gray-900 mb-2">The exchange matches</div>
            <div className="text-sm text-gray-500">
              Providers compete on price, speed, and trust level. The best match gets your request. The exchange never sees your data.
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm text-center">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🔒</span>
            </div>
            <div className="font-semibold text-gray-900 mb-2">Provider runs inference</div>
            <div className="text-sm text-gray-500">
              Inside a hardened process that even the machine owner can't observe. Response encrypted back to you.
            </div>
          </div>
        </div>
      </div>

      {/* Trust levels */}
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Choose your privacy level</h2>
          <p className="text-gray-500 mt-2">From open to confidential. You pick the tradeoff.</p>
        </div>
        <div className="bg-white rounded-2xl p-8 border border-gray-200/60 shadow-sm space-y-6">
          <TrustLevel level="L0" name="Open" desc="No isolation. Fast and cheap. Good for non-sensitive work." color="bg-gray-400" />
          <TrustLevel level="L1" name="Contained" desc="Requests encrypted in transit. Provider runs any engine." color="bg-blue-500" />
          <TrustLevel level="L2" name="Hardened" desc="Hardened binary. Debugger blocked. Requires kernel exploit to observe." color="bg-amber-500" />
          <TrustLevel level="L3" name="Confidential" desc="Hardware memory encryption (SEV-SNP / TDX). Even hypervisor can't read." color="bg-emerald-600" />
        </div>
      </div>

      {/* Features */}
      <div>
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-gray-900">Built for developers</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
          <FeatureCard icon="🔌" title="OpenAI compatible" desc="Change one line — your base_url. Works with any OpenAI SDK, LangChain, LlamaIndex, Cursor, Continue." />
          <FeatureCard icon="🔐" title="End-to-end encrypted" desc="X25519 per-request forward secrecy. The exchange never decrypts your prompts or responses." />
          <FeatureCard icon="⚡" title="Competitive pricing" desc="Providers set their own prices. The matching engine finds you the best deal for your preferences." />
          <FeatureCard icon="🧮" title="Per-token billing" desc="Pay for what you use. Sub-cent precision. 90% goes to providers, 10% platform." />
          <FeatureCard icon="📊" title="Real-time exchange" desc="Live depth chart, provider ladder, trade ticker. See the market as it moves." />
          <FeatureCard icon="🛡️" title="Open protocol" desc="OCIP is Apache 2.0. Anyone can implement a provider. No vendor lock-in." />
        </div>
      </div>

      {/* Pricing */}
      {pricing?.pricing && pricing.pricing.length > 0 && (
        <div>
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Current market prices</h2>
            <p className="text-gray-500 mt-2">Live from the exchange. Updated in real time.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
            {pricing.pricing.map(p => (
              <div key={p.model} className="bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm text-center">
                <div className="text-sm text-gray-500 mb-2">{p.model}</div>
                <div className="text-3xl font-bold text-gray-900">
                  ${p.output.toFixed(2)}
                  <span className="text-sm font-normal text-gray-400">/Mtok</span>
                </div>
                <div className="text-xs text-gray-400 mt-2">
                  {p.providers_available} provider{p.providers_available !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="text-center bg-gray-900 rounded-3xl py-14 px-8 max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold text-white mb-3">Ready to try it?</h2>
        <p className="text-gray-400 mb-8 max-w-lg mx-auto">
          No signup needed for the playground. Or grab an API key and integrate in 30 seconds.
        </p>
        <div className="flex gap-3 justify-center">
          <Link to="/chat" className="px-6 py-3 bg-white text-gray-900 rounded-xl font-medium text-sm hover:bg-gray-100 transition-colors">
            Open playground
          </Link>
          <Link to="/keys" className="px-6 py-3 bg-gray-800 text-white rounded-xl font-medium text-sm border border-gray-700 hover:bg-gray-700 transition-colors">
            Get API key
          </Link>
        </div>
      </div>
    </div>
  )
}
