# PROV: Providers

### PROV-001: Reconnect after a coordinator restart

MUST: After the coordinator restarts, a provider connects again and registers without manual action.

- Principle: P8
- Status: implemented
- Verified by: tests/test_mock_provider_e2e.py::test_provider_reregisters_after_coordinator_restart

### PROV-002: Provider tokens

MUST: If one or more provider tokens exist, the coordinator rejects a provider connection without a valid token.

- Principle: P6
- Status: implemented
- Verified by: tests/test_access_control.py::TestProviderTokens::test_provider_without_token_rejected_once_tokens_exist

### PROV-003: Administrative provider credential control

MUST: Only an authenticated IE administrator can create, list, or revoke provider credentials through the global `/v1/admin/provider-tokens` endpoints.

MUST: A non-admin IE user can manage only the user's own self-service provider credentials through the endpoints defined in PROV-018.

MUST NOT: An owner-scoped endpoint give a user access to another owner's credentials or to global administrative token management.

- Principle: P6
- Status: implemented
- Verified by: tests/test_access_control.py::TestKeysAndAdmin::test_non_admin_user_gets_403, tests/test_access_control.py::TestProdMode::test_admin_endpoints_need_admin_even_with_no_users, tests/test_provider_self_enrollment.py::test_owner_scoped_credential_revocation_and_disconnect

### PROV-004: Trust levels come from evidence

MUST: The coordinator assigns the trust level from evidence. It does not accept the level that the provider claims.

- Principle: P3
- Status: not-implemented
- Issue: #1

### PROV-005: Minimum trust level for admission

MUST: The exchange admits only providers with verified L2 or higher.

- Principle: P1, P3
- Status: not-implemented
- Issue: #1

Note: The experimental private alpha admits L0/Open providers only for requests
that allow L0/Open. This is an explicit exception to the L2 target.
An L0 provider is not verified L2 or L3. This exception does not change the
future higher-trust admission requirement.

### PROV-006: L3 needs App Attest

MUST: A provider can serve confidential (L3) requests only after the coordinator verifies its App Attest admission.

- Principle: P3
- Status: partial
- Verified by: tests/test_app_attest.py::test_admission_requires_strong_challenge, tests/test_app_attest.py::test_admission_rejects_identity_mismatch
- Issue: #22

### PROV-007: Encrypted traffic is authenticated

MUST: The system rejects a tampered, replayed, or wrong-direction encrypted message.

- Principle: P4
- Status: implemented
- Verified by: tests/test_e2e.py::test_tampered_ciphertext_is_rejected, tests/test_e2e.py::test_replay_is_rejected, tests/test_e2e.py::test_wrong_direction_is_rejected

### PROV-008: The confidential relay accepts no plaintext

MUST: The confidential endpoint rejects a request that contains plaintext messages.

- Principle: P4
- Status: implemented
- Verified by: tests/test_confidential_relay.py::TestPlaintextRejection::test_rejects_messages_field

### PROV-009: Disconnects lower reputation

MUST: When a provider disconnects during a request, its reputation decreases.

- Principle: P3
- Status: implemented
- Verified by: tests/test_disconnect_handling.py::TestReputationDisconnect::test_record_disconnect_decreases_score

### PROV-010: Operators can remove a provider

MUST: An admin can revoke a provider token. After revocation, the coordinator rejects a connection with that token. The coordinator also disconnects each connected provider that used the token.

MUST: An admin can quarantine a connected provider without a restart. The system does not send new requests to a quarantined provider. An admin can release the provider.

Note: A request that is in progress on a disconnected provider gets the error `provider_disconnected`.

- Principle: P6
- Status: implemented
- Verified by: tests/test_provider_revocation.py::TestTokenRevocation::test_revoked_token_refused_at_handshake, tests/test_provider_revocation.py::TestTokenRevocation::test_revoke_disconnects_live_provider, tests/test_provider_revocation.py::TestTokenRevocation::test_revoking_only_token_does_not_reopen_access, tests/test_provider_revocation.py::TestQuarantine::test_quarantined_provider_not_selected, tests/test_provider_revocation.py::TestQuarantine::test_admin_quarantine_endpoint, tests/test_provider_revocation.py::TestProviderControlsNeedAdmin::test_non_admin_denied

### PROV-011: Provider tokens are not in URLs or logs

MUST: A provider agent sends its provider token in the `Authorization: Bearer` header of the WebSocket upgrade request. The agent does not put the token in the URL.

MUST: The coordinator validates the token before it reads the registration message. It rejects a missing, unknown, or revoked token. It does not use the provider name or the claimed trust level as a credential.

MUST NOT: The coordinator or the agents write a raw provider token to a log.

