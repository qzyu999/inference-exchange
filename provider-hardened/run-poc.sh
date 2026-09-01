#!/bin/bash
# OCIP Hardened Provider — Run Script (POC)
#
# Starts the hardened inference server + OCIP agent together.
# The agent manages the server lifecycle and connects to the coordinator.
#
# Usage:
#   ./run-poc.sh --model ~/path/to/model.gguf
#   ./run-poc.sh --model ~/path/to/model.gguf --coordinator ws://192.168.1.100:8000/ws/provider
#
# The coordinator can be running on the same machine or on your Windows PC.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_BIN="$SCRIPT_DIR/ocip-llama-server"

# --- Defaults ---
MODEL_PATH=""
COORDINATOR_URL="ws://localhost:8000/ws/provider"
PROVIDER_NAME="m3-hardened-poc"
PRICE_OUTPUT="0.10"
SERVER_PORT="9999"
GPU_LAYERS="-1"   # -1 = all layers on GPU

# --- Parse args ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --model) MODEL_PATH="$2"; shift 2 ;;
        --coordinator) COORDINATOR_URL="$2"; shift 2 ;;
        --name) PROVIDER_NAME="$2"; shift 2 ;;
        --price) PRICE_OUTPUT="$2"; shift 2 ;;
        --port) SERVER_PORT="$2"; shift 2 ;;
        --gpu-layers) GPU_LAYERS="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 --model <path-to-gguf> [options]"
            echo ""
            echo "Options:"
            echo "  --model PATH         Path to GGUF model file (required)"
            echo "  --coordinator URL    Coordinator WebSocket URL (default: ws://localhost:8000/ws/provider)"
            echo "  --name NAME          Provider name (default: m3-hardened-poc)"
            echo "  --price PRICE        Price per Mtok output (default: 0.10)"
            echo "  --port PORT          Inference server port (default: 9999)"
            echo "  --gpu-layers N       GPU layers (-1 = all, default: -1)"
            exit 0
            ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

if [ -z "$MODEL_PATH" ]; then
    # Try to auto-detect
    MODEL_PATH=$(find ~/.inference-exchange/models ~/.cache/huggingface ~/Desktop \
        -name "*.gguf" -type f 2>/dev/null | head -1 || true)
    if [ -z "$MODEL_PATH" ]; then
        echo "ERROR: No model specified and none auto-detected."
        echo "Usage: $0 --model ~/path/to/model.gguf"
        exit 1
    fi
    echo "Auto-detected model: $MODEL_PATH"
fi

if [ ! -f "$MODEL_PATH" ]; then
    echo "ERROR: Model not found: $MODEL_PATH"
    exit 1
fi

if [ ! -f "$SERVER_BIN" ]; then
    echo "ERROR: Hardened server not built yet."
    echo "Run ./build-poc.sh first."
    exit 1
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  OCIP Hardened Provider — POC Run        ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Server:      $SERVER_BIN"
echo "  Model:       $(basename "$MODEL_PATH") ($(du -h "$MODEL_PATH" | awk '{print $1}'))"
echo "  Listen:      127.0.0.1:$SERVER_PORT"
echo "  GPU layers:  $GPU_LAYERS"
echo "  Coordinator: $COORDINATOR_URL"
echo "  Name:        $PROVIDER_NAME"
echo "  Price:       \$$PRICE_OUTPUT/Mtok"
echo ""

# --- Start hardened inference server ---
echo "[1/3] Starting hardened inference server..."
"$SERVER_BIN" \
    --model "$MODEL_PATH" \
    --host 127.0.0.1 \
    --port "$SERVER_PORT" \
    -ngl "$GPU_LAYERS" \
    --ctx-size 4096 \
    &
SERVER_PID=$!

# Cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID"
        wait "$SERVER_PID" 2>/dev/null || true
        echo "  ✓ Server stopped (PID $SERVER_PID)"
    fi
}
trap cleanup EXIT INT TERM

# Wait for server to be ready
echo "[2/3] Waiting for server to load model..."
for i in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:$SERVER_PORT/health" > /dev/null 2>&1; then
        echo "  ✓ Server ready (took ${i}s)"
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "  ✗ Server crashed during startup. Check output above."
        exit 1
    fi
    sleep 1
done

# Verify it's actually hardened
echo -n "  Hardening: "
if lldb -p "$SERVER_PID" -b -o "quit" 2>&1 | grep -qi "not permitted\|error\|failed"; then
    echo "✓ Debugger blocked"
else
    echo "⚠ Debugger NOT blocked (running unhardened)"
fi

# --- Option A: Start OCIP agent (if inference-exchange is set up) ---
echo "[3/3] Starting OCIP agent..."
if [ -f "$REPO_DIR/ocip_agent/agent.py" ]; then
    # Check if venv exists
    VENV=""
    if [ -f "$REPO_DIR/.venv/bin/activate" ]; then
        VENV="$REPO_DIR/.venv/bin/activate"
    elif [ -f "$REPO_DIR/venv/bin/activate" ]; then
        VENV="$REPO_DIR/venv/bin/activate"
    fi

    if [ -n "$VENV" ]; then
        echo "  Using venv: $VENV"
        source "$VENV"
    fi

    python3 "$REPO_DIR/ocip_agent/agent.py" \
        --name "$PROVIDER_NAME" \
        --price-output "$PRICE_OUTPUT" \
        --trust hardened \
        --coordinator "$COORDINATOR_URL" \
        --port "$SERVER_PORT"
else
    echo "  OCIP agent not found at $REPO_DIR/ocip_agent/agent.py"
    echo "  Server is running standalone at http://127.0.0.1:$SERVER_PORT"
    echo ""
    echo "  Test with:"
    echo "    curl http://127.0.0.1:$SERVER_PORT/v1/chat/completions \\"
    echo "      -H 'Content-Type: application/json' \\"
    echo "      -d '{\"model\":\"test\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"max_tokens\":20}'"
    echo ""
    echo "  Press Ctrl+C to stop."
    wait "$SERVER_PID"
fi
