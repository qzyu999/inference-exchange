"""Append-only audit log for billing events and attestation results.

Each line is a JSON object with a timestamp, event type, and payload.
The file is append-only -- the coordinator never modifies or deletes entries.

Location: ~/.inference-exchange/audit.jsonl
"""

import hashlib
import json
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

AUDIT_DIR = Path.home() / ".inference-exchange"
AUDIT_PATH = AUDIT_DIR / "audit.jsonl"


class AuditLog:
    """Append-only audit log. Each entry is a single JSON line."""

    def __init__(self, path: Path = AUDIT_PATH):
        AUDIT_DIR.mkdir(parents=True, exist_ok=True)
        self._path = path
        self._file = open(path, "a", encoding="utf-8")
        self._seq = 0
        self._last_hash = "0" * 64  # Genesis hash
        logger.info(f"Audit log: {path}")

    def log(self, event_type: str, payload: dict):
        """Append an auditable event. Each entry chains to the previous via hash."""
        self._seq += 1
        entry = {
            "seq": self._seq,
            "ts": time.time(),
            "type": event_type,
            "prev_hash": self._last_hash,
            **payload,
        }
        line = json.dumps(entry, separators=(",", ":"), sort_keys=True)

        # Chain hash: each entry includes the hash of the previous entry
        self._last_hash = hashlib.sha256(line.encode()).hexdigest()

        self._file.write(line + "\n")
        self._file.flush()

    def log_billing(
        self,
        request_id: str,
        consumer_id: str,
        provider_id: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_micro: int,
        provider_earning_micro: int,
        platform_fee_micro: int,
    ):
        self.log("billing", {
            "request_id": request_id,
            "consumer_id": consumer_id,
            "provider_id": provider_id,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_micro": cost_micro,
            "provider_earning_micro": provider_earning_micro,
            "platform_fee_micro": platform_fee_micro,
        })

    def log_attestation(
        self,
        provider_id: str,
        provider_name: str,
        status: str,
        sip_enabled: bool = False,
        hardened_runtime: bool = False,
        pt_deny_attach: bool = False,
        agent_hash: str = "",
        server_hash: str = "",
        platform: str = "",
    ):
        self.log("attestation", {
            "provider_id": provider_id,
            "provider_name": provider_name,
            "status": status,
            "sip_enabled": sip_enabled,
            "hardened_runtime": hardened_runtime,
            "pt_deny_attach": pt_deny_attach,
            "agent_hash": agent_hash[:16],
            "server_hash": server_hash[:16],
            "platform": platform,
        })

    def log_provider_connect(self, provider_id: str, name: str, trust_level: str):
        self.log("provider_connect", {
            "provider_id": provider_id,
            "name": name,
            "trust_level": trust_level,
        })

    def log_provider_disconnect(self, provider_id: str, name: str):
        self.log("provider_disconnect", {
            "provider_id": provider_id,
            "name": name,
        })

    def close(self):
        self._file.close()

    @property
    def entry_count(self) -> int:
        return self._seq

    @property
    def path(self) -> Path:
        return self._path