Note: For migration, the coordinator also accepts `?token=` for legacy administrator-issued credentials and logs a warning without the token. New PROV-018 self-service credentials require the Authorization header. `IE_PROVIDER_URL_TOKEN=0` turns off the fallback. Header authentication does not verify trust levels (PROV-004).

- Principle: P6
- Status: implemented
- Verified by: tests/test_provider_auth_transport.py::TestHeaderAuth::test_bearer_header_registers, tests/test_provider_auth_transport.py::TestHeaderAuth::test_bad_header_rejected, tests/test_provider_auth_transport.py::TestHeaderAuth::test_revoked_token_in_header_rejected, tests/test_provider_auth_transport.py::TestHeaderAuth::test_self_reported_name_is_not_a_credential, tests/test_provider_auth_transport.py::TestUrlFallback::test_legacy_url_token_still_works_and_warns_without_secret, tests/test_provider_auth_transport.py::TestUrlFallback::test_url_token_can_be_disabled, tests/test_provider_auth_transport.py::TestRedaction::test_filter_rewrites_formatted_record, tests/test_provider_auth_transport.py::TestAgentSendsHeader::test_agent_connects_with_header_and_url_has_no_token

### PROV-012: A provider billing identity is not its connection ID

MUST: A provider token authenticates one stable billing principal across reconnects and coordinator restarts. The coordinator does not use a provider-supplied name or a WebSocket routing ID as the billing principal.

MUST: Two different provider tokens have separate billing principals, even if their provider names match. A revoked token cannot connect. Creating a replacement token does not transfer ownership or earnings automatically.

MUST: Each WebSocket connection has a unique audit session ID. Historical connection-based balances and transactions remain unchanged until a separately reviewed manual attribution procedure exists.

Note: The current principal belongs to one provider credential, not yet to a GitHub user's provider account. Explicit owner/node mapping and safe token rotation are follow-up work in #9. Alpha credits are simulated.

- Principle: P6, P7
- Status: implemented
- Verified by: tests/test_provider_billing_identity.py::test_credential_principal_survives_reconnect_and_restart, tests/test_provider_billing_identity.py::test_two_credentials_same_display_name_never_cross_credit, tests/test_provider_billing_identity.py::test_legacy_migration_is_idempotent_and_preserves_balances, tests/test_provider_billing_identity.py::test_revoked_credential_cannot_rebind_or_connect
- Issue: #136

### PROV-013: Validate bounded provider registration

MUST: Before the coordinator adds a provider to the hub, it rejects invalid registration JSON, malformed fields, oversized registrations, empty or duplicate model names, invalid metadata, nonfinite or negative prices, unreasonable prices, invalid capacity, and unsupported price units.

MUST: A rejected registration does not change the provider hub, matching, request queue, or billing ledger. The coordinator closes the invalid connection with a fixed error. It does not log the registration payload.

- Principle: P6, P7, P9
- Status: implemented
- Verified by: tests/test_provider_registration_validation.py::test_invalid_prices_rejected, tests/test_provider_registration_validation.py::test_invalid_slots_rejected, tests/test_provider_registration_validation.py::test_invalid_model_lists_rejected, tests/test_provider_registration_validation.py::test_malformed_json_rejected, tests/test_provider_registration_validation.py::test_rejected_registration_cannot_affect_other_provider_or_billing
- Issue: #147

### PROV-014: Admit only L0 in the initial production alpha

MUST: The coordinator accepts an initial production-alpha registration only when the provider claims L0/Open and declares an Apple Silicon/macOS GGUF profile. The coordinator rejects a self-declared higher level.

MUST NOT: The coordinator treats a provider hardware string, GGUF metadata, or encryption key as verified hardware or evidence of higher trust. Other platforms and higher-trust admission need separate verification.

Note: Development mock-provider registrations remain available outside production. The initial alpha uses declared hardware labels as a scope filter, not remote attestation. The L2 admission target remains in PROV-005.

- Principle: P1, P3, P6
- Status: implemented
- Verified by: tests/test_provider_registration_validation.py::test_valid_m6_l0_registration_and_matching, tests/test_provider_registration_validation.py::test_unverified_trust_rejected, tests/test_provider_registration_validation.py::test_unsupported_alpha_profile_rejected
- Issue: #147

### PROV-015: Bound WebSocket registration resources

MUST: The coordinator configures an inbound WebSocket frame size limit at the transport boundary. It limits registration message bytes, incomplete concurrent registrations, registration wait time, and registration attempts per authenticated credential.

MUST: The coordinator rejects invalid or revoked provider credentials before it reads a registration message.

