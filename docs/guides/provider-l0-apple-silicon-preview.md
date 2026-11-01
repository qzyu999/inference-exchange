# Experimental Apple Silicon L0 OCIP provider setup

**Status: Code-matched candidate. Not yet independently qualified on a new Mac.**

This is not a tested public-alpha installation procedure.

Use this guide with [Provide compute](https://alpha.inferenceex.com/provide).
It covers a new Apple Silicon/macOS host with one local GGUF model and
a Metal-enabled `llama-server`. The provider uses L0/Open trust: its operator
can read plaintext prompts. Hardware labels are unverified claims.
Credits are simulated. This workflow offers no confidential execution
or real payouts.

**Before you enroll:** The coordinator disables self-service issuance by
default (`IE_PROVIDER_SELF_ENROLL_ENABLED=0`). You can check hardware and
download software without a credential. A 503 response from `/provide` means
enrollment is disabled. Do not bypass this with administrator credentials.
Do not replace the credential, node or local services of an existing provider.

## What is a GGUF model? Can I use another format?

For **this specific IE alpha backend**, GGUF is required. The OCIP agent
starts `llama-server`, and llama.cpp loads model weights in **GGUF** format.
An ordinary Hugging Face `model.safetensors` file, a model repo name, or an
Ollama model name is **not** a valid local path for the agent's `--model` flag.
llama.cpp offers conversion tools for some other weight formats, but
conversion and other runtimes are **not qualified IE onboarding paths**.
GGUF is a requirement of the current backend, not a permanent requirement
for every future IE provider.

The **model file** is not the **model server**. Install `llama-server` once,
download a compatible GGUF file, and point the OCIP agent at that file.
**Do not start a separate `llama-server` manually.** The agent launches
it on `127.0.0.1` and manages its health.

References:
- [llama.cpp supported model formats and conversion](https://github.com/ggml-org/llama.cpp/blob/master/docs/models.md)
- [Homebrew llama.cpp package, including llama-server](https://formulae.brew.sh/formula/llama.cpp)
- [Hugging Face Qwen2.5 0.5B Instruct GGUF](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF)

## 1. Check the Mac and required tools

Open Terminal on the Mac that will provide inference:

```bash
uname -m
sw_vers -productVersion
python3 --version
git --version
```

- `uname -m` must print `arm64`. Intel Macs are not in this alpha scope.
- Use Python **3.11 or later**, Git, a supported macOS release and enough
  available memory/disk for your chosen model.
- Record the Mac chip, macOS version, RAM, free disk space and Python version.
  We have not qualified a minimum macOS release or memory configuration.
- Do not expose raw inference TCP port `9999` or a local model endpoint
  through your router or to the public internet.

If Python or Git is missing, install it from a trusted vendor before
continuing. Stop if the host is not an eligible Apple Silicon Mac.

## 2. Install llama-server with Homebrew

If you have no Homebrew, follow the official installation instructions at
[brew.sh](https://brew.sh/). Read their commands before you run them.
Follow Homebrew's terminal `PATH` instructions.

Then install the native llama.cpp package:

```bash
brew install llama.cpp
command -v llama-server
llama-server --version
```

`command -v llama-server` must print an executable path. Record its
reported version/build. The Homebrew package includes `llama-server`;
you normally do **not** need to compile llama.cpp yourself.

If `brew` or `llama-server` is not found, finish Homebrew setup and check
`PATH`. Do not silently continue to the Python fallback: the qualified
native-backend recipe must test the actual `llama-server` executable.

## 3. Download a small GGUF model (the easiest first test)

**Recommended candidate:** [Qwen2.5 0.5B Instruct Q4_K_M GGUF](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/blob/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf).

This is the exact public model repository and filename configured in
`inference_exchange/config.py`. The **Q4_K_M** file is about **398 MB**.
It is a small smoke-test model, not a quality, speed, or privacy guarantee.
The GGUF file size does **not** equal total runtime memory usage.

Download only the single `.gguf` file. The following commands use HTTPS,
store it in IE's model directory, and verify the SHA-256 published on its
Hugging Face file page **before** moving the temporary download into place:

```bash
MODEL_FILE="$HOME/.inference-exchange/models/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf"
mkdir -p "$HOME/.inference-exchange/models"
if [ -f "$MODEL_FILE" ]; then
  echo "Model already present. Checking its SHA-256."
else
  curl --fail --location --retry 3 \
    --output "$MODEL_FILE.partial" \
    "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf" &&
  printf "%s  %s\n" \
    "6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653" \
    "$MODEL_FILE.partial" | shasum -a 256 -c - &&
  mv -n "$MODEL_FILE.partial" "$MODEL_FILE"
fi
printf "%s  %s\n" \
  "6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653" \
  "$MODEL_FILE" | shasum -a 256 -c -
```

The final checksum check must print `OK`. If it fails, **do not run the
download**. Check the file's size, the network, the URL and the SHA-256
shown on the Hugging Face file page. The checksum is pinned for this
candidate artifact; do not change it just to make a failing download pass.

**Browser alternative:** On the [specific Hugging Face file page](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/blob/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf),
select Download. Move the resulting `.gguf` file into
`~/.inference-exchange/models/`, then run the final `shasum` verification
above. Avoid downloading the complete multi-quantization repository.

**Existing developer command:** `make setup-model` also downloads IE's
configured default Qwen GGUF after the Python environment is installed.
That command does not itself certify the content hash. For the first
external-provider trial, the direct verified download above avoids extra
Python dependencies.

### Use a different model later

1. Choose a **chat/instruct GGUF** that your version of llama.cpp supports.
2. Read the model card and license. Do not assume every Hugging Face model
   permits every intended commercial or hosting use.
3. Choose the exact quantization and file. `Q4_K_M` is a reasonable
   starting point for the small test model; larger models can need much
   more unified memory, disk and KV-cache memory at runtime.
4. Download the file from its source to a local folder. Record its repository,
   version/commit, filename, quantization and SHA-256.
5. Set `--model` to the **absolute path** to that file in step 5.
   The agent does not accept `hf://`, an Ollama model tag or a directory
   in place of the local GGUF file path.

Split GGUF files, conversions, multimodal variants and unrelated inference
runtimes are not qualified by this initial alpha recipe. Even when a model
loads locally, IE's registration/matching may reject unsupported models or
capabilities. Record any incompatibility as an onboarding test failure.

## 4. Install the IE OCIP agent

This is a **candidate code revision** that matches the current enrollment
and bearer-header agent behavior. The exact macOS + Python + server + model
combination still requires real independent-machine qualification.

```bash
git clone https://github.com/qzyu999/inference-exchange.git
cd inference-exchange
git checkout --detach 482f3332ee4f9c232c418f5e8d02dc45d09f4059
make setup-py
source .venv/bin/activate
```

`make setup-py` installs the full current Python project dependencies.
On some Macs, it attempts to compile `llama-cpp-python`, even though the
native `llama-server` OCIP path does not need that Python inference backend.
A smaller provider-only dependency target is planned under
[provider onboarding issue #160](https://github.com/qzyu999/inference-exchange/issues/160).
If installation fails, record the Python version, macOS, chip and the
nonsecret error. Do not disable TLS checks or weaken local security to
make an installation succeed.

## 5. Enroll your own provider node

1. Open [Provide compute](https://alpha.inferenceex.com/provide).
2. Sign in with your own GitHub-linked IE account.
3. Read the **Apple Silicon/macOS + GGUF/Metal, L0/Open** declaration.
   This is a claim, not a remote hardware attestation.
4. If the operator has enabled self-service enrollment, enroll one node
   and save the newly issued `pt-ie-` credential securely. It appears once.
5. HTTP **503** means enrollment is not enabled. Stop.
   HTTP **409** means this account already has an active self-service node.
   Do not create duplicate nodes or use the administrator-only issuance API.
6. If the credential is lost, follow explicit owner revocation and
   new enrollment. That does **not** automatically preserve the old node
   billing principal or transfer its historical earnings.

Never paste the credential into a URL, issue comment, git commit,
shell-command argument, screenshot or diagnostic log.

## 6. Start the agent and verify real inference

Remain in the repository's active Python virtual environment from step 4.
Use the exact file downloaded above, or change the path for your own GGUF.

```bash
export IE_MODEL_PATH="$HOME/.inference-exchange/models/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf"
test -f "$IE_MODEL_PATH" && command -v llama-server
```

If either check fails, fix the missing model or server before continuing.

Enter the credential in a **hidden prompt**, not in the terminal command
arguments. The temporary environment variable is inherited by the agent;
environment variables are **not** a protected secret store. Use a private
terminal session and a secure local secret manager.

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

**What runs where?** The OCIP agent makes an outbound
`wss://alpha.inferenceex.com/ws/provider` connection, with the
`Authorization: Bearer` upgrade header. A self-service token in `?token=`
is rejected. The agent launches the native `llama-server` locally on
`127.0.0.1:9999` and waits for `/health`. Nothing here opens a public
inbound port or certifies L2/L3 confidential execution.

While the agent is running, you can check local model health from another
Terminal tab:

```bash
curl --fail http://127.0.0.1:9999/health
```

Then open the [private owner dashboard](https://alpha.inferenceex.com/dashboard).
Check that the node is **online** and advertises the expected model.
Have an authorized consumer send one **nonsensitive** L0/Open test prompt
to an actually available model. Verify that the request succeeded and that
the rightful owner sees simulated provider earnings. For exact settlement,
check consumer debit = provider credit + platform fee in integer micro-USD.
A healthy local server or an online node alone does not prove a complete
marketplace transaction.

Stop the foreground agent with **Ctrl+C**, then clear the token from the
current shell:

```bash
unset IE_PROVIDER_TOKEN
```

This first-run guide does **not** install a background service.
A reviewed `launchd` service policy, terminal credential failure handling
and reboot recovery are separate work in
[issue #178](https://github.com/qzyu999/inference-exchange/issues/178).
Do not replace a working existing provider's launchd agent for this test.

## Troubleshooting

| Observation | What to check |
| --- | --- |
| `uname -m` is not `arm64` | This Mac is outside the initial Apple Silicon alpha scope. |
| `brew` is missing | Follow [Homebrew](https://brew.sh/) setup and its PATH instructions. |
| `llama-server` is missing | Check the Homebrew formula installation and `command -v llama-server`. |
| Model download fails | Check disk space, HTTPS/network access, the exact file URL and any `.partial` file. |
| SHA-256 mismatch | Do not use or rename the file. Check its [published digest](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/blob/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf). |
| Python install fails | Record the nonsecret build error; `llama-cpp-python` may need development tools. |
| Enrollment returns 503 | The global provider enrollment switch is off. Do not bypass it. |
| Enrollment returns 409 | This account already has an active self-service node. |
| Agent cannot connect | Check TLS/WSS reachability, the unrevoked credential, account state, and auth header. |
| Node is offline | Check the local GGUF path, server health, macOS resource limits and agent output. |
| No matching model | Check the advertised model ID and consumer's L0/Open selection. |
| No earnings | The node must actually serve a billed request. The $10 simulated opening credit is not earned income. |

A user can revoke only their own **self-service** credential in
[/provide](https://alpha.inferenceex.com/provide). Revocation disconnects
matching sessions; it does not erase transactions or rotate an old
operator-issued credential.

## Independent Mac acceptance checklist (not yet complete)

Before the operator enables provider enrollment broadly or calls this
a **tested** installation recipe, record:

- [ ] A GitHub user different from the coordinator owner enrolls on an
      independently operated Apple Silicon Mac without admin API calls
      or founder shell access.
- [ ] Exact macOS/chip/RAM, Python, Homebrew `llama-server` version/build,
      IE commit, GGUF filename/quantization and SHA-256.
- [ ] Homebrew install, model download/checksum, Python install, first
      agent launch and offline/recovery paths run without guesswork.
- [ ] Agent authenticates with the WSS Authorization header; provider
      identity and L0/Open hardware claims are not treated as attested.
- [ ] A real prompt completes; integer micro-USD consumer debit equals
      provider earnings plus platform fee.
- [ ] A different account cannot view nodes, credentials or earnings.
- [ ] Duplicate enrollment is denied; connected credential revocation
      disconnects the agent and reconnect is denied.
- [ ] The existing independently running M6 provider's credential, node,
      billing principal, historical transactions and launchd service
      stay unchanged.
- [ ] Coordinator restart/rollback rehearsals use isolated or backed-up
      SQLite data; do not test against uncontrolled live production.
- [ ] Onboarding failures, logs with secrets removed, time to first
      successful inference and tester feedback are recorded.

After those checks pass, replace this **experimental preview** with a
tested, versioned installation recipe. Until then, do not claim the
external-provider path is production-ready.

For the older administrator-issued/local-LAN development flow, see
[Getting started](getting-started.md). That guide is not the supported
internet-facing self-service alpha setup.
