export interface LandingLink { to: string; label: string; dividerBefore?: boolean }
export interface LandingGroup { id: string; label: string; side: 'left' | 'right'; items: LandingLink[] }
export const LANDING_LINKS: ReadonlyArray<LandingLink>
export function getLandingGroups(user: unknown): LandingGroup[]
export function getLandingAccountLinks(user: unknown): LandingLink[]
export function safeNextPath(value: unknown, fallback?: string): string
export function loginHref(from: string): string
export function githubLoginHref(next: string | null | undefined): string
export function authState(loading: boolean, user: unknown): 'loading' | 'signed-in' | 'signed-out'
