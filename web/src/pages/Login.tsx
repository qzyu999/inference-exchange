import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { C } from '../lib/theme'

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (mode === 'login') {
      const result = await login(email, password)
      setLoading(false)
      if (result.ok) {
        navigate('/chat')
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
          navigate('/chat')
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
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200/40 p-8 text-center">
          <h2 className="text-xl font-bold mb-2" style={{ color: C.blueBlack }}>Welcome!</h2>
          <p className="text-sm mb-6" style={{ color: '#888' }}>Your account is ready with $10 in free credits.</p>

          <div className="rounded-xl p-4 mb-4 text-left" style={{ background: '#edf7f1', border: '1px solid rgba(63,128,85,0.15)' }}>
            <div className="text-xs font-medium mb-1" style={{ color: C.green }}>Your API Key</div>
            <code className="text-xs font-mono break-all" style={{ color: C.blueBlack }}>{apiKey}</code>
          </div>

          <button
            onClick={() => { navigator.clipboard.writeText(apiKey); setCopied(true) }}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors mb-3"
            style={{ background: C.blueBlack, color: '#fff' }}
          >
            {copied ? 'Copied!' : 'Copy API Key'}
          </button>

          <button
            onClick={() => navigate('/chat')}
            className="w-full py-2.5 rounded-xl text-sm font-medium border transition-colors"
            style={{ color: '#888', borderColor: '#ddd' }}
          >
            Go to Chat
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200/40 p-8">
        <h1 className="text-2xl font-bold" style={{ color: C.blueBlack }}>
          {mode === 'login' ? 'Welcome back' : 'Create an account'}
        </h1>
        <p className="text-sm mt-1 mb-6" style={{ color: '#888' }}>
          {mode === 'login'
            ? 'Use your developer account to access the exchange.'
            : 'Get $10 in free credits to start.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label className="text-xs block mb-1" style={{ color: '#888' }}>Name</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Optional"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-300"
              />
            </div>
          )}
          <div>
            <label className="text-xs block mb-1" style={{ color: '#888' }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-300"
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: '#888' }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••••" required minLength={6}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 placeholder:text-gray-300"
            />
          </div>

          {error && (
            <div className="text-xs px-3 py-2 rounded-xl" style={{ background: '#fdf5f4', color: '#B7443B' }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 mt-1"
            style={{ background: C.blueBlack, color: '#fff' }}
          >
            {loading ? '...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 border-t border-gray-100" />
          <span className="text-xs" style={{ color: '#ccc' }}>or</span>
          <div className="flex-1 border-t border-gray-100" />
        </div>

        {/* GitHub placeholder */}
        <button
          disabled
          className="w-full py-2.5 rounded-xl text-sm font-medium border transition-colors"
          style={{ color: C.blueBlack, borderColor: '#ddd' }}
        >
          Continue with GitHub
        </button>

        {/* Toggle mode */}
        <div className="text-center mt-4">
          {mode === 'login' ? (
            <button onClick={() => { setMode('signup'); setError('') }} className="text-sm" style={{ color: C.gold }}>
              No account? Create one
            </button>
          ) : (
            <button onClick={() => { setMode('login'); setError('') }} className="text-sm" style={{ color: C.gold }}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
