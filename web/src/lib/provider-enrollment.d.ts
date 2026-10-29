/** PROV-018: only the issuance response ever carries a new raw credential. */
export const SELF_SERVICE_PROFILE: string

export interface ProviderCredentialMetadata {
  token_id: string
  node_id: string
  name: string
  created_at: number
  last_used_at: number | null
  connections: number
  revoked_at: number | null
}

export interface ProviderEnrollmentReceipt {
  node: {
    node_id: string
    name: string
    status: 'offline'
    profile: string
  }
  credential: {
    token_id: string
    token: string
  }
  simulated_credits: true
}

export function listSelfServiceCredentials(): Promise<{ credentials: ProviderCredentialMetadata[] }>
export function enrollSelfServiceProvider(name: string): Promise<ProviderEnrollmentReceipt>
export function revokeSelfServiceCredential(tokenId: string): Promise<{
  ok: boolean
  token_id: string
  disconnected: string[]
}>
