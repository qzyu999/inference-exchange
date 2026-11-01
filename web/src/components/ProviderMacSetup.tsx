import { useState } from 'react'
import { Link } from 'react-router-dom'
import { C } from '../lib/theme'

// This is an experimental recipe, not a claim of independent-Mac qualification.
// These nonsecret commands can be copied without exposing a provider credential.
// The artifact hash comes from the linked Hugging Face GGUF file page.
const MODEL_SHA256 = '6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653'
const MODEL_FILENAME = 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf'
const MODEL_URL = 'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf'
const RECIPE_COMMIT = '482f3332ee4f9c232c418f5e8d02dc45d09f4059'

const CHECK_MAC = [
  'uname -m',
  'sw_vers -productVersion',
  'python3 --version',
  'git --version',
].join('\n')

const INSTALL_LLAMA = [
  'brew install llama.cpp',
  'command -v llama-server',
  'llama-server --version',
].join('\n')

const DOWNLOAD_MODEL = [
  'MODEL_FILE="$HOME/.inference-exchange/models/' + MODEL_FILENAME + '"',
  'mkdir -p "$HOME/.inference-exchange/models"',
  'if [ -f "$MODEL_FILE" ]; then',
  '  echo "Model already present. Checking its SHA-256."',
  'else',
  '  curl --fail --location --retry 3 \\',
  '    --output "$MODEL_FILE.partial" \\',
  '    "' + MODEL_URL + '" &&',
  '  printf "%s  %s\\n" "' + MODEL_SHA256 + '" "$MODEL_FILE.partial" | shasum -a 256 -c - &&',
  '  mv -n "$MODEL_FILE.partial" "$MODEL_FILE"',
  'fi',
  'printf "%s  %s\\n" "' + MODEL_SHA256 + '" "$MODEL_FILE" | shasum -a 256 -c -',
].join('\n')

const INSTALL_AGENT = [
  'git clone https://github.com/qzyu999/inference-exchange.git',
  'cd inference-exchange',
  'git checkout --detach ' + RECIPE_COMMIT,
  'make setup-py',
  'source .venv/bin/activate',
].join('\n')

const CONNECT_AGENT = [
  'export IE_MODEL_PATH="$HOME/.inference-exchange/models/' + MODEL_FILENAME + '"',
  'test -f "$IE_MODEL_PATH" && command -v llama-server',
  'export IE_PROVIDER_TOKEN="$(python3 -c \'from getpass import getpass; print(getpass("Provider credential: "))\')"',
  'python -m ocip_agent.agent \\',
  '  --coordinator wss://alpha.inferenceex.com/ws/provider \\',
  '  --model "$IE_MODEL_PATH" \\',
  '  --llama-server "$(command -v llama-server)" \\',
  '  --name "my-mac-mini" --trust open --max-concurrent 1',
  'unset IE_PROVIDER_TOKEN  # Run this after the agent stops',
].join('\n')

function Command({ title, code }: { title: string; code: string }) {
  const [status, setStatus] = useState('')

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setStatus('Commands copied. They contain no credentials.')
    } catch {
      setStatus('Clipboard unavailable. Select the commands to copy them.')
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50">
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        <button type="button" onClick={() => void copy()}
          className="text-xs underline font-medium" style={{ color: C.blueBlack }}
          aria-label={'Copy ' + title + ' commands'}>Copy commands</button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-gray-800 bg-gray-50/40 whitespace-pre">
        <code>{code}</code>
      </pre>
      {status && <p role="status" className="px-3 py-2 text-xs text-gray-600">{status}</p>}
    </div>
  )
}