- Principle: P6, P8, P9
- Status: implemented
- Verified by: tests/test_provider_registration_validation.py::test_real_uvicorn_rejects_frame_before_registration, tests/test_provider_registration_validation.py::test_main_enables_transport_ws_frame_cap, tests/test_provider_registration_validation.py::test_registration_guard_bounded_attempts_and_pending, tests/test_provider_registration_validation.py::test_missing_first_message_times_out, tests/test_provider_registration_validation.py::test_unknown_and_revoked_credentials_fail_before_read
- Issue: #147

### PROV-016: A user owns stable provider nodes

MUST: An IE user can own more than one stable provider node. A provider node has one immutable owner and one stable provider billing principal. Each WebSocket connection has a separate session ID.

MUST: A provider credential can refer to a node. Existing provider credentials remain unclaimed until an explicit binding. A schema migration does not change existing credential hashes, billing principals, balances, transactions, or provider sessions.

MUST NOT: The system infer ownership from a provider name, hardware label, IP address, or ephemeral connection ID. Future credential rotation must retain the node billing principal and must have a separately approved requirement and test.

- Principle: P2, P6, P7
- Status: implemented
- Verified by: tests/test_provider_ownership.py::test_claim_preserves_principal_and_allows_multiple_nodes, tests/test_provider_ownership.py::test_additive_migration_preserves_existing_ledger_and_unclaimed_token
- Issue: #150

### PROV-017: Legacy ownership claims are explicit and audited

MUST: Only an authenticated IE administrator can assign an existing unclaimed, active provider principal to a GitHub-linked, unsuspended IE user. The admin states a reason. The system records the node, owner, administrator, action, and time. A second or conflicting claim fails without changing financial records.

MUST: An owned provider credential is rejected when its owner is suspended or its node binding is invalid. Suspending its owner disconnects any live connections using that billing principal. Unclaimed legacy tokens retain their existing authentication behavior.

MUST NOT: A claim accept, disclose, or rotate a raw provider credential.

- Principle: P2, P6, P7, P9
- Status: implemented
- Verified by: tests/test_provider_ownership.py::test_claim_denied_for_unauthorized_or_invalid_owner, tests/test_provider_ownership.py::test_competing_claims_are_atomic, tests/test_provider_ownership.py::test_owned_token_suspension_disconnects_and_blocks_reconnect, tests/test_provider_ownership.py::test_unclaimed_legacy_token_still_connects
- Issue: #150

### PROV-018: Self-service L0 provider enrollment

MUST: When self-service enrollment is enabled, an authenticated, non-suspended IE user with a linked GitHub identity can enroll an Apple Silicon/macOS L0/Open provider without administrator approval.

MUST: The coordinator derives the owner from a valid IE browser or JWT session. It does not accept a client-supplied owner identity. A consumer API key or provider credential cannot authorize enrollment.

MUST: The coordinator creates a unique node ID, stable billing principal, provider credential hash, owner association, and audit record in one atomic database transaction. A failed transaction leaves no partial enrollment.

MUST: The coordinator returns the new raw credential only in the successful enrollment response. It never returns the credential again. Credential metadata, logs, URLs, and error responses do not contain the secret.

MUST: Initial self-service enrollment permits at most one active self-service node per account. The limit does not remove existing operator-managed nodes or change the multi-node ownership model in PROV-016. Enrollment attempts are rate-limited.

MUST: Enrollment accepts only the declared Apple Silicon/macOS GGUF/Metal L0/Open profile. Hardware declarations are not verified hardware identity or evidence of confidential execution.

MUST: A user can list metadata for their self-service credentials and revoke only their own self-service credentials. Revocation disconnects matching live provider sessions and prevents reconnection.

MUST: Unknown and foreign credential identifiers produce the same not-found response. Suspended, unlinked, invalid, or unauthorized users cannot enroll or manage credentials.

MUST: Existing administrative credentials, claimed legacy nodes, billing principals, transactions, and balances remain unchanged.

MUST: Each new self-service credential uses the WebSocket Authorization header. The existing legacy URL-token compatibility behavior does not grant URL-token authentication to new self-service credentials.

- Principle: P2, P3, P6, P7, P9
- Status: implemented
- Verified by: tests/test_provider_self_enrollment.py::test_non_admin_enrollment_and_exact_earnings, tests/test_provider_self_enrollment.py::test_enrollment_guards_and_cap, tests/test_provider_self_enrollment.py::test_competing_enrollments_are_atomic, tests/test_provider_self_enrollment.py::test_owner_scoped_credential_revocation_and_disconnect, tests/test_provider_self_enrollment.py::test_self_service_url_token_denied, tests/test_provider_self_enrollment.py::test_reissue_cap_and_rate_limit, tests/test_provider_self_enrollment.py::test_rollback_on_failed_write
