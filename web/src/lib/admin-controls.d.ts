export interface OperatorControls {
  inference_paused: boolean
  signup_disabled: boolean
  max_concurrent_per_account: number
  active_requests_total: number
  active_requests_by_account: Record<string, number>
  queue_length: number
  queue_max_depth: number
  queue_timeout_seconds: number
  providers_connected: number
  runtime_changes_persist: boolean
}

export type OperatorChanges = Partial<Pick<OperatorControls, 'inference_paused' | 'signup_disabled' | 'max_concurrent_per_account'>>

export function loadOperatorControls(): Promise<OperatorControls>
export function updateOperatorControls(changes: OperatorChanges): Promise<OperatorControls>
export function clearOperatorQueue(): Promise<{ok: boolean; cleared: number}>
export function quarantineProvider(providerId: string, reason: string): Promise<{ok: boolean; provider_id: string; quarantined: boolean}>
export function releaseProvider(providerId: string): Promise<{ok: boolean; provider_id: string; quarantined: boolean}>

export function loadAdminState(): Promise<any>

export interface AdminAccount {
  user_id: string
  email: string
  name: string
  role: string
  active_keys: number
  suspended: boolean
  suspension_permanent: boolean
  suspended_until: number | null
  suspension_reason: string
}

export function listAdminAccounts(): Promise<{accounts: AdminAccount[]}>
export function suspendAdminAccount(userId: string, reason: string, durationSeconds: number): Promise<{ok: boolean; suspension: unknown}>
export function restoreAdminAccount(userId: string, reason: string): Promise<{ok: boolean}>
