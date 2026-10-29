import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { loginHref } from '../lib/nav.js'
import { C } from '../lib/theme'

export function Provide() {
  const { user, loading } = useAuth()

  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200/60 p-6 md:p-8 space-y-4">
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.gold }}>
          Apple Silicon · Initial alpha · L0 Open
        </div>
        <h2 className="text-2xl font-bold" style={{ color: C.blueBlack }}>
          Provide compute from your Mac
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: '#777' }}>
          Inference Exchange connects your local inference server to consumers over an outbound,
          authenticated connection. Apple Silicon on macOS with a GGUF model and Metal-enabled
          llama.cpp is our initial provider platform.
        </p>
        <div className="rounded-xl p-4 text-sm" style={{ background: '#fdf6ec', color: C.blueBlack }}>
          <strong>Provider enrollment is being prepared.</strong> We have proven an operator-managed
          Mac mini connection, but self-service machine registration and downloads are not live yet.
          This page will become the guided setup flow. It does not issue credentials or claim your
          hardware has been approved.
        </div>
        {!loading && !user && (
          <Link to={loginHref('/provide')} className="inline-block px-4 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: C.blueBlack, color: '#fff' }}>
            Sign in with GitHub
          </Link>
        )}
        {!loading && user && (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: '#888' }}>
              Signed in as {user.name || user.email}. Provider enrollment will open after
              the self-service rollout and safety checks.
            </p>
            <Link to="/dashboard" className="inline-block text-sm underline" style={{ color: C.gold }}>
              View your live provider dashboard
            </Link>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="bg-white rounded-2xl border border-gray-200/60 p-6 space-y-3">
          <h3 className="font-semibold" style={{ color: C.blueBlack }}>Initial hardware compatibility</h3>
          <p className="text-sm" style={{ color: '#777' }}>
            Apple Silicon Macs are our supported alpha target. Specific macOS, model and agent
            versions must pass qualification before being labelled tested.
          </p>
          <p className="text-xs" style={{ color: '#888' }}>
            NVIDIA DGX Spark, CUDA workstations and Linux providers are planned for a later sprint,
            not currently supported for enrollment.
          </p>
        </section>
        <section className="bg-white rounded-2xl border border-gray-200/60 p-6 space-y-3">
          <h3 className="font-semibold" style={{ color: C.blueBlack }}>Security and earnings</h3>
          <p className="text-sm" style={{ color: '#777' }}>
            Initial providers run at L0 (Open). The provider operator can inspect plaintext.
            A model's presence on the market is not proof of L2 hardening or remote attestation.
          </p>
          <p className="text-xs" style={{ color: '#888' }}>
            Alpha credits and earnings are simulated. There are no real payouts or withdrawals.
          </p>
        </section>
      </div>

      <div className="flex flex-wrap gap-3">
        <a href="https://github.com/qzyu999/inference-exchange/blob/main/docs/guides/getting-started.md"
          target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 rounded-xl text-sm font-medium border"
          style={{ borderColor: '#ddd', color: C.blueBlack }}>
          Existing manual developer setup guide
        </a>
        <Link to="/providers" className="px-4 py-2.5 rounded-xl text-sm font-medium border"
          style={{ borderColor: '#ddd', color: C.blueBlack }}>
          View live providers
        </Link>
      </div>
    </div>
  )
}
