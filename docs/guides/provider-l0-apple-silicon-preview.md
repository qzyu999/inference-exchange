# Experimental Apple Silicon L0 OCIP provider setup

**Status: Code-matched preview. Not yet independently qualified on a new Mac.**

This guide describes the current self-service API and OCIP command-line interface.
This is not a tested public-alpha installation procedure. The coordinator
disables self-service issuance by default with `IE_PROVIDER_SELF_ENROLL_ENABLED=0`.
The team must complete the independent-Mac acceptance checklist below before
it enables enrollment or calls a Mac/software combination "tested."

This guide applies only to Apple Silicon/macOS, a local GGUF model, the
`llama-server` executable, and **L0/Open** trust. The provider operator can
inspect plaintext. The declared hardware is not attested. This workflow does
not provide a hardened runtime, confidential inference, or payouts.

## 1. Check your Mac and install the tools

These commands are a **candidate** flow, not a verified hardware recipe.

1. Use a Mac with Apple Silicon and a supported macOS release.
   We have not recorded a minimum qualified macOS release.
2. Install Git, Python 3.11 or later, the required Python build tools, and a
   Metal-capable `llama-server` from the upstream llama.cpp project.
   Confirm that the executable is on your `PATH`.
3. Use a trusted network. Do not expose TCP port 9999 or a raw model-serving
   endpoint to the public internet.

Verify your machine and executable:

```bash
uname -m
sw_vers
python3 --version
command -v llama-server
```

The first command must report `arm64`. The final command must return an
executable path. Record the exact macOS, Apple chip, `llama-server` build,
and Python version during hardware qualification.

## 2. Check out a known IE code revision

The following revision contains the #159 enrollment APIs and #160 enrollment
wizard. **Pinning repository code does not certify a machine or model build.**

```bash
git clone https://github.com/qzyu999/inference-exchange.git
cd inference-exchange
git checkout --detach 1cf53451b2fb0e9ac896ac3d497708e00ecabe3f
make setup-py
source .venv/bin/activate
make setup-model
```

The `make setup-py` target installs the project's Python dependencies.
On some Macs, building `llama-cpp-python` needs a compiler and may fail.
Do not disable TLS verification or change package security settings to make
this step work. Record failures as qualification evidence.

The `make setup-model` target downloads the project's default small test
model. You may also supply your own locally stored GGUF file. Do not report
that a model is tested unless the exact model file and quantization passed
the independent-Mac test.

## 3. Enroll your account

