"""Prove the official OpenAI Python SDK works against Inference Exchange.

This is the credibility test: if `from openai import OpenAI` works with
our coordinator, any application using the OpenAI SDK can switch by
changing one URL.

Run with coordinator + provider running:
  .venv\\Scripts\\python tests/test_openai_sdk.py
"""

import sys
from openai import OpenAI

BASE_URL = "http://localhost:8000/v1"
API_KEY = "sk-ie-test"  # Any key works (falls back to default consumer)


def test_chat_completion_streaming():
    """Standard streaming chat completion."""
    client = OpenAI(base_url=BASE_URL, api_key=API_KEY)

    print("[1] Streaming chat completion...")
    stream = client.chat.completions.create(
        model="default",
        messages=[{"role": "user", "content": "Say hello in 5 words."}],
        max_tokens=20,
        stream=True,
    )

    tokens = []
    for chunk in stream:
        if chunk.choices[0].delta.content:
            tokens.append(chunk.choices[0].delta.content)
            print(f"    token: {chunk.choices[0].delta.content!r}")

    assert len(tokens) > 0, "No tokens received!"
    print(f"    ✓ Got {len(tokens)} tokens: {''.join(tokens)}")


def test_chat_completion_non_streaming():
    """Non-streaming (single response)."""
    client = OpenAI(base_url=BASE_URL, api_key=API_KEY)

    print("[2] Non-streaming chat completion...")
    response = client.chat.completions.create(
        model="default",
        messages=[{"role": "user", "content": "What is 1+1? One word."}],
        max_tokens=10,
        stream=False,
    )

    content = response.choices[0].message.content
    assert content and len(content) > 0, "Empty response!"
    print(f"    ✓ Response: {content}")
    print(f"    ✓ Usage: {response.usage}")


def test_list_models():
    """List available models."""
    client = OpenAI(base_url=BASE_URL, api_key=API_KEY)

    print("[3] List models...")
    models = client.models.list()
    model_ids = [m.id for m in models.data]
    assert len(model_ids) > 0, "No models!"
    print(f"    ✓ Models: {model_ids}")


def main():
    print()
    print("=" * 50)
    print("  OpenAI SDK Compatibility Test")
    print("  Target: " + BASE_URL)
    print("=" * 50)
    print()

    try:
        test_list_models()
        test_chat_completion_non_streaming()
        test_chat_completion_streaming()
    except Exception as e:
        print(f"\n  ❌ FAILED: {e}")
        sys.exit(1)

    print()
    print("  ✅ All tests passed — official OpenAI SDK works!")
    print("     Any app using `from openai import OpenAI` can use Inference Exchange")
    print("     by changing base_url to your coordinator.")
    print()


if __name__ == "__main__":
    main()
