// User-facing navigation and operator visibility need an explicit server-issued flag.
// Do not infer admin access from email address, GitHub login, or provider ownership.
export function canShowAdminConsole(user) {
  return user?.is_admin === true
}

// Navigation hint only. The /dashboard API always checks server-side ownership.
// Any IE account may consume and provide; no separate provider role is required.
export function canShowProviderDashboard(user) {
  return typeof user?.user_id === 'string' && user.user_id.length > 0
}
