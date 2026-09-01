import { useEffect, useRef, useState, useCallback } from 'react'

/** Shared WebSocket hook with auto-reconnect and connection status. */
export function useWebSocket(path: string) {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<Array<{ type: string; timestamp: number; [k: string]: any }>>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number>()

  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}${path}`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      // Reconnect after 3s
      reconnectTimer.current = window.setTimeout(connect, 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        setEvents(prev => [...prev.slice(-99), ev])
      } catch { /* ignore */ }
    }
  }, [path])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { connected, events }
}

/** Hook to check if the coordinator API is reachable. */
export function useCoordinatorStatus() {
  const [online, setOnline] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const r = await fetch('/health', { signal: AbortSignal.timeout(3000) })
        if (!cancelled) setOnline(r.ok)
      } catch {
        if (!cancelled) setOnline(false)
      }
    }
    check()
    const interval = setInterval(check, 10000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return online
}
