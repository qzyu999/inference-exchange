"""OCIP Inference Server — the hardened inference process.

This is the process that actually runs inference. In production on macOS,
it would have PT_DENY_ATTACH + Hardened Runtime. On Windows, it uses
SetProcessMitigationPolicy.

It listens on a local socket (Unix socket on macOS/Linux, named pipe on Windows)
and serves an OpenAI-compatible HTTP API over that socket. It has NO internet
access — it only talks to the OCIP agent via the local socket.

Architecture:
  Network ←→ [OCIP Agent] ←→ local socket ←→ [THIS: OCIP Inference Server]
"""
