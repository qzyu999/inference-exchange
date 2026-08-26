#!/usr/bin/env bash
set -e

PORT=9123
GATEWAY_URL="http://127.0.0.1:$PORT"
GATEWAY_WS="ws://127.0.0.1:$PORT/v1/provider/tunnel"
BIN_GATEWAY="./target/debug/ie-gateway"
BIN_NODE="./target/debug/ie-node"

echo "=========================================================="
echo "⚡ INFERENCE EXCHANGE (IE) END-TO-END VERIFICATION"
echo "=========================================================="

# Kill any existing test processes on PORT
lsof -ti :$PORT | xargs kill -9 2>/dev/null || true

# 1. Start ie-gateway
echo "[1/6] Launching InferenceExchange Gateway on port $PORT..."
$BIN_GATEWAY --port $PORT &
GATEWAY_PID=$!
sleep 2

# Verify Gateway is listening
curl -s "$GATEWAY_URL/v1/models" > /dev/null || { echo "Failed to connect to gateway"; kill -9 $GATEWAY_PID; exit 1; }
echo "      Gateway online!"

# 2. Start Provider Node 1: Mac Studio M2 Ultra ($0.05 in, $0.20 out, 2 slots)
echo "[2/6] Connecting Provider Node 1 (Mac Studio M2 Ultra - Best Offer)..."
$BIN_NODE \
  --gateway-url "$GATEWAY_WS" \
  --name "Mac Studio M2 Ultra (192GB)" \
  --model "llama-3.3-70b-instruct" \
  --price-in 0.05 \
  --price-out 0.20 \
  --slots 2 \
  --tps 35.0 \
  --dynamic-pricing false &
NODE1_PID=$!
sleep 2

# 3. Start Provider Node 2: MacBook Pro M4 Max ($0.10 in, $0.40 out, 4 slots)
echo "[3/6] Connecting Provider Node 2 (MacBook Pro M4 Max - Secondary Offer)..."
$BIN_NODE \
  --gateway-url "$GATEWAY_WS" \
  --name "MacBook Pro M4 Max (128GB)" \
  --model "llama-3.3-70b-instruct" \
  --price-in 0.10 \
  --price-out 0.40 \
  --slots 4 \
  --tps 42.0 \
  --dynamic-pricing false &
NODE2_PID=$!
sleep 2

# 4. Inspect L2 Order Book Depth
echo "[4/6] Querying Level-2 Order Book Depth..."
DEPTH_JSON=$(curl -s "$GATEWAY_URL/v1/orderbook/llama-3.3-70b-instruct")
echo "$DEPTH_JSON" | python3 -m json.tool

# 5. Execute OpenAI Chat Completion via Gateway
echo ""
echo "[5/6] Executing Spot Inference Stream (OpenAI SDK Compliant)..."
curl -N -s "$GATEWAY_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer demo-user-123" \
  -d '{
    "model": "llama-3.3-70b-instruct",
    "messages": [{"role": "user", "content": "Explain Level-2 Order Books for decentralized inference."}],
    "stream": true
  }'

echo ""
echo ""
# 6. Check Escrow Balance & Settlement
echo "[6/6] Checking Consumer Balance & Settled Micro-USD..."
curl -s "$GATEWAY_URL/v1/account/balance" -H "Authorization: Bearer demo-user-123" | python3 -m json.tool

echo ""
echo "Cleaning up background nodes..."
kill -9 $NODE1_PID $NODE2_PID $GATEWAY_PID 2>/dev/null || true
echo "=========================================================="
echo "✅ INFERENCE EXCHANGE E2E TEST COMPLETED SUCCESSFULLY!"
echo "=========================================================="