1. Open [IE /provide](https://alpha.inferenceex.com/provide) and sign in with
   a GitHub-linked IE account.
2. Verify the declaration **Apple Silicon/macOS + GGUF/Metal, L0/Open**.
   The declaration is not proof of hardware identity.
3. Enroll a node only if the coordinator owner has enabled enrollment.
4. Save the newly issued `pt-ie-` credential securely. It appears only once.
   It is not available again in the dashboard or credential metadata.
5. If the API returns HTTP 503, the operator has not enabled enrollment.
   **Stop here.** Do not use the admin-token endpoint instead.
6. If the API returns HTTP 409, you already have an active self-service node.
   Do not enroll duplicate nodes. For a lost credential, follow the explicit
   revocation flow, then create a new node. This does not preserve the revoked
   node's billing principal or move historical earnings.

Never paste the credential into a URL, issue comment, repository, screenshot,
shell command argument or terminal history.

## 4. Start the OCIP agent (candidate command)

Choose your downloaded GGUF path. Replace the placeholder below with the
actual local filename. Confirm that the model exists. Keep the
`llama-server` host on `127.0.0.1`; the OCIP agent manages its lifecycle
and uses a local-only inference port.

```bash
export IE_MODEL_PATH="$HOME/.inference-exchange/models/YOUR_MODEL.gguf"
test -f "$IE_MODEL_PATH" || { echo "GGUF model file not found"; exit 1; }
```

Enter the credential at a **hidden prompt** rather than pasting it into the
shell command text. The variable is stored only in the current shell and
inherited by the agent process. Environment variables are not a protected
secret store: same-user or privileged processes may be able to read them.
Use a private terminal session and a secure local secret manager.

```bash
export IE_PROVIDER_TOKEN="$(python3 -c 'from getpass import getpass; print(getpass("Provider credential: "))')"
python -m ocip_agent.agent \
  --coordinator wss://alpha.inferenceex.com/ws/provider \
  --model "$IE_MODEL_PATH" \
  --llama-server "$(command -v llama-server)" \
  --name "my-mac-mini" \
  --trust open \
  --max-concurrent 1
```

Do **not** pass the credential to `--token` or append `?token=` to the
WebSocket URL. The `IE_PROVIDER_TOKEN` environment variable is read by the
OCIP agent. The agent's transport uses the WebSocket
`Authorization: Bearer` upgrade header. A self-service credential in
the URL is rejected by the coordinator.

The provider makes an **outbound** authenticated `wss://` connection.
It does not require an inbound public network port to your Mac.
The agent launches a local `llama-server` bound to `127.0.0.1`.
The coordinator does not gain a verified trusted-execution guarantee
from this network connection.

Stop the agent with Ctrl+C when finished and unset the temporary token:

```bash
unset IE_PROVIDER_TOKEN
```

## 5. Check the live result and diagnose failures

Open [/dashboard](https://alpha.inferenceex.com/dashboard) while signed in.
It reads only the nodes and simulated earnings owned by that IE account.

- **Offline node:** Check the agent's local `llama-server` health, the
  model path, and outbound WebSocket reachability.
- **Registration rejected:** Confirm an Apple Silicon hardware declaration,
  GGUF model format, L0/Open, bounded offers, and a valid credential.
  Do not claim a higher trust level to bypass policy.
- **Credential rejected:** It may be revoked, invalid, or owned by a
  suspended account. The secret is not recoverable from IE.
- **No market matches:** Verify the model advertised by the provider and
  the consumer's allowed trust level. An L0 provider cannot serve an
  L2-only request.
- **No earnings:** A registered provider earns nothing until requests
  are actually served and billed. Credits are simulated, not cash.
- **Ledger mismatch:** Stop the acceptance test and investigate;
  do not equate the starting simulated account grant with earnings.

A provider owner may revoke only the owner's **self-service** credential
from [/provide](https://alpha.inferenceex.com/provide). That revocation
disconnects its live WebSocket sessions. It does not delete historical
transactions or rotate operator-issued legacy credentials.

## Independent Mac acceptance checklist (not yet completed)

Before public-alpha provider enrollment is enabled, record the following:

- [ ] A GitHub user **different from the coordinator owner** enrolls on a
      fresh Apple Silicon Mac without admin API calls or founder shell access.
- [ ] The exact macOS, Apple Silicon model, RAM, Python, `llama-server`
      commit/build, IE commit and GGUF SHA-256 are recorded.
- [ ] The agent connects using the HTTP Authorization upgrade header
      through the deployed outbound TLS tunnel.
- [ ] The first registration is L0/Open and its hardware/format labels
      are explicitly recorded as **claims**, not attestation.
- [ ] A real prompt completes; exact consumer debit equals provider
      earnings plus platform fee in integer micro-USD.
- [ ] A second GitHub account cannot view the new provider's nodes,
      earnings, or manage its credential.
- [ ] A second active self-service enrollment is rejected. The revoked
      credential disconnects and cannot reconnect.
- [ ] The existing independently running M6 provider's credential,
      node identity, billing principal and previous ledger entries
      stay unchanged.
- [ ] Restart and rollback of the coordinator use a disposable or backed-up
      SQLite database before touching the running alpha.
- [ ] The local setup failure paths (model download, server launch,
      WebSocket handshake, failed registration and offline state) are
      reproduced and documented.

Once these checks pass, replace this preview with an actual **tested**
versioned recipe, including the qualification evidence and exact known-good
commands. Until then, treat the supported real-hardware installation status
as **unverified for independent self-service onboarding**.

For the old operator-issued or local-LAN development flow, see
[Getting started](getting-started.md). That document is not the
supported internet-facing self-service alpha setup.
