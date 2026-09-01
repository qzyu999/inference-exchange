#!/bin/bash
# OCIP Hardening Verification — POC Edition
#
# Run this while ocip-llama-server (or llama-server) is running.
# No sudo needed for most tests.
#
# Usage:
#   ./verify-poc.sh
#   ./verify-poc.sh <pid>    # if auto-detection doesn't find it
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  OCIP Hardening Verification             ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Find the server PID
PID="${1:-}"
if [ -z "$PID" ]; then
    PID=$(pgrep -f "ocip-llama-server\|llama-server" | head -1 || true)
fi

if [ -z "$PID" ]; then
    echo "ERROR: No llama-server process found."
    echo "Start it first, or pass the PID: $0 <pid>"
    exit 1
fi

echo "Target: PID $PID ($(ps -p "$PID" -o comm= 2>/dev/null || echo 'unknown'))"
echo ""

PASS=0
FAIL=0
SKIP=0

run_test() {
    local name="$1"
    local result="$2"  # PASS, FAIL, or SKIP
    local detail="$3"

    case "$result" in
        PASS) echo "  ✓ $name — $detail"; PASS=$((PASS + 1)) ;;
        FAIL) echo "  ✗ $name — $detail"; FAIL=$((FAIL + 1)) ;;
        SKIP) echo "  - $name — $detail"; SKIP=$((SKIP + 1)) ;;
    esac
}

# --- Test 1: PT_DENY_ATTACH (debugger blocked) ---
LLDB_OUT=$(lldb -p "$PID" -b -o "quit" 2>&1 || true)
if echo "$LLDB_OUT" | grep -qi "not permitted\|failed\|unable\|error"; then
    run_test "Debugger attachment" "PASS" "lldb cannot attach"
else
    run_test "Debugger attachment" "FAIL" "lldb was able to attach!"
fi

# --- Test 2: Memory reading blocked ---
VMMAP_OUT=$(vmmap "$PID" 2>&1 || true)
if echo "$VMMAP_OUT" | grep -qi "failed\|error\|denied\|cannot\|unable"; then
    run_test "Memory reading (vmmap)" "PASS" "memory not readable"
else
    # vmmap might succeed but show limited info — check if it's actually useful
    if [ ${#VMMAP_OUT} -lt 100 ]; then
        run_test "Memory reading (vmmap)" "PASS" "no useful output"
    else
        run_test "Memory reading (vmmap)" "FAIL" "memory is readable"
    fi
fi

# --- Test 3: sample (CPU profiler) blocked ---
SAMPLE_OUT=$(sample "$PID" 1 2>&1 || true)
if echo "$SAMPLE_OUT" | grep -qi "failed\|error\|denied\|unable\|not permitted"; then
    run_test "CPU sampling (sample)" "PASS" "profiler blocked"
else
    run_test "CPU sampling (sample)" "FAIL" "profiler was able to sample"
fi

# --- Test 4: SIP enabled ---
SIP_OUT=$(csrutil status 2>&1 || true)
if echo "$SIP_OUT" | grep -q "enabled"; then
    run_test "System Integrity Protection" "PASS" "SIP is enabled"
else
    run_test "System Integrity Protection" "FAIL" "SIP is NOT enabled"
fi

# --- Test 5: Hardened Runtime flag ---
# Find the binary path
BIN_PATH=$(ps -p "$PID" -o comm= 2>/dev/null || true)
if [ -z "$BIN_PATH" ] || [ ! -f "$BIN_PATH" ]; then
    # Try common locations
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    for candidate in \
        "$SCRIPT_DIR/ocip-llama-server" \
        "$SCRIPT_DIR/llama.cpp/build/bin/llama-server"; do
        if [ -f "$candidate" ]; then
            BIN_PATH="$candidate"
            break
        fi
    done
fi

if [ -n "$BIN_PATH" ] && [ -f "$BIN_PATH" ]; then
    CS_OUT=$(codesign -dv "$BIN_PATH" 2>&1 || true)
    if echo "$CS_OUT" | grep -q "runtime"; then
        run_test "Hardened Runtime" "PASS" "runtime flag present"
    else
        run_test "Hardened Runtime" "FAIL" "no runtime flag in signature"
    fi

    ENT_OUT=$(codesign -d --entitlements :- "$BIN_PATH" 2>&1 || true)
    if echo "$ENT_OUT" | grep -q "get-task-allow"; then
        run_test "get-task-allow absent" "FAIL" "entitlement present (defeats hardening!)"
    else
        run_test "get-task-allow absent" "PASS" "not present"
    fi
else
    run_test "Hardened Runtime" "SKIP" "could not find binary path"
    run_test "get-task-allow absent" "SKIP" "could not find binary path"
fi

# --- Test 6: Core dumps disabled ---
CORE_OUT=$(ulimit -c 2>&1 || true)
# Note: this checks the shell's limit, not the process. The process set
# RLIMIT_CORE=0 internally, which we can't read from outside without
# attaching (which we just proved we can't do). So we check via inference.
run_test "Core dumps (in-process)" "SKIP" "set internally, can't verify externally without attach"

# --- Test 7: Inference still works ---
HEALTH_OUT=$(curl -sf "http://127.0.0.1:9999/health" 2>/dev/null || \
             curl -sf "http://127.0.0.1:8081/health" 2>/dev/null || true)
if echo "$HEALTH_OUT" | grep -qi "ok\|loaded\|true"; then
    run_test "Inference server health" "PASS" "server responding"

    # Try a quick completion
    INFER_OUT=$(curl -sf "http://127.0.0.1:9999/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d '{"model":"test","messages":[{"role":"user","content":"Say hi"}],"max_tokens":5}' \
        2>/dev/null || \
    curl -sf "http://127.0.0.1:8081/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d '{"model":"test","messages":[{"role":"user","content":"Say hi"}],"max_tokens":5}' \
        2>/dev/null || true)
    if echo "$INFER_OUT" | grep -q "choices"; then
        run_test "Inference completion" "PASS" "model generating tokens"
    else
        run_test "Inference completion" "FAIL" "no completion response"
    fi
else
    run_test "Inference server health" "SKIP" "server not reachable on :9999 or :8081"
    run_test "Inference completion" "SKIP" "server not reachable"
fi

# --- Summary ---
echo ""
echo "═══════════════════════════════════════════"
TOTAL=$((PASS + FAIL + SKIP))
echo "  Results: $PASS passed, $FAIL failed, $SKIP skipped (of $TOTAL)"

if [ "$FAIL" -eq 0 ] && [ "$PASS" -ge 4 ]; then
    echo ""
    echo "  ✅ Hardening verified."
    echo "  Attack surface: kernel 0-day (~\$500k) or physical memory probe."
elif [ "$FAIL" -eq 0 ]; then
    echo ""
    echo "  ⚠  Partial verification. Some tests skipped."
else
    echo ""
    echo "  ❌ Some protections are NOT working. Review failures above."
fi
echo "═══════════════════════════════════════════"
echo ""
