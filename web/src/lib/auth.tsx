import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

interface User {
  user_id: string
  email: string
  name: string
  balance_usd: number
  total_spent_usd: number
  requests_made: number
  tokens_consumed: number
  api_keys: number
  api_key?: string  // stored from signup, used by Chat
}

interface AuthContext {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  signup: (email: string, password: string, name?: string) => Promise<{ ok: boolean; error?: string; api_key?: string }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthContext>({
  user: null,
  loading: true,
  login: async () => ({ ok: false }),
  signup: async () => ({ ok: false }),
  logout: async () => {},
  refresh: async () => {},
})

export function useAuth() {
  return useContext(Ctx)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/v1/auth/me', { credentials: 'include' })
      if (r.ok) {
        const data = await r.json()
        if (data.user_id) {
          // Restore API key from localStorage if available
          const savedKey = localStorage.getItem('ie_user_api_key')
          setUser({ ...data, api_key: savedKey || undefined } as User)
        } else {
          setUser(null)
        }
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Refresh balance periodically when logged in
  useEffect(() => {
    if (!user) return
    const interval = setInterval(refresh, 15000)  // every 15s
    return () => clearInterval(interval)
  }, [user, refresh])

  const login = async (email: string, password: string) => {
    try {
      const r = await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      const data = await r.json()
      if (r.ok) {
        await refresh()
        return { ok: true }
      }
      return { ok: false, error: data.error || 'Login failed' }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  const signup = async (email: string, password: string, name?: string) => {
    try {
      const r = await fetch('/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, name: name || '' }),
      })
      const data = await r.json()
      if (r.ok) {
        await refresh()
        // Store API key for use in Chat
        if (data.api_key) {
          localStorage.setItem('ie_user_api_key', data.api_key)
          localStorage.setItem('ie_api_key', data.api_key)  // Also set for Chat page
        }
        return { ok: true, api_key: data.api_key }
      }
      return { ok: false, error: data.error || 'Signup failed' }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  }

  const logout = async () => {
    await fetch('/v1/auth/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
  }

  return (
    <Ctx.Provider value={{ user, loading, login, signup, logout, refresh }}>
      {children}
    </Ctx.Provider>
  )
}
