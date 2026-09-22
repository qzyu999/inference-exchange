#!/usr/bin/env bash
# Inference Exchange — One-command setup
# Usage: ./scripts/setup.sh
set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  Inference Exchange — Setup"
echo "═══════════════════════════════════════════════════════════"
echo ""

# 1. Python venv
echo "📦 Python environment..."
if [ ! -d .venv ]; then
    python3 -m venv .venv
    echo "  Created .venv"
fi
source .venv/bin/activate
pip install --upgrade pip -q
pip install -e ".[dev]" -q
echo "  ✅ Python deps installed"

# 2. Model download
echo ""
echo "🤖 Model..."
MODEL_DIR="$HOME/.inference-exchange/models"
MODEL_FILE="Qwen2.5-0.5B-Instruct-Q4_K_M.gguf"
if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
    echo "  ✅ Model already downloaded"
else
    echo "  Downloading Qwen 2.5 0.5B (~400MB)..."
    python -m inference_exchange download-model
fi

# 3. Web UI
echo ""
echo "🌐 Web UI..."
if [ -d web/node_modules ]; then
    echo "  ✅ Web deps already installed"
else
    cd web && npm install --silent && cd ..
    echo "  ✅ Web deps installed"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo ""
echo "  Next steps:"
echo "    make dev              — Start coordinator + web UI"
echo "    make dev-provider     — Start a local provider (separate terminal)"
echo ""
echo "  Then open http://localhost:3000"
echo "═══════════════════════════════════════════════════════════"