export function ProviderMacSetup() {
  return (
    <section className="bg-white rounded-2xl border border-gray-200/60 p-6 space-y-5" aria-label="Experimental Mac provider installation">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold" style={{ color: C.blueBlack }}>3. Set up and connect your Mac</h3>
        <p className="text-sm text-gray-600">
          These are copy-ready <strong>experimental</strong> steps for Apple Silicon and L0/Open.
          A new independent Mac has not yet qualified this full recipe. Self-service enrollment
          may still be disabled. You can prepare your Mac without creating a credential.
        </p>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold" style={{ color: C.blueBlack }}>A. Check compatibility</h4>
        <p className="text-sm text-gray-600">
          Open Terminal on your provider Mac. Confirm <code>arm64</code>, Python 3.11+ and Git.
          Check available RAM and disk space before choosing a larger model.
        </p>
        <Command title="Mac prerequisites" code={CHECK_MAC} />
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold" style={{ color: C.blueBlack }}>B. Install llama-server</h4>
        <p className="text-sm text-gray-600">
          Install <a href="https://formulae.brew.sh/formula/llama.cpp" target="_blank" rel="noopener noreferrer" className="underline">llama.cpp through Homebrew</a>.
          If <code>brew</code> is missing, install Homebrew from <a href="https://brew.sh/" target="_blank" rel="noopener noreferrer" className="underline">its official website</a> first.
          Do not start <code>llama-server</code> yourself: the OCIP agent starts and stops it on <code>127.0.0.1</code>.
        </p>
        <Command title="Install and verify llama-server" code={INSTALL_LLAMA} />
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold" style={{ color: C.blueBlack }}>C. Download a small test model</h4>
        <p className="text-sm text-gray-600">
          Start with <a href="https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF" target="_blank" rel="noopener noreferrer" className="underline">Qwen2.5 0.5B Instruct, Q4_K_M GGUF</a> (about 400 MB).
          The commands download one model file to <code>~/.inference-exchange/models/</code> and check its
          published SHA-256 before use. The check must print <code>OK</code>. A mismatch means stop and inspect the download.
          No API key or Hugging Face login is required for this public file.
        </p>
        <Command title="Download and verify Qwen GGUF" code={DOWNLOAD_MODEL} />
        <p className="text-xs text-gray-600">
          Why GGUF? The current OCIP agent manages native <code>llama-server</code>, which loads GGUF weights.
          A <code>.safetensors</code> file or an Ollama model name cannot be passed directly as <code>--model</code>.
          Other runtimes may be added later; they are not part of this Apple Silicon L0 recipe.
        </p>
        <details className="rounded-lg border border-gray-200 p-3 text-sm text-gray-600">
          <summary className="cursor-pointer font-medium" style={{ color: C.blueBlack }}>Use a different GGUF model</summary>
          <p className="mt-2">
            Choose an instruct/chat GGUF compatible with your installed llama.cpp build.
            Read its model card and license. Check RAM, disk and context memory; the GGUF file size
            is not the full runtime memory requirement. Download the exact file, record its source
            and SHA-256, then replace the <code>--model</code> path in step E.
            A model that starts locally is not automatically an admitted or tested IE model.
          </p>
          <a href="https://github.com/ggml-org/llama.cpp/blob/master/docs/models.md"
            target="_blank" rel="noopener noreferrer" className="underline">llama.cpp model-format and conversion guide</a>
        </details>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold" style={{ color: C.blueBlack }}>D. Install the OCIP agent</h4>
        <p className="text-sm text-gray-600">
          Run this in Terminal after installing Git and Python. The checkout is a code-reviewed
          candidate revision, not a qualified Mac build. Python dependencies may compile on first
          install; this step is not yet a lightweight signed installer.
        </p>
        <Command title="Install the IE Python agent" code={INSTALL_AGENT} />
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold" style={{ color: C.blueBlack }}>E. Enroll, connect, and verify</h4>
        <p className="text-sm text-gray-600">
          After self-service enrollment is enabled, save your one-time provider credential from
          step 2. Keep the Python virtual environment active. The command prompts for your token
          without showing what you type; do not put the token in a URL, CLI argument or screenshot.
          The agent opens an outbound encrypted WebSocket. It does not expose a public local port.
        </p>
        <Command title="Start the OCIP agent (token entered at hidden prompt)" code={CONNECT_AGENT} />
        <p className="text-sm text-gray-600">
          While the agent is running, open your <Link to="/dashboard" className="underline">private provider dashboard</Link>.
          Confirm the node and advertised model are actually online. Complete one nonsensitive
          consumer request and verify the owner-only <strong>simulated</strong> earnings. An online
          node alone does not prove successful inference or correct billing.
          Stop the foreground agent with <code>Ctrl+C</code> and run <code>unset IE_PROVIDER_TOKEN</code>.
        </p>
      </div>

      <details className="rounded-lg border border-gray-200 p-3 text-sm text-gray-600">
        <summary className="cursor-pointer font-medium" style={{ color: C.blueBlack }}>Troubleshooting and safety</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li><code>brew: command not found</code>: install Homebrew and follow its PATH instructions.</li>
          <li><code>llama-server</code> not found: verify Homebrew installation and your shell PATH.</li>
          <li>Download fails or SHA-256 differs: do not run that file; check the model page and try again.</li>
          <li>Python dependency build fails: record macOS, chip, Python version and the nonsecret error for the onboarding issue.</li>
          <li>HTTP 503 during enrollment: the global self-service gate is still closed; do not use an admin token.</li>
          <li>Offline or no matches: inspect agent status, the model path, network access, and the consumer's explicit L0/Open choice.</li>
          <li>Never expose the local llama-server port to the internet or claim L2/L3 or real payouts.</li>
        </ul>
        <p className="mt-2">
          <a href="https://github.com/qzyu999/inference-exchange/blob/main/docs/guides/provider-l0-apple-silicon-preview.md"
            target="_blank" rel="noopener noreferrer" className="underline">Detailed setup, SHA-256 and acceptance checklist</a>
        </p>
      </details>
    </section>
  )
}
