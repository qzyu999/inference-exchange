import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { githubLoginHref, safeNextPath } from '../lib/nav.js'
import { UI } from '../lib/theme'

const OAUTH_ERRORS: Record<string, string> = {
  state: 'Sign-in expired or was tampered with. Please try again.',
  github: 'GitHub sign-in failed. Please try again.',
  account_too_new: 'Your GitHub account is too new to sign up during the alpha.',
  email_taken: 'That email already has a password account. Sign in with your password instead.',
  signup_disabled: 'New alpha registrations are temporarily paused. Existing users can still sign in. Please try again later.',
  suspended: 'This account is suspended. Please contact the Inference Exchange operator.',
}

export function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const { login, signup } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const oauthError = OAUTH_ERRORS[params.get('error') || '']
  const next = safeNextPath(params.get('next'), '/home')
  const { data: authConfig } = useSWR('authConfig', api.authConfig)
  const passwordEnabled = authConfig?.password ?? false
  const githubEnabled = authConfig?.github ?? false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (mode === 'login') {
      const result = await login(email, password)
      setLoading(false)
      if (result.ok) {
        navigate(next)
      } else {
        setError(result.error || 'Login failed')
      }
    } else {
      const result = await signup(email, password, name)
      setLoading(false)
      if (result.ok) {
        if (result.api_key) {
          setApiKey(result.api_key)
        } else {
          navigate(next)
        }
      } else {
        setError(result.error || 'Signup failed')
      }
    }
  }

  // After signup: show API key
  if (apiKey) {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <div className="w-full max-w-sm bg-ui-surface rounded-2xl border border-ui-border p-8 text-center">
          <h2 className="text-xl font-bold mb-2" style={{ color: UI.text }}>Welcome!</h2>
          <p className="text-sm mb-6" style={{ color: UI.muted }}>Your account is ready with $10 in free credits.</p>

          <div className="rounded-xl p-4 mb-4 text-left" style={{ background: UI.successSurface, border: "1px solid var(--ui-border)" }}>
            <div className="text-xs font-medium mb-1" style={{ color: UI.success }}>Your API Key</div>
            <code className="text-xs font-mono break-all" style={{ color: UI.text }}>{apiKey}</code>
          </div>

          <button
            onClick={() => { navigator.clipboard.writeText(apiKey); setCopied(true) }}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors mb-3"
            style={{ background: UI.action, color: UI.onAction }}
          >
            {copied ? 'Copied!' : 'Copy API Key'}
          </button>

          <button
            onClick={() => navigate(next)}
            className="w-full py-2.5 rounded-xl text-sm font-medium border transition-colors"
            style={{ color: UI.muted, borderColor: UI.border }}
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="w-full max-w-sm bg-ui-surface rounded-2xl border border-ui-border p-8">
        <h1 className="text-2xl font-bold" style={{ color: UI.text }}>
          {mode === 'login' ? 'Welcome back' : 'Create an account'}
        </h1>
        <p className="text-sm mt-1 mb-6" style={{ color: UI.body }}>
          {mode === 'login'
            ? 'Sign in to Inference Exchange to chat, create API keys and see billing. A Cloudflare email check is not an Inference Exchange account.'
            : 'Get $10 in simulated alpha credits to start.'}
        </p>

        {oauthError && (
          <div role="alert" className="text-xs px-3 py-2 rounded-xl mb-3" style={{ background: UI.dangerSurface, color: UI.danger }}>
            {oauthError}
          </div>
        )}

        {githubEnabled && (
          <a
            href={githubLoginHref(next)}
            className="block w-full py-2.5 rounded-xl text-sm font-medium text-center transition-colors"
            style={{ background: UI.action, color: UI.onAction }}
          >
            Continue with GitHub
          </a>
        )}

        {githubEnabled && passwordEnabled && (
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 border-t border-ui-border" />
            <span className="text-xs" style={{ color: UI.muted }}>or</span>
            <div className="flex-1 border-t border-ui-border" />
          </div>
        )}

        {!githubEnabled && !passwordEnabled && (
          <div className="text-xs px-3 py-2 rounded-xl" style={{ background: UI.warningSurface, color: UI.accent }}>
            Sign-in is not configured on this server.
          </div>
        )}

        {passwordEnabled && <>
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label className="text-xs block mb-1" style={{ color: UI.muted }}>Name</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Optional"
                className="w-full px-4 py-2.5 border border-ui-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ui-warning placeholder:text-ui-muted"
              />
            </div>
          )}
          <div>
            <label className="text-xs block mb-1" style={{ color: UI.muted }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required
              className="w-full px-4 py-2.5 border border-ui-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ui-warning placeholder:text-ui-muted"
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: UI.muted }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••••" required minLength={6}
              className="w-full px-4 py-2.5 border border-ui-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ui-warning placeholder:text-ui-muted"
            />
          </div>

          {error && (
            <div className="text-xs px-3 py-2 rounded-xl" style={{ background: UI.dangerSurface, color: UI.danger }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 mt-1"
            style={{ background: UI.action, color: UI.onAction }}
          >
            {loading ? '...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {/* Toggle mode */}
        <div className="text-center mt-4">
          {mode === 'login' ? (
            <button onClick={() => { setMode('signup'); setError('') }} className="text-sm" style={{ color: UI.accent }}>
              No account? Create one
            </button>
          ) : (
            <button onClick={() => { setMode('login'); setError('') }} className="text-sm" style={{ color: UI.accent }}>
              Already have an account? Sign in
            </button>
          )}
        </div>
        </>}
      </div>
    </div>
  )
}
