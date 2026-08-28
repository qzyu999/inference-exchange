"""CLI tools for inference-exchange."""

import argparse
import logging
import sys

from inference_exchange.config import DEFAULT_MODEL_FILE, DEFAULT_MODEL_REPO, MODELS_DIR

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def download_model(repo: str = DEFAULT_MODEL_REPO, filename: str = DEFAULT_MODEL_FILE):
    """Download a GGUF model from HuggingFace."""
    from huggingface_hub import hf_hub_download

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    target = MODELS_DIR / filename

    if target.exists():
        logger.info(f"Model already exists: {target}")
        return str(target)

    logger.info(f"Downloading {repo}/{filename}...")
    logger.info(f"  → {target}")

    path = hf_hub_download(
        repo_id=repo,
        filename=filename,
        local_dir=str(MODELS_DIR),
        local_dir_use_symlinks=False,
    )

    logger.info(f"Download complete: {path}")
    return path


def list_models():
    """List locally available models."""
    if not MODELS_DIR.exists():
        print("No models directory found. Run 'download-model' first.")
        return

    gguf_files = list(MODELS_DIR.glob("*.gguf"))
    if not gguf_files:
        print("No models found. Run 'download-model' first.")
        return

    print(f"Models in {MODELS_DIR}:")
    for f in gguf_files:
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  {f.name} ({size_mb:.0f} MB)")


def main():
    parser = argparse.ArgumentParser(description="Inference Exchange CLI")
    subparsers = parser.add_subparsers(dest="command")

    # download-model
    dl_parser = subparsers.add_parser("download-model", help="Download a GGUF model")
    dl_parser.add_argument("--repo", default=DEFAULT_MODEL_REPO, help="HuggingFace repo")
    dl_parser.add_argument("--file", default=DEFAULT_MODEL_FILE, help="GGUF filename")

    # list-models
    subparsers.add_parser("list-models", help="List local models")

    args = parser.parse_args()

    if args.command == "download-model":
        download_model(args.repo, args.file)
    elif args.command == "list-models":
        list_models()
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
