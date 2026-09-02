#!/bin/bash
# Build the hardened OCIP Agent binary (PyInstaller + codesign)
#
# This freezes the Python agent into a standalone binary, then codesigns it
# with Hardened Runtime so the provider operator can't debug or memory-read it.
#
# Prerequisites:
#   - macOS with Apple Silicon
#   - Python 3.12+ with venv
#   - pip install pyinstaller
#
# Usage:
#   ./build-agent.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT="$SCRIPT_DIR/ie-agent"

echo ""
echo "=== Building Hardened OCIP Agent ==="
echo ""

# Check prerequisites
if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 not found"
    exit 1
fi

# Ensure we're in a venv with dependencies
if [ ! -f "$REPO_DIR/.venv/bin/activate" ]; then
    echo "[1/4] Creating venv..."
    python3 -m venv "$REPO_DIR/.venv"
    source "$REPO_DIR/.venv/bin/activate"
    pip install -e "$REPO_DIR"
    pip install pyinstaller
else
    source "$REPO_DIR/.venv/bin/activate"
    # Ensure pyinstaller is installed
    pip install pyinstaller -q
fi

echo "[1/4] Dependencies ready"

# Build with PyInstaller
echo "[2/4] Freezing agent with PyInstaller..."
cd "$REPO_DIR"
pyinstaller \
    --onefile \
    --name ie-agent \
    --hidden-import inference_exchange.shared.crypto \
    --hidden-import inference_exchange.shared.protocol \
    --hidden-import inference_exchange.shared.errors \
    --distpath "$SCRIPT_DIR" \
    --workpath "$SCRIPT_DIR/build-agent" \
    --specpath "$SCRIPT_DIR" \
    --clean \
    --codesign-identity - \
    ocip_agent/agent.py

echo "  Built: $OUTPUT"

# Codesign with Hardened Runtime
echo "[3/4] Codesigning with Hardened Runtime..."
codesign --sign - \
    --options runtime \
    --entitlements "$SCRIPT_DIR/entitlements.plist" \
    --force \
    "$OUTPUT"

echo "  Signed"

# Verify
echo "[4/4] Verifying..."
CS_OUT=$(codesign -dv "$OUTPUT" 2>&1)
if echo "$CS_OUT" | grep -q "runtime"; then
    echo "  Hardened Runtime: YES"
else
    echo "  WARNING: Hardened Runtime flag not detected"
fi

echo ""
echo "=== Agent build complete ==="
echo "  Binary: $OUTPUT ($(du -h "$OUTPUT" | awk '{print $1}'))"
echo ""
echo "  Test:"
echo "    $OUTPUT --name test --coordinator ws://localhost:8000/ws/provider --model /path/to/model.gguf"
echo ""
echo "  Verify hardening:"
echo "    $OUTPUT --name test &"
echo "    lldb -p \$(pgrep ie-agent) -o quit"
echo "    # Should fail with 'Operation not permitted'"
echo ""

# Cleanup build artifacts
rm -rf "$SCRIPT_DIR/build-agent" "$SCRIPT_DIR/ie-agent.spec"
