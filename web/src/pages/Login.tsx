import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

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
        navigate('/')
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
          navigate('/')
        }
      } else {
        setError(result.error || 'Signup failed')
      }
    }
  }

  // After signup, show the API key before redirecting
  if (apiKey) {
    return (
      <div className="max-w-md mx-auto mt-20">
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-bold">IE</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Welcome!</h2>
          <p className="text-sm text-gray-500 mb-6">Your account is ready with $10.00 in free credits.</p>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 text-left">
            <div className="text-xs font-medium text-emerald-700 mb-1">Your API Key (save this now)</div>
            <code className="text-sm font-mono text-gray-800 break-all">{apiKey}</code>
          </div>

          <button
            onClick={() => { navigator.clipboard.writeText(apiKey); setCopied(true) }}
            className="w-full py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors mb-3"
          >
            {copied ? 'Copied!' : 'Copy API Key'}
          </button>

          <button
            onClick={() => navigate('/')}
            className="w-full py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto mt-20">
      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-bold">IE</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">
            {mode === 'login' ? 'Sign in' : 'Create an account'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'login' ? 'Access your inference exchange account' : 'Get $10 in free credits to start'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Name (optional)"
              className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 placeholder:text-gray-300"
            />
          )}
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" required
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 placeholder:text-gray-300"
          />
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" required minLength={6}
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 placeholder:text-gray-300"
          />

          {error && (
            <div className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-2">{error}</div>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {loading ? '...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="text-center mt-4">
          {mode === 'login' ? (
            <button onClick={() => { setMode('signup'); setError('') }} className="text-sm text-amber-600 hover:text-amber-700">
              Don't have an account? Sign up
            </button>
          ) : (
            <button onClick={() => { setMode('login'); setError('') }} className="text-sm text-amber-600 hover:text-amber-700">
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
