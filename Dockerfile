FROM python:3.11-slim

WORKDIR /app

# Install dependencies (no llama-cpp needed for coordinator)
COPY pyproject.toml .
RUN pip install --no-cache-dir \
    fastapi uvicorn[standard] websockets pydantic httpx pynacl \
    huggingface-hub sse-starlette

# Copy source
COPY inference_exchange/ inference_exchange/

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import httpx; r=httpx.get('http://localhost:8000/health'); assert r.status_code==200"

# Run coordinator
CMD ["python", "-m", "inference_exchange.coordinator"]
