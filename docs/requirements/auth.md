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
