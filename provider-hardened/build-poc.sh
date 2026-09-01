#!/bin/bash
# OCIP Hardened Server — POC Build Script
#
# This builds a hardened llama-server for testing on your own machine.
# No Apple Developer ID required (uses ad-hoc signing).
#
# Usage:
#   chmod +x build-poc.sh
#   ./build-poc.sh
#
# Prerequisites:
#   - macOS with Apple Silicon (M1/M2/M3/M4)
#   - Xcode Command Line Tools (xcode-select --install)
#   - cmake (brew install cmake, or download from cmake.org)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LLAMA_DIR="$SCRIPT_DIR/llama.cpp"
OUTPUT="$SCRIPT_DIR/ocip-llama-server"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  OCIP Hardened Inference Server — POC    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# --- Prerequisite checks ---
echo "[check] Verifying prerequisites..."

if ! xcode-select -p &>/dev/null; then
    echo "  ✗ Xcode Command Line Tools not found."
    echo "    Run: xcode-select --install"
    exit 1
fi
echo "  ✓ Xcode CLT found"

if ! command -v cmake &>/dev/null; then
    echo "  ✗ cmake not found."
    echo "    Install via: brew install cmake"
    echo "    Or download from: https://cmake.org/download/"
    exit 1
fi
echo "  ✓ cmake $(cmake --version | head -1 | awk '{print $3}')"

if ! command -v git &>/dev/null; then
    echo "  ✗ git not found (should come with Xcode CLT)"
    exit 1
fi
echo "  ✓ git found"

ARCH=$(uname -m)
if [ "$ARCH" != "arm64" ]; then
    echo "  ✗ Not Apple Silicon (detected: $ARCH)"
    echo "    This script requires an M1/M2/M3/M4 Mac."
    exit 1
fi
echo "  ✓ Apple Silicon ($ARCH)"

SIP_STATUS=$(csrutil status 2>&1 || true)
if echo "$SIP_STATUS" | grep -q "enabled"; then
    echo "  ✓ SIP enabled"
else
    echo "  ⚠ SIP may not be enabled. The hardened server will refuse to start."
    echo "    ($SIP_STATUS)"
fi

echo ""

# --- Step 1: Get llama.cpp ---
if [ ! -d "$LLAMA_DIR" ]; then
    echo "[1/5] Cloning llama.cpp (shallow)..."
    git clone --depth 1 https://github.com/ggerganov/llama.cpp "$LLAMA_DIR"
else
    echo "[1/5] llama.cpp already present at $LLAMA_DIR"
    echo "       Delete it and re-run to get a fresh copy."
fi

# --- Step 2: Copy hardening source ---
echo "[2/5] Copying OCIP hardening module..."
cp "$SCRIPT_DIR/hardening.c" "$LLAMA_DIR/tools/server/ocip_hardening.c"
cp "$SCRIPT_DIR/hardening.h" "$LLAMA_DIR/tools/server/ocip_hardening.h"
# Fix the include path (our repo uses hardening.h, llama tree uses ocip_hardening.h)
sed -i '' 's/#include "hardening.h"/#include "ocip_hardening.h"/' "$LLAMA_DIR/tools/server/ocip_hardening.c"
echo "  ✓ Copied hardening.c + hardening.h"

# --- Step 3: Patch server source ---
echo "[3/5] Patching server..."

# Patch main.cpp (the entry point) to call ocip_harden() before llama_server()
SERVER_MAIN="$LLAMA_DIR/tools/server/main.cpp"
if grep -q "ocip_harden" "$SERVER_MAIN"; then
    echo "  main.cpp already patched (skipping)"
else
    cat > "$SERVER_MAIN" << 'MAINEOF'
#include "ocip_hardening.h"

int llama_server(int argc, char ** argv);

int main(int argc, char ** argv) {
    if (ocip_harden() != 0) { return 1; }
    return llama_server(argc, argv);
}
MAINEOF
    echo "  ✓ Patched main.cpp with ocip_harden() call"
fi

# Patch CMakeLists.txt to compile our .c file alongside main.cpp
SERVER_CMAKE="$LLAMA_DIR/tools/server/CMakeLists.txt"
if grep -q "ocip_hardening" "$SERVER_CMAKE"; then
    echo "  CMakeLists already patched"
else
    # Add ocip_hardening.c to the llama-server executable target
    sed -i '' 's/add_executable(${TARGET} main.cpp)/add_executable(${TARGET} main.cpp ocip_hardening.c)/' "$SERVER_CMAKE"
    echo "  ✓ Added ocip_hardening.c to CMakeLists.txt"
fi

# --- Step 4: Build ---
echo "[4/5] Building with Metal GPU support..."
NCPU=$(sysctl -n hw.ncpu)

cmake -B "$LLAMA_DIR/build" -S "$LLAMA_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_METAL=ON \
    -DLLAMA_CURL=OFF \
    -DCMAKE_OSX_ARCHITECTURES="arm64" \
    2>&1 | tail -5

cmake --build "$LLAMA_DIR/build" --target llama-server -j"$NCPU" 2>&1 | tail -3

# Find the built binary (location varies by llama.cpp version)
BUILT_BIN=""
for candidate in \
    "$LLAMA_DIR/build/bin/llama-server" \
    "$LLAMA_DIR/build/examples/server/llama-server" \
    "$LLAMA_DIR/build/llama-server"; do
    if [ -f "$candidate" ]; then
        BUILT_BIN="$candidate"
        break
    fi
done

if [ -z "$BUILT_BIN" ]; then
    echo "  ✗ Could not find built llama-server binary"
    echo "    Check build output above for errors."
    echo "    Try: find $LLAMA_DIR/build -name llama-server -type f"
    exit 1
fi

cp "$BUILT_BIN" "$OUTPUT"
echo "  ✓ Built: $OUTPUT ($(du -h "$OUTPUT" | awk '{print $1}'))"

# --- Step 5: Ad-hoc codesign with Hardened Runtime ---
echo "[5/5] Codesigning (ad-hoc + Hardened Runtime)..."
codesign --sign - \
         --options runtime \
         --entitlements "$SCRIPT_DIR/entitlements.plist" \
         --force \
         "$OUTPUT"

echo "  ✓ Signed with Hardened Runtime (ad-hoc)"
echo ""

# --- Verify ---
echo "═══════════════════════════════════════════"
echo "  Verification"
echo "═══════════════════════════════════════════"

echo -n "  Code signature: "
if codesign -dv "$OUTPUT" 2>&1 | grep -q "runtime"; then
    echo "✓ Hardened Runtime active"
else
    echo "⚠ Runtime flag not detected"
fi

echo -n "  Entitlements:   "
if codesign -d --entitlements :- "$OUTPUT" 2>&1 | grep -q "get-task-allow"; then
    echo "✗ get-task-allow present (NOT secure)"
else
    echo "✓ No get-task-allow (secure)"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  Build complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "  Binary: $OUTPUT"
echo ""
echo "  Test it:"
echo "    $OUTPUT --model ~/path/to/model.gguf --port 8081 -ngl -1"
echo ""
echo "  Then in another terminal:"
echo "    lldb -p \$(pgrep llama-server)"
echo "    # Should fail with: 'Operation not permitted'"
echo ""
echo "  Full verification:"
echo "    $SCRIPT_DIR/verify-poc.sh"
echo ""
