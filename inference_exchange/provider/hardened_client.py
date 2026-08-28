"""Client for the hardened inference server (Unix socket communication).

Connects to ocip-llama-server over a Unix domain socket, which is not
observable via network capture tools. The hardened server runs with
PT_DENY_ATTACH + Hardened Runtime, so its memory cannot be read externally.

This replaces the in-process llama-cpp-python approach when running in
hardened mode (OCIP Level 2).
"""

import json
import logging
import socket
from collections.abc import Generator

logger = logging.getLogger(__name__)


class HardenedInferenceClient:
    """Connects to ocip-llama-server over Unix socket.

    The server speaks the OpenAI-compatible HTTP API over a Unix socket
    (llama.cpp's built-in server supports this). We make raw HTTP requests
    over the socket connection.
    """

    def __init__(self, socket_path: str):
        self.socket_path = socket_path
        logger.info(f"Hardened inference client: socket={socket_path}")

    def _make_request(self, body: dict, stream: bool = False) -> socket.socket:
        """Send an HTTP request over Unix socket, return the socket for reading."""
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(self.socket_path)

        payload = json.dumps(body).encode()
        request = (
            f"POST /v1/chat/completions HTTP/1.1\r\n"
            f"Host: localhost\r\n"
            f"Content-Type: application/json\r\n"
            f"Content-Length: {len(payload)}\r\n"
            f"\r\n"
        ).encode() + payload

        sock.sendall(request)
        return sock

    def generate_stream(
        self,
        messages: list[dict],
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> Generator[str, None, None]:
        """Stream tokens from the hardened inference server."""
        body = {
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }

        sock = self._make_request(body, stream=True)

        try:
            # Read HTTP response headers
            buffer = b""
            while b"\r\n\r\n" not in buffer:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                buffer += chunk

            # Split headers from body
            header_end = buffer.index(b"\r\n\r\n") + 4
            body_start = buffer[header_end:]

            # Parse SSE stream
            remainder = body_start.decode("utf-8", errors="replace")

            while True:
                # Read more data
                try:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    remainder += chunk.decode("utf-8", errors="replace")
                except (ConnectionResetError, BrokenPipeError):
                    break

                # Process complete lines
                while "\n" in remainder:
                    line, remainder = remainder.split("\n", 1)
                    line = line.strip()

                    if not line.startswith("data: "):
                        continue

                    data = line[6:]
                    if data == "[DONE]":
                        return

                    try:
                        parsed = json.loads(data)
                        content = parsed.get("choices", [{}])[0].get("delta", {}).get("content")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue
        finally:
            sock.close()

    def generate(
        self,
        messages: list[dict],
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> str:
        """Generate complete response (non-streaming)."""
        return "".join(self.generate_stream(messages, max_tokens, temperature))

    def health_check(self) -> bool:
        """Check if the hardened server is running and reachable."""
        try:
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.settimeout(2)
            sock.connect(self.socket_path)

            request = (
                "GET /health HTTP/1.1\r\n"
                "Host: localhost\r\n"
                "\r\n"
            ).encode()
            sock.sendall(request)

            response = sock.recv(1024)
            sock.close()
            return b"200" in response
        except (ConnectionRefusedError, FileNotFoundError, socket.timeout):
            return False
