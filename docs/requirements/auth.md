# AUTH: Authentication and access

### AUTH-001: GitHub sign-in

MUST: A user can sign in with GitHub. The flow uses the OAuth authorization code grant with `state` and PKCE.

- Principle: P6
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestGitHubOAuth::test_creates_user_and_session

### AUTH-002: Reject a bad OAuth state

MUST: If the `state` value does not match the cookie, the system rejects the sign-in.

- Principle: P6
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestGitHubOAuth::test_rejects_bad_state

### AUTH-003: Minimum GitHub account age

MUST: If `IE_GITHUB_MIN_AGE_DAYS` is set, the system rejects a GitHub account that is younger than that number of days.

- Principle: P6
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestGitHubOAuth::test_rejects_new_github_account

### AUTH-004: Logout revokes all sessions

MUST: After logout, the system rejects every session that it issued to that user before the logout.

- Principle: P6
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestSessions::test_logout_invalidates_old_jwt

### AUTH-005: No password sign-in in production

MUST: In production, password sign-up and sign-in are off, unless `IE_PASSWORD_AUTH=1`.

- Principle: P6
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestSessions::test_password_auth_off_in_prod_by_default

### AUTH-006: Revoke an API key

MUST: A user can revoke their own API key. After revocation, the key does not authenticate.

- Principle: P6
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestKeysAndAccount::test_revoked_key_stops_working

### AUTH-007: Users cannot revoke other keys

MUST NOT: A user can revoke an API key that belongs to a different user.

- Principle: P6
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestKeysAndAccount::test_cannot_revoke_other_users_key

### AUTH-008: Users see only their own keys

MUST: `GET /v1/auth/keys` returns only the keys of the signed-in user. For an anonymous caller, it returns an empty list.

- Principle: P6
- Status: implemented
- Verified by: tests/test_access_control.py::TestKeysAndAdmin::test_user_sees_only_own_keys, tests/test_access_control.py::TestKeysAndAdmin::test_anonymous_key_list_is_empty

### AUTH-009: Admin role from configuration

MUST: A user whose email is in `IE_ADMIN_EMAILS` gets the admin role. Other users do not.

- Principle: P6
- Status: implemented
- Verified by: tests/test_access_control.py::TestKeysAndAdmin::test_admin_email_gets_admin_role, tests/test_access_control.py::TestKeysAndAdmin::test_non_admin_user_gets_403

### AUTH-010: Admin endpoints need the admin role

MUST: In production, admin endpoints return HTTP 403 to a caller without the admin role. This includes the case where no users exist.

- Principle: P6
- Status: implemented
- Verified by: tests/test_access_control.py::TestProdMode::test_admin_endpoints_need_admin_even_with_no_users

### AUTH-011: No anonymous inference in production

MUST: In production, an inference request without a session or a valid API key gets HTTP 401.

- Principle: P6
- Status: implemented
- Verified by: tests/test_auth_sessions.py::TestSessions::test_prod_blocks_anonymous_inference

### AUTH-012: No anonymous key creation in production

MUST: In production, an anonymous caller cannot create an API key.

- Principle: P6
- Status: implemented
- Verified by: tests/test_access_control.py::TestProdMode::test_anonymous_key_creation_rejected

### AUTH-013: No shared key in production

MUST NOT: In production, `/health` returns the shared default API key.

- Principle: P6
- Status: implemented
- Verified by: tests/test_access_control.py::TestProdMode::test_health_hides_default_key

### AUTH-014: Anonymous callers cannot reset a balance in production

MUST: In production, the shared anonymous account cannot reset its balance.

- Principle: P6, P7
- Status: implemented
- Verified by: tests/test_access_control.py::TestProdMode::test_anonymous_reset_balance_rejected

### AUTH-015: Rate limits per consumer

MUST: Each consumer has a separate request rate limit.

- Principle: P6
- Status: implemented
- Verified by: tests/test_rate_limiter.py::TestConsumerIsolation::test_separate_buckets

### AUTH-016: A bad credential is rejected

