// User-facing navigation and operator visibility need an explicit server-issued flag.
// Do not infer admin access from email address, GitHub login, or provider ownership.
export function canShowAdminConsole(user) {
  return user?.is_admin === true
}
