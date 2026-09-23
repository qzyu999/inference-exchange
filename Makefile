# Inference Exchange — Development Makefile
#
# Quick start:
#   make setup   — create venv, install deps, download model, install web deps
#   make dev     — start coordinator + web UI (add provider separately)
#   make test    — run tests
#   make smoke   — quick E2E smoke test (coordinator must be running)

SHELL := /bin/bash
VENV := .venv
PY := $(VENV)/bin/python
PIP := $(VENV)/bin/pip
ACTIVATE := source $(VENV)/bin/activate

.PHONY: setup setup-py setup-web setup-model dev dev-coordinator dev-web dev-provider test smoke lint clean help

# ─── Setup ────────────────────────────────────────────────────

setup: setup-py setup-web  ## Full setup: Python + web UI (run 'make setup-model' to download a model)
	@echo ""
	@echo "✅ Setup complete. Run 'make dev' to start."
	@echo "   To download a small test model: make setup-model"
	@echo "   Or point the provider at an existing GGUF: make dev-provider ARGS='--model /path/to/model.gguf'"

setup-py:  ## Create venv and install Python dependencies
	@echo "📦 Setting up Python environment..."
	@test -d $(VENV) || python3 -m venv $(VENV)
	@$(PIP) install --upgrade pip -q
	@$(PIP) install -e ".[dev]" -q
	@echo "  Python deps installed."

setup-model:  ## Download the default model (Qwen 2.5 0.5B, ~400MB)
	@echo "🤖 Checking model..."
	@$(PY) -c "from inference_exchange.config import MODELS_DIR, DEFAULT_MODEL_FILE; \
		p = MODELS_DIR / DEFAULT_MODEL_FILE; \
		exit(0 if p.exists() else 1)" 2>/dev/null && \
		echo "  Model already downloaded." || \
		(echo "  Downloading model..." && $(PY) -m inference_exchange download-model)

setup-web:  ## Install web UI dependencies
	@echo "🌐 Setting up web UI..."
	@cd web && npm install --silent 2>/dev/null
	@echo "  Web deps installed."

# ─── Development ──────────────────────────────────────────────

dev:  ## Start coordinator + web UI (run provider separately with 'make dev-provider')
	@echo "🚀 Starting Inference Exchange..."
	@echo "   Coordinator: http://localhost:8000"
	@echo "   Web UI:      http://localhost:3000"
	@echo "   Press Ctrl+C to stop."
	@echo ""
	@$(ACTIVATE) && $(PY) -m inference_exchange.coordinator &
	@cd web && npm run dev &
	@wait

dev-coordinator:  ## Start coordinator only
	@$(ACTIVATE) && $(PY) -m inference_exchange.coordinator

dev-web:  ## Start web UI only
	@cd web && npm run dev

dev-provider:  ## Start a local provider (default: Qwen 0.5B at $0.15/Mtok). Pass ARGS for custom model.
	@$(ACTIVATE) && $(PY) -m inference_exchange.provider \
		--name "local-dev" \
		--price-output 0.15 \
		$(ARGS)

dev-provider-agent:  ## Start the OCIP agent provider (production path)
	@$(ACTIVATE) && $(PY) -m ocip_agent.agent

# ─── Testing ──────────────────────────────────────────────────

test:  ## Run all tests
	@$(ACTIVATE) && $(PY) -m pytest tests/ -v

smoke:  ## Quick smoke test (coordinator must be running)
	@echo "🔥 Smoke test..."
	@curl -sf http://localhost:8000/health | python3 -m json.tool > /dev/null && \
		echo "  ✅ Coordinator healthy" || \
		(echo "  ❌ Coordinator not running. Start with 'make dev-coordinator'" && exit 1)
	@curl -sf -X POST http://localhost:8000/v1/chat/completions \
		-H "Content-Type: application/json" \
		-d '{"model":"default","messages":[{"role":"user","content":"Say hello in one word."}],"stream":false}' \
		| python3 -c "import sys,json; r=json.load(sys.stdin); print('  ✅ Got response:', r['choices'][0]['message']['content'][:80])" 2>/dev/null || \
		echo "  ⚠️  No provider available (start one with 'make dev-provider')"

lint:  ## Run linter
	@$(ACTIVATE) && ruff check .

# ─── Cleanup ──────────────────────────────────────────────────

clean:  ## Remove venv, caches, build artifacts
	rm -rf $(VENV) __pycache__ *.egg-info .pytest_cache
	rm -rf inference_exchange/__pycache__ tests/__pycache__
	rm -rf web/node_modules web/dist

# ─── Help ─────────────────────────────────────────────────────

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
