export const LANDING_LINKS: ReadonlyArray<{ to: string; label: string }>
export function safeNextPath(value: unknown, fallback?: string): string
export function loginHref(from: string): string
export function githubLoginHref(next: string | null | undefined): string
export function authState(loading: boolean, user: unknown): 'loading' | 'signed-in' | 'signed-out'
