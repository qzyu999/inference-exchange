"""Provider entrypoint."""

import argparse
import asyncio
import logging
import sys

from inference_exchange.config import ProviderConfig

from .agent import ProviderAgent
from .inference import InferenceEngine, find_model_path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Inference Exchange Provider")
    parser.add_argument("--name", default="local-provider", help="Provider display name")
    parser.add_argument("--price-input", type=float, default=0.05, help="$/Mtok input")
    parser.add_argument("--price-output", type=float, default=0.20, help="$/Mtok output")
    parser.add_argument("--model", default=None, help="Path to GGUF model file")
    parser.add_argument("--coordinator", default="ws://localhost:8000/ws/provider")
    parser.add_argument("--n-ctx", type=int, default=4096, help="Context window size")
    parser.add_argument("--n-gpu-layers", type=int, default=-1, help="GPU layers (-1=all, 0=CPU)")
    parser.add_argument("--max-concurrent", type=int, default=2, help="Max concurrent requests")
    parser.add_argument("--trust", default="open", choices=["open", "contained", "hardened", "confidential"],
                        help="Advertised trust level")
    parser.add_argument("--tps", type=float, default=0, help="Advertised tokens/sec (0=auto-measure)")
    parser.add_argument("--hardware", default=None, help="Hardware label (e.g. apple-m4-pro)")
    args = parser.parse_args()

    config = ProviderConfig(
        coordinator_url=args.coordinator,
        model_path=args.model,
        provider_name=args.name,
        n_ctx=args.n_ctx,
        n_gpu_layers=args.n_gpu_layers,
        max_concurrent=args.max_concurrent,
    )

    # Find model
    model_path = config.model_path or find_model_path()
    if model_path is None:
        logger.error(
            "No model found. Run 'python -m inference_exchange download-model' first."
        )
        sys.exit(1)

    # Load inference engine
    engine = InferenceEngine(
        model_path=model_path,
        n_ctx=config.n_ctx,
        n_gpu_layers=config.n_gpu_layers,
    )

    # Run agent with pricing
    agent = ProviderAgent(
        config, engine,
        price_per_mtok_input=args.price_input,
        price_per_mtok_output=args.price_output,
        trust_level=args.trust,
        measured_tps=args.tps,
        hardware_override=args.hardware,
    )
    logger.info(f"Provider '{args.name}' — ${args.price_output}/Mtok, trust={args.trust}, tps={args.tps}")

    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        logger.info("Provider shutting down.")


if __name__ == "__main__":
    main()
