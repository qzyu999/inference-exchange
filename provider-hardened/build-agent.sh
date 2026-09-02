#!/bin/bash
# Build the hardened OCIP Agent (PyInstaller onedir + codesign)
#
# Produces: provider-hardened/ie-agent/ directory with hardened binary + libs
#
# Prerequisites:
#   - macOS with Apple Silicon
#   - Python 3.12+ with venv activated
#   - pip install pyinstaller
#
# Usage:
#   cd inference-exchange
#   source .venv/bin/activate
#   ./provider-hardened/build-agent.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$SCRIPT_DIR/ie-agent"

echo ""
echo "=== Building Hardened OCIP Agent ==="
echo ""

# Ensure pyinstaller is installed
pip install pyinstaller -q

# Pre-sign pyenv's libpython to avoid Team ID mismatch
PYLIB=$(python3 -c "import sysconfig; print(sysconfig.get_config_var('LDLIBRARY'))")
PYLIB_DIR=$(python3 -c "import sysconfig; print(sysconfig.get_config_var('LIBDIR'))")
PYLIB_PATH="$PYLIB_DIR/$PYLIB"
if [ -f "$PYLIB_PATH" ]; then
    echo "[0/4] Pre-signing Python shared library..."
    codesign --sign - --force "$PYLIB_PATH" 2>/dev/null || true
fi

# Clean previous build
rm -rf "$OUTPUT_DIR" "$SCRIPT_DIR/build-agent" ~/Library/Application\ Support/pyinstaller

echo "[1/4] Freezing agent with PyInstaller (onedir)..."
cd "$REPO_DIR"
pyinstaller \
    --onedir \
    --name ie-agent \
    --hidden-import inference_exchange.shared.crypto \
    --hidden-import inference_exchange.shared.protocol \
    --hidden-import inference_exchange.shared.errors \
    --hidden-import _cffi_backend \
    --distpath "$SCRIPT_DIR" \
    --workpath "$SCRIPT_DIR/build-agent" \
    --clean \
    ocip_agent/agent.py

echo "[2/4] Signing all binaries (ad-hoc)..."
find "$OUTPUT_DIR" -type f \( -name "*.dylib" -o -name "*.so" -o -name "ie-agent" \) \
    -exec codesign --sign - --force {} \;

echo "[3/4] Adding Hardened Runtime..."
# Sign the main binary with Hardened Runtime on top
codesign --sign - --options runtime \
    --entitlements "$SCRIPT_DIR/entitlements.plist" \
    --force "$OUTPUT_DIR/ie-agent"

echo "[4/4] Verifying..."
CS_OUT=$(codesign -dv "$OUTPUT_DIR/ie-agent" 2>&1)
if echo "$CS_OUT" | grep -q "runtime"; then
    echo "  Hardened Runtime: YES"
else
    echo "  WARNING: Hardened Runtime not detected"
fi

# Cleanup build artifacts
rm -rf "$SCRIPT_DIR/build-agent" "$REPO_DIR/ie-agent.spec"

echo ""
echo "=== Agent build complete ==="
echo "  Directory: $OUTPUT_DIR/"
echo "  Binary:    $OUTPUT_DIR/ie-agent"
echo ""
echo "  Run:"
echo "    $OUTPUT_DIR/ie-agent --name my-node --coordinator ws://COORDINATOR:8000/ws/provider --model /path/to/model.gguf"
echo ""
echo "  Verify hardening:"
echo "    lldb -p \$(pgrep ie-agent) -o quit"
echo "    # Should fail with 'Operation not permitted'"
echo ""
