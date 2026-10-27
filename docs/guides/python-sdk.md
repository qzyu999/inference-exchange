# Use the OpenAI Python SDK

Inference Exchange has an OpenAI-compatible API. You can use the standard `openai` package. You do not need a copy of this repository.

The alpha is experimental. Availability is not guaranteed. Credits are simulated. You do not pay real money.

## 1. Get an API key

1. Sign in to the web UI with GitHub.
2. Go to **Keys**.
3. Create a key. The key starts with `sk-ie-`.
4. Copy the key. The UI shows the full key only one time.

Keep the key secret. Do not put it in browser code or in a Git repository.

## 2. Install the SDK

```bash
pip install openai
```

## 3. Send a request

Put the key and the API address in environment variables:

```bash
export IE_API_KEY="sk-ie-..."
export IE_BASE_URL="https://<alpha-hostname>/v1"
```

Replace `<alpha-hostname>` with the hostname that the operator gives you.

```python
import os

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["IE_API_KEY"],
    base_url=os.environ["IE_BASE_URL"],
)

result = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "Say hello."}],
    max_tokens=64,
    extra_body={"ocip_min_confidence": "open"},
)
print(result.choices[0].message.content)
```

### Streaming

```python
stream = client.chat.completions.create(
    model="default",
    messages=[{"role": "user", "content": "Count to five."}],
    stream=True,
    extra_body={"ocip_min_confidence": "open"},
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

### List models

```python
for model in client.models.list():
    print(model.id)
```

Use `model="default"` to accept any model. Use a model ID from the list to require that model.

## 4. Exchange options

Send these fields in `extra_body`. The OpenAI SDK sends them to the server unchanged.

| Field | Default | Function |
|---|---|---|
| `ocip_min_confidence` | `hardened` | The minimum trust level of the provider: `open`, `contained`, `hardened`, or `confidential`. |
| `ocip_preference` | `balanced` | How to select a provider: `cheapest`, `fastest`, `most_secure`, or `balanced`. |
| `ocip_max_price` | none | The maximum price, in USD per million output tokens. |
| `ocip_session_id` | none | Send related requests to the same provider, if it is available. |

### Trust levels

The default minimum trust level is `hardened`. In the alpha, most providers are `open`. A provider claims its trust level. The coordinator does not verify `open`, `contained`, or `hardened` claims yet. For more information, see [Status](../status.md).

If no provider meets your minimum trust level, the request fails immediately. The error message gives the highest level that is available. The system never lowers your trust level for you. To use an `open` provider, set `ocip_min_confidence` to `open`.

## 5. Errors

Each error has the OpenAI format: `{"error": {"message", "type", "code"}}`. The SDK raises an exception that contains the message.

| HTTP | `code` | Cause | Action |
|---|---|---|---|
| 401 | `invalid_api_key` | The key is wrong, revoked, or expired. | Create a new key. |
| 401 | `authentication_required` | The request has no key. | Set `api_key`. |
| 403 | `account_suspended` | An operator suspended the account. | Contact the operator. |
| 402 | `insufficient_balance` | The simulated balance is zero. | Reset the balance in the web UI. |
| 429 | `rate_limit_exceeded` | Too many requests in a short time. | Wait, then try again. |
| 429 | `concurrency_limit` | Too many requests at the same time from your account. | Wait for a request to finish. |
| 503 | `no_provider_available` | No provider is online. | Try again later. |
| 503 | `no_compatible_provider` | No provider meets your trust level or price. | Read the message. Change the constraint, or try again later. |
| 503 | `model_not_available` | No provider serves the model. | Use `default` or a model from `client.models.list()`. |
| 503 | `queue_timeout` | All matching providers stayed busy. | Try again later. |
| 503 | `inference_paused` | The operator paused inference. | Try again later. |
| 502, 504 | `provider_error`, `provider_timeout` | The provider failed or did not answer. | Try again. |

The SDK retries some errors automatically. To turn off retries, set `max_retries=0` on the client.

## 6. Known limits

- Only `/v1/models` and `/v1/chat/completions` are available.
- Message `content` must be a string. Images, tool calls, `n`, `logprobs`, and `response_format` are not supported.
- `max_tokens` must be from 1 to 32768. A request can have a maximum of 100 messages and 200,000 characters.
- `usage` token counts can be estimates.
- One provider can serve a small number of requests at the same time. Expect queues and slow answers.

## 7. Privacy

The OpenAI-compatible API is not confidential. The coordinator can see the prompt and the response on this path. Do not send secrets or personal data.

A separate confidential path exists. It encrypts the request on your computer. It is not ready for general use. For more information, see [Threat model](../security/threat-model.md).

## Report a problem

Open an issue on GitHub. Give the time, the HTTP status, the error `code`, and the model. Do not include your API key or your prompt.
