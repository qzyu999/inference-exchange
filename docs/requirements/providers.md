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

### PROV-003: Only admins create provider tokens

MUST: Only an admin can create or list provider tokens.

- Principle: P6
- Status: implemented
- Verified by: tests/test_access_control.py::TestKeysAndAdmin::test_non_admin_user_gets_403, tests/test_access_control.py::TestProdMode::test_admin_endpoints_need_admin_even_with_no_users

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

Note: For migration, the coordinator also accepts `?token=` and logs a warning without the token. `IE_PROVIDER_URL_TOKEN=0` turns off this fallback. Header authentication does not verify trust levels (PROV-004).

- Principle: P6
- Status: implemented
- Verified by: tests/test_provider_auth_transport.py::TestHeaderAuth::test_bearer_header_registers, tests/test_provider_auth_transport.py::TestHeaderAuth::test_bad_header_rejected, tests/test_provider_auth_transport.py::TestHeaderAuth::test_revoked_token_in_header_rejected, tests/test_provider_auth_transport.py::TestHeaderAuth::test_self_reported_name_is_not_a_credential, tests/test_provider_auth_transport.py::TestUrlFallback::test_legacy_url_token_still_works_and_warns_without_secret, tests/test_provider_auth_transport.py::TestUrlFallback::test_url_token_can_be_disabled, tests/test_provider_auth_transport.py::TestRedaction::test_filter_rewrites_formatted_record, tests/test_provider_auth_transport.py::TestAgentSendsHeader::test_agent_connects_with_header_and_url_has_no_token
