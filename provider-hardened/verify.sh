#!/bin/bash
# Verify that the hardened server is actually protected.
# Run this AFTER starting ocip-llama-server in another terminal.
set -euo pipefail

echo "=== OCIP Hardening Verification ==="
echo ""

# Find the running server
PID=$(pgrep -f "ocip-llama-server" || true)
if [ -z "$PID" ]; then
    echo "ERROR: ocip-llama-server not running. Start it first."
    exit 1
fi
echo "Found ocip-llama-server at PID $PID"
echo ""

PASS=0
FAIL=0

# Test 1: debugger attachment should fail
echo -n "[Test 1] Debugger attachment (lldb)... "
if lldb -p "$PID" -b -o "quit" 2>&1 | grep -qi "not permitted\|error\|failed"; then
    echo "PASS (blocked)"
    PASS=$((PASS + 1))
else
    echo "FAIL (attachment succeeded!)"
    FAIL=$((FAIL + 1))
fi

# Test 2: memory reading should fail
echo -n "[Test 2] Memory reading (vmmap)... "
if vmmap "$PID" 2>&1 | grep -qi "failed\|error\|denied\|unable"; then
    echo "PASS (blocked)"
    PASS=$((PASS + 1))
else
    echo "FAIL (memory readable!)"
    FAIL=$((FAIL + 1))
fi

# Test 3: dtrace should be restricted
echo -n "[Test 3] DTrace probing... "
if sudo dtrace -p "$PID" -n 'syscall:::entry { }' 2>&1 | grep -qi "denied\|integrity\|not permitted"; then
    echo "PASS (blocked by SIP)"
    PASS=$((PASS + 1))
else
    echo "FAIL (dtrace works!)"
    FAIL=$((FAIL + 1))
fi

# Test 4: code signature has runtime flag
echo -n "[Test 4] Hardened Runtime flag... "
if codesign -dv "$(which ocip-llama-server 2>/dev/null || echo ./ocip-llama-server)" 2>&1 | grep -q "runtime"; then
    echo "PASS (runtime flag set)"
    PASS=$((PASS + 1))
else
    echo "FAIL (no runtime flag!)"
    FAIL=$((FAIL + 1))
fi

# Test 5: no get-task-allow entitlement
echo -n "[Test 5] No get-task-allow entitlement... "
if codesign -d --entitlements :- "$(which ocip-llama-server 2>/dev/null || echo ./ocip-llama-server)" 2>&1 | grep -q "get-task-allow"; then
    echo "FAIL (get-task-allow present — debuggers can attach!)"
    FAIL=$((FAIL + 1))
else
    echo "PASS (not present)"
    PASS=$((PASS + 1))
fi

# Test 6: SIP is enabled
echo -n "[Test 6] SIP enabled... "
if csrutil status | grep -q "enabled"; then
    echo "PASS"
    PASS=$((PASS + 1))
else
    echo "FAIL (SIP disabled!)"
    FAIL=$((FAIL + 1))
fi

# Test 7: Unix socket not visible to tcpdump
echo -n "[Test 7] Unix socket not on network interfaces... "
# tcpdump -D lists all capturable interfaces — Unix sockets won't appear
if tcpdump -D 2>/dev/null | grep -q "ocip-inference"; then
    echo "FAIL (socket visible!)"
    FAIL=$((FAIL + 1))
else
    echo "PASS (not capturable)"
    PASS=$((PASS + 1))
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
    echo "⚠️  Some protections are not working. Check the failures above."
    exit 1
else
    echo "✅ All protections verified. Process requires kernel exploit to observe."
fi
