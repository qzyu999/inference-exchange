export function canShowAdminConsole(user: { is_admin?: boolean } | null | undefined): boolean

export function canShowProviderDashboard(user: { user_id?: string } | null | undefined): boolean
