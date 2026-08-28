#!/bin/bash
# Build hardened llama-server for OCIP
# Run on macOS with Apple Silicon + Xcode Command Line Tools + CMake
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LLAMA_DIR="$SCRIPT_DIR/llama.cpp"
BUILD_DIR="$LLAMA_DIR/build"
OUTPUT="$SCRIPT_DIR/ocip-llama-server"

# --- Config ---
# Set your Apple Developer ID here (or pass as env var)
SIGN_IDENTITY="${SIGN_IDENTITY:-Developer ID Application: UNSIGNED}"

echo "=== OCIP Hardened Inference Server Build ==="
echo ""

# 1. Clone llama.cpp if not present
if [ ! -d "$LLAMA_DIR" ]; then
    echo "[1/5] Cloning llama.cpp..."
    git clone --depth 1 https://github.com/ggerganov/llama.cpp "$LLAMA_DIR"
else
    echo "[1/5] llama.cpp already present, updating..."
    cd "$LLAMA_DIR" && git pull && cd "$SCRIPT_DIR"
fi

# 2. Apply hardening (inject ocip_harden() call into server main)
echo "[2/5] Applying hardening..."

# Copy hardening source into the llama.cpp tree
cp "$SCRIPT_DIR/hardening.c" "$LLAMA_DIR/examples/server/ocip_hardening.c"
cp "$SCRIPT_DIR/hardening.h" "$LLAMA_DIR/examples/server/ocip_hardening.h"

# Patch the server's main.cpp to call ocip_harden() at startup
# (Idempotent — only patches if not already patched)
SERVER_MAIN="$LLAMA_DIR/examples/server/server.cpp"
if ! grep -q "ocip_harden" "$SERVER_MAIN"; then
    # Add include at top
    sed -i '' '1i\
#include "ocip_hardening.h"\
' "$SERVER_MAIN"

    # Add ocip_harden() call as first line of main()
    sed -i '' 's/int main(int argc, char \*\* argv) {/int main(int argc, char ** argv) {\n    if (ocip_harden() != 0) { return 1; }/' "$SERVER_MAIN"

    echo "  Patched server.cpp with OCIP hardening"
else
    echo "  Already patched"
fi

# Add hardening.c to the CMakeLists for the server target
SERVER_CMAKE="$LLAMA_DIR/examples/server/CMakeLists.txt"
if ! grep -q "ocip_hardening" "$SERVER_CMAKE"; then
    sed -i '' 's/server.cpp/server.cpp ocip_hardening.c/' "$SERVER_CMAKE"
    echo "  Added hardening.c to CMakeLists"
fi

# 3. Build with Metal
echo "[3/5] Building with Metal GPU support..."
cmake -B "$BUILD_DIR" -S "$LLAMA_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_METAL=ON \
    -DLLAMA_CURL=OFF \
    -DCMAKE_OSX_ARCHITECTURES="arm64"

cmake --build "$BUILD_DIR" --target llama-server -j$(sysctl -n hw.ncpu)

cp "$BUILD_DIR/bin/llama-server" "$OUTPUT"
echo "  Built: $OUTPUT"

# 4. Code sign with Hardened Runtime
echo "[4/5] Code signing with Hardened Runtime..."
if [ "$SIGN_IDENTITY" = "Developer ID Application: UNSIGNED" ]; then
    echo "  WARNING: No SIGN_IDENTITY set. Signing ad-hoc (won't work on other machines)."
    echo "  Set SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' for distribution."
    codesign --sign - \
             --options runtime \
             --entitlements "$SCRIPT_DIR/entitlements.plist" \
             --force \
             "$OUTPUT"
else
    codesign --sign "$SIGN_IDENTITY" \
             --options runtime \
             --entitlements "$SCRIPT_DIR/entitlements.plist" \
             --force \
             "$OUTPUT"
fi
echo "  Signed: $OUTPUT"

# 5. Verify
echo "[5/5] Verifying..."
codesign -dv "$OUTPUT" 2>&1 | grep -E "(Runtime|Authority|TeamIdentifier)"
echo ""
echo "=== Build complete ==="
echo "Binary: $OUTPUT"
echo ""
echo "Run with:"
echo "  $OUTPUT --model <path-to-gguf> --host unix:///tmp/ocip-inference.sock"
echo ""
echo "Or test hardening:"
echo "  $OUTPUT --model <path-to-gguf> --port 8081 &"
echo "  lldb -p \$(pgrep llama-server)   # Should fail with 'Operation not permitted'"
