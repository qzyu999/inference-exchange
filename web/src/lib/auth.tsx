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
          setUser(data as User)
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
