"""Tests for the append-only hash-chained audit log."""

import json
import tempfile
from pathlib import Path

import pytest

from inference_exchange.coordinator.audit_log import AuditLog


@pytest.fixture
def audit_log():
    tmp = tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False)
    tmp.close()
    log = AuditLog(Path(tmp.name))
    yield log
    log.close()
    Path(tmp.name).unlink()


class TestAuditLogBasics:
    def test_log_creates_entry(self, audit_log):
        audit_log.log("test", {"key": "value"})
        assert audit_log.entry_count == 1

    def test_entries_are_sequential(self, audit_log):
        audit_log.log("a", {})
        audit_log.log("b", {})
        audit_log.log("c", {})
        assert audit_log.entry_count == 3

    def test_entries_are_json_lines(self, audit_log):
        audit_log.log("test", {"data": 42})
        audit_log.close()

        lines = audit_log.path.read_text().strip().split("\n")
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["type"] == "test"
        assert entry["data"] == 42
        assert entry["seq"] == 1
        assert "ts" in entry

    def test_multiple_entries(self, audit_log):
        for i in range(5):
            audit_log.log("event", {"i": i})
        audit_log.close()

        lines = audit_log.path.read_text().strip().split("\n")
        assert len(lines) == 5
        for i, line in enumerate(lines):
            entry = json.loads(line)
            assert entry["seq"] == i + 1
            assert entry["i"] == i


class TestHashChaining:
    def test_prev_hash_chains(self, audit_log):
        audit_log.log("first", {})
        audit_log.log("second", {})
        audit_log.close()

        lines = audit_log.path.read_text().strip().split("\n")
        e1 = json.loads(lines[0])
        e2 = json.loads(lines[1])

        # First entry has genesis hash
        assert e1["prev_hash"] == "0" * 64

        # Second entry's prev_hash should be the SHA-256 of the first entry
        import hashlib
        expected_hash = hashlib.sha256(lines[0].encode()).hexdigest()
        assert e2["prev_hash"] == expected_hash

    def test_tamper_detection(self, audit_log):
        """If we modify a line, the chain breaks."""
        audit_log.log("original", {"data": "real"})
        audit_log.log("second", {})
        audit_log.close()

        lines = audit_log.path.read_text().strip().split("\n")
        e2 = json.loads(lines[1])

        # Verify chain is valid
        import hashlib
        expected = hashlib.sha256(lines[0].encode()).hexdigest()
        assert e2["prev_hash"] == expected

        # Now tamper with the first line
        tampered = lines[0].replace('"real"', '"fake"')
        tampered_hash = hashlib.sha256(tampered.encode()).hexdigest()

        # The second entry's prev_hash no longer matches
        assert e2["prev_hash"] != tampered_hash


class TestConvenienceMethods:
    def test_log_billing(self, audit_log):
        audit_log.log_billing(
            request_id="req-1",
            consumer_id="consumer-1",
            provider_id="provider-1",
            model="llama-8b",
            input_tokens=100,
            output_tokens=50,
            cost_micro=150,
            provider_earning_micro=135,
            platform_fee_micro=15,
        )
        audit_log.close()
        entry = json.loads(audit_log.path.read_text().strip())
        assert entry["type"] == "billing"
        assert entry["request_id"] == "req-1"
        assert entry["cost_micro"] == 150

    def test_log_attestation(self, audit_log):
        audit_log.log_attestation(
            provider_id="p1",
            provider_name="test-node",
            status="passed",
            sip_enabled=True,
            hardened_runtime=True,
        )
        audit_log.close()
        entry = json.loads(audit_log.path.read_text().strip())
        assert entry["type"] == "attestation"
        assert entry["status"] == "passed"
        assert entry["sip_enabled"] is True

    def test_log_provider_connect(self, audit_log):
        audit_log.log_provider_connect("p1", "my-node", "hardened")
        audit_log.close()
        entry = json.loads(audit_log.path.read_text().strip())
        assert entry["type"] == "provider_connect"
        assert entry["name"] == "my-node"
        assert entry["trust_level"] == "hardened"
