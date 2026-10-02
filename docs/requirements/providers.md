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
