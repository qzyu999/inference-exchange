/**
 * API client for the Inference Exchange coordinator.
 * All requests include credentials (JWT cookie) for authenticated endpoints.
 */

const BASE = import.meta.env.VITE_API_BASE || ''

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: 'include' })
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
  return r.json()
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
  return r.json()
}

// --- Typed API calls ---

export interface HealthResponse {
  status: string
  providers: number
  models: string[]
  default_api_key?: string
}

export interface Provider {
  id: string
  name: string
  models: string[]
  trust_level: string
  hardware: string
  price_input: number
  price_output: number
  measured_tps: number
  load: number
  active_requests: number
  max_concurrent: number
  status: string
  encrypted: boolean
  uptime_seconds: number
}

export interface ExchangeStats {
  providers_online: number
  models_available: number
  total_requests: number
  total_volume_usd: number
  total_tokens: number
}

export interface PricingEntry {
  model: string
  input: number
  output: number
  cheapest_provider: string
  providers_available: number
}

export interface DepthLevel {
  price: number
  total_slots: number
  available_slots: number
  providers: number
  avg_throughput: number
  max_confidence: string
}

export interface Balance {
  consumer_id?: string
  user_id?: string
  balance_usd: number
  total_spent_usd: number
  requests_made: number
  tokens_consumed: number
}

export interface Trace {
  request_id: string
  timestamp: number
  model: string
  preference?: string
  status: string
  selected_provider?: string
  selected_price?: number
  selected_trust?: string
  encrypted?: boolean
  scoring?: Array<{
    name: string
    price: number
    trust: string
    load: number
    tps: number
    score: number
    selected: boolean
  }>
  providers_evaluated?: number
}

export interface ReputationEntry {
  provider_id: string
  score: number
  success_rate_ema: number
  total_requests: number
  total_successes: number
  total_failures: number
  is_degraded: boolean
}

export interface TPSEntry {
  provider_id: string
  model: string
  hardware: string
  estimated_tps: number
  observed_tps_ema: number
  effective_tps: number
  total_requests: number
  is_anomalous: boolean
}

// --- API functions ---

export const api = {
  health: () => get<HealthResponse>('/health?include_key=1'),
  me: () => get<Balance>('/v1/auth/me'),
  stats: () => get<ExchangeStats>('/v1/exchange/stats'),
  providers: () => get<{ providers: Provider[] }>('/v1/exchange/providers'),
  pricing: () => get<{ pricing: PricingEntry[] }>('/v1/exchange/pricing'),
  depth: () => get<{ asks: DepthLevel[]; total_capacity: number; available_capacity: number }>('/v1/exchange/depth'),
  balance: () => get<Balance>('/v1/exchange/balance'),
  history: () => get<{ transactions: Array<{ request_id: string; model: string; tokens: number; cost_usd: number; timestamp: number }> }>('/v1/exchange/history'),
  traces: () => get<{ traces: Trace[] }>('/v1/exchange/traces'),
  reputation: () => get<{ reputation: ReputationEntry[] }>('/v1/exchange/reputation'),
  tps: () => get<{ tps_stats: TPSEntry[] }>('/v1/exchange/tps'),
  telemetry: () => get<any>('/v1/exchange/telemetry'),
  models: () => get<{ object: string; data: Array<{ id: string }> }>('/v1/models'),
  searchModels: (q: string) => get<{ models: Array<{ repo_id: string; downloads: number; available_on_exchange: boolean; provider_count: number }> }>(`/v1/exchange/models/search?q=${encodeURIComponent(q)}`),
  adminState: () => get<any>('/v1/admin/state'),
  recentEvents: () => get<{ events: Array<{ type: string; timestamp: number; [key: string]: any }> }>('/v1/exchange/events/recent'),
  market: () => get<{ models: any[]; total_providers: number; total_models: number }>('/v1/exchange/market'),
  myKeys: () => get<{ keys: Array<{ key_id: string; name: string; created_at: number; last_used_at: number | null; requests_made: number }> }>('/v1/auth/keys'),
}
