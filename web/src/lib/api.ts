/**
 * API client for the Inference Exchange coordinator.
 * All requests include credentials (JWT cookie) for authenticated endpoints.
 */

const BASE = import.meta.env.VITE_API_BASE || ''

export async function get<T>(path: string): Promise<T> {
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

export interface CountryRoute { provider_country: string; caller_country: string; count_band: string }
export interface CountryActivity { enabled: boolean; period: string | null; routes: CountryRoute[] }

export interface NetworkRequest { timestamp_minute: number; status: string; model: string | null; provider_country: string | null; caller_country: string | null; input_tokens: number | null; output_tokens: number | null; cost_micro: number | null; latency_ms: number | null }
export interface NetworkCountryRoute { provider_country: string; caller_country: string; timestamp_minute: number }
export interface NetworkActivity { scope: 'exchange'; retention_days: number; limit: number; geography_enabled: boolean; time_precision: 'minute'; requests: NetworkRequest[]; completions: NetworkRequest[]; routes: NetworkCountryRoute[] }
export interface RecentActivity { scope: string; enabled: boolean; retention_days: number; limit: number; requests: { request_id: string; timestamp: number; provider_country: string | null; caller_country: string | null }[] }
export interface Usage { scope: string; period: string; cost_micro: number; requests: number; tokens: number; models: { served_model: string | null; requests: number; cost_micro: number; tokens: number }[] }
export interface Signups { total_accounts: number; created_today: number; created_last_30_days: number; since: string; through: string; countries: { country: string; accounts: number }[]; daily: { date: string; accounts: number }[] }

export interface CatalogOffer { id: string; provider: string; route: string; ie?: boolean; stale?: boolean; input: string | null; cache_read: string | null; output: string | null; observed_at: number; quantization?: string | null; context_length?: number | null; source_url: string; identity_source?: string; identity_trust?: string; artifact_verification?: string; original_model?: string; provider_id?: string }
export interface CatalogModel { id: string; name: string; ie_count: number; offers: CatalogOffer[]; family?: string | null; total_parameters?: number | null; active_parameters?: number | null; variant_tags?: string[] | null; release?: string | null }
export interface CatalogPage { models: CatalogModel[]; total: number; generation: number; generated_at: number; sync_error: string | null }

export interface HealthResponse {
  status: string
  providers: number
  models: string[]
  default_api_key?: string
}

export interface OwnedProviderNode {
  node_id: string
  name: string
  status: 'online' | 'offline' | 'busy'
  active_connections: number
  models: string[]
  hardware_claim: string | null
  claimed_trust_level: string | null
  verified_trust_level: string | null
  created_at: number
  price_input_per_mtok?: number | null
  price_output_per_mtok?: number | null
  max_concurrent?: number | null
  last_heartbeat?: number | null
}

export interface OwnedProviderEarningsByNode {
  node_id: string
  name: string
  earned_micro: number
  ledger_earned_micro: number
  today_earned_micro: number
  cost_micro: number
  platform_fee_micro: number
  requests_served: number
  reconciled: boolean
}

export interface ProviderEarningsSummary {
  earned_micro: number
  ledger_earned_micro: number
  today_earned_micro: number
  cost_micro: number
  platform_fee_micro: number
  requests_served: number
  reconciled: boolean
}

export interface Provider {
  id: string
  name: string
  models: string[]
  trust_level: string
  hardware: string
  price_input: number
  price_output: number
  price_cache?: number
  measured_tps: number
  load: number
  active_requests: number
  max_concurrent: number
  status: string
  encrypted: boolean
  encryption_public_key?: string | null
  uptime_seconds: number
  model_capabilities?: {
    context_length: number
    supports_tool_calling: boolean
    supports_vision: boolean
    architecture: string
    model_format: string
  }
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

export interface Transaction {
  full_request_id?: string
  request_id: string
  model: string
  tokens: number
  input_tokens?: number
  output_tokens?: number
  cached_tokens?: number
  cost_usd: number
  cost_micro?: number
  provider_earning_micro?: number
  platform_fee_micro?: number
  minimum_applied?: boolean
  timestamp: number
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
  cost_usd?: number
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
  reason?: string
  min_confidence?: string
  max_price?: number | null
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
  ownedProviderNodes: () => get<{ nodes: OwnedProviderNode[]; simulated_credits: boolean }>('/v1/provider/nodes'),
  ownedProviderEarnings: () => get<{ summary: ProviderEarningsSummary; by_node: OwnedProviderEarningsByNode[]; simulated_credits: boolean; unit: 'micro_usd' }>('/v1/provider/earnings'),
  billingConfig: () => get<{ minimum_charge_usd: number; minimum_charge_micro: number; platform_fee_percent: number; simulated_credits: boolean; allow_balance_reset: boolean }>('/v1/exchange/billing-config'),
  stats: () => get<ExchangeStats>('/v1/exchange/stats'),
  providers: () => get<{ providers: Provider[] }>('/v1/exchange/providers'),
  pricing: () => get<{ pricing: PricingEntry[] }>('/v1/exchange/pricing'),
  depth: () => get<{ asks: DepthLevel[]; total_capacity: number; available_capacity: number }>('/v1/exchange/depth'),
  balance: () => get<Balance>('/v1/exchange/balance'),
  history: () => get<{ transactions: Transaction[] }>('/v1/exchange/history'),
  usage: () => get<Usage>('/v1/exchange/usage'),
  networkActivity: () => get<NetworkActivity>('/v1/exchange/activity/network'),
  recentActivity: () => get<RecentActivity>('/v1/exchange/activity/recent'),
  signups: () => get<Signups>('/v1/admin/signups'),
  countryActivity: () => get<CountryActivity>('/v1/exchange/country-activity'),
  trace: (id: string) => get<{ trace: Trace }>(`/v1/exchange/traces/${encodeURIComponent(id)}`),
  traces: () => get<{ traces: Trace[] }>('/v1/exchange/traces'),
  reputation: () => get<{ reputation: ReputationEntry[] }>('/v1/exchange/reputation'),
  tps: () => get<{ tps_stats: TPSEntry[] }>('/v1/exchange/tps'),
  telemetry: () => get<any>('/v1/exchange/telemetry'),
  models: () => get<{ object: string; data: Array<{ id: string }> }>('/v1/models'),
  searchModels: (q: string) => get<{ models: Array<{ repo_id: string; downloads: number; available_on_exchange: boolean; provider_count: number }> }>(`/v1/exchange/models/search?q=${encodeURIComponent(q)}`),
  adminState: () => get<any>('/v1/admin/state'),
  recentEvents: () => get<{ events: Array<{ type: string; timestamp: number; [key: string]: any }> }>('/v1/exchange/events/recent'),
  market: () => get<{ models: any[]; total_providers: number; total_models: number }>('/v1/exchange/market'),
  catalogPage: (offset: number) => get<CatalogPage>(`/v1/exchange/catalog?offset=${offset}&limit=100`),
  referencePrices: (model?: string) => get<{ models: any[]; sources: string[]; last_updated: Record<string, string> }>(`/v1/exchange/reference-prices${model ? `?model=${encodeURIComponent(model)}` : ''}`),
  authConfig: () => get<{ github: boolean; password: boolean }>('/v1/auth/config'),
  revokeKey: async (keyId: string) => {
    const r = await fetch(`${BASE}/v1/auth/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE', credentials: 'include' })
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`)
  },
  myKeys: () => get<{ keys: Array<{ key_id: string; name: string; created_at: number; last_used_at: number | null; requests_made: number }> }>('/v1/auth/keys'),
}