MUST: If a request has an `Authorization` header that is not a valid session or a valid API key, the system returns HTTP 401. This applies to inference endpoints and to endpoints that return account data.

MUST NOT: The system uses the shared anonymous account for a request with an invalid, revoked, or expired credential.

- Principle: P6
- Status: implemented
- Verified by: tests/test_invalid_credentials.py::TestInvalidCredentials::test_unknown_key_rejected, tests/test_invalid_credentials.py::TestInvalidCredentials::test_revoked_key_rejected, tests/test_invalid_credentials.py::TestInvalidCredentials::test_expired_bearer_jwt_rejected, tests/test_auth_sessions.py::TestKeysAndAccount::test_revoked_key_stops_working

### AUTH-017: Operators can suspend an account

MUST: An admin can suspend an account for a time period, or ban it permanently. The admin must give a reason. The system records the action, the reason, the admin, and the time.

MUST: While an account is suspended, the system returns HTTP 403 for each request from that account. This applies to every session and every API key of the account, also after a coordinator restart.

MUST: A suspension ends all existing sessions of the account. A temporary suspension ends automatically. An admin can remove a suspension.

Note: A request that is in progress when the suspension starts can complete.

- Principle: P6
- Status: implemented
- Verified by: tests/test_account_suspension.py::TestSuspension::test_suspended_key_is_denied, tests/test_account_suspension.py::TestSuspension::test_suspension_ends_sessions, tests/test_account_suspension.py::TestSuspension::test_temporary_suspension_expires, tests/test_account_suspension.py::TestSuspension::test_unsuspend_restores_access, tests/test_account_suspension.py::TestSuspension::test_actions_are_audited, tests/test_account_suspension.py::TestSuspension::test_non_admin_cannot_suspend, tests/test_account_suspension.py::TestSuspension::test_suspension_survives_restart

### AUTH-018: Sign-in is visible and returns to the intended page

MUST: The landing page shows a sign-in action in its first viewport, on desktop and on mobile. The action goes to the existing `/login` flow. When the user is signed in, the landing page shows the account and a sign-out action.

MUST: After GitHub sign-in, the system sends the user to the page in the `next` parameter. The system accepts only a path on the same site. It rejects a URL with a scheme or a host, a path that starts with `//`, a backslash, a control character, and API paths. For a rejected value, the system sends the user to `/chat`.

Note: The coordinator validates `next` again when it reads the cookie, so a changed cookie cannot cause an open redirect.

- Principle: P6
- Status: implemented
- Verified by: tests/test_oauth_return_path.py::test_unsafe_next_falls_back, tests/test_oauth_return_path.py::test_safe_next_is_kept, tests/test_oauth_return_path.py::test_callback_returns_to_requested_page, tests/test_oauth_return_path.py::test_callback_never_redirects_off_site, tests/test_oauth_return_path.py::test_tampered_next_cookie_is_revalidated, web/src/lib/nav.test.mjs

### AUTH-019: Separate account and operator settings

MUST: Every signed-in IE user can open `/settings` with their IE session and no Cloudflare Access requirement. Settings shows only that user's account, API key and billing navigation, account security action, and private provider-node data. It does not request an admin API.

MUST: The common sidebar directs users to `/settings`. It shows a separate Admin Console link only when `GET /v1/auth/me` confirms current admin authorization. The server derives `is_admin` from a valid session and current admin privileges. A provider owner or an API key does not automatically grant the admin role.

MUST: The admin console does not mount admin API polling for a user without verified admin authorization. Direct admin routes remain protected by IE admin checks and Cloudflare Access at the edge. The web UI does not bypass or change these edge rules.

- Principle: P2, P6
- Status: implemented
- Verified by: tests/test_user_settings_auth.py::test_admin_flag_comes_from_verified_session_and_current_allowlist, tests/test_user_settings_auth.py::test_regular_user_and_api_key_cannot_appear_admin, tests/test_user_settings_auth.py::test_provider_token_and_revoked_session_cannot_appear_admin, tests/test_user_settings_auth.py::test_suspended_session_cannot_retain_admin_flag, web/src/lib/settings-nav.test.mjs
- Issue: #156
