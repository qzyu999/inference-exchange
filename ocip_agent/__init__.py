"""OCIP Agent — the network-facing process.

Handles:
- WebSocket connection to coordinator
- E2E encryption (X25519 decrypt inbound, encrypt outbound)
- Attestation and identity reporting
- Forwards decrypted prompts to the OCIP Inference Server (local socket)
- Streams tokens back encrypted

This process does NOT run inference. It's a thin relay between
the encrypted network and the isolated inference server.
"""
