// One learning journey and two setup paths. Credentials stay in the existing product pages.
export const JOURNEYS = [
{
  "id": "ocip",
  "name": "Understand the Open Confidential Inference Protocol (OCIP)",
  "summary": "Learn the security levels, one short step at a time.",
  "audience": "Start here · No setup needed",
  "steps": [
    {
      "id": "protocol",
      "title": "A shared rulebook.",
      "description": "OCIP defines how your app, the exchange, and a provider communicate.",
      "takeaway": "One protocol connects different machines.",
      "help": "OCIP is a protocol. Inference Exchange is one implementation. It handles model discovery, routing, and billing.",
      "label": "The protocol",
      "reference": "https://github.com/qzyu999/ocip/blob/main/spec/01-overview.md",
      "expected": "One protocol connects different machines."
    },
    {
      "id": "open",
      "title": "Open means your message can be read.",
      "description": "The coordinator and provider can read your message and response.",
      "takeaway": "Use nonsensitive messages with Open.",
      "help": "An encrypted connection protects data in transit. It does not stop the machines processing your request from reading it.",
      "label": "L0 · Open",
      "reference": "https://github.com/qzyu999/ocip/blob/main/spec/02-confidence-levels.md",
      "expected": "Use nonsensitive messages with Open."
    },
    {
      "id": "contained",
      "title": "Contained adds a sandbox.",
      "description": "A container or sandbox separates the inference software. The host administrator can still access its data.",
      "takeaway": "A sandbox is not protection from the host owner.",
      "help": "Containers help isolate software. They do not make the machine owner unable to inspect prompts or memory.",
      "label": "L1 · Contained",
      "reference": "https://github.com/qzyu999/ocip/blob/main/spec/02-confidence-levels.md",
      "expected": "A sandbox is not protection from the host owner."
    },
    {
      "id": "hardened",
      "title": "Hardened adds stronger isolation.",
      "description": "Operating-system or virtual-machine protections aim to restrict access to inference memory.",
      "takeaway": "The exact setup and evidence matter.",
      "help": "Hardening is not one universal guarantee. Read the threat model for the actual platform and configuration.",
      "label": "L2 · Hardened",
      "reference": "https://github.com/qzyu999/ocip/blob/main/spec/02-confidence-levels.md",
      "expected": "The exact setup and evidence matter."
    },
    {
      "id": "confidential",
      "title": "Confidential protects CPU memory.",
      "description": "This level calls for hardware-backed protection of CPU memory. Accelerator memory needs separate protection.",
      "takeaway": "Protecting the CPU does not automatically protect the GPU.",
      "help": "A trusted execution environment has a specific threat model. Transport encryption alone does not meet this level.",
      "label": "L3 · Confidential",
      "reference": "https://github.com/qzyu999/ocip/blob/main/spec/02-confidence-levels.md",
      "expected": "Protecting the CPU does not automatically protect the GPU."
    },
    {
      "id": "fully-confidential",
      "title": "Cover the whole inference path.",
      "description": "The highest level calls for protected CPU and accelerator memory, with evidence covering both.",
      "takeaway": "Check every part of the path.",
      "help": "These are protocol requirements, not a claim that this alpha offers verified hardware confidentiality. Timing and traffic volume can still be visible.",
      "label": "L4 · Fully confidential",
      "reference": "https://github.com/qzyu999/ocip/blob/main/spec/02-confidence-levels.md",
      "expected": "Check every part of the path."
    },
    {
      "id": "evidence",
      "title": "Claimed is not verified.",
      "description": "A provider can claim a level. Verification needs evidence for the actual hardware and configuration.",
      "takeaway": "A label alone is not proof.",
      "help": "Look for verified evidence and its limits. Being online, owning an Apple Silicon Mac, or reporting a level does not establish confidentiality.",
      "label": "Check the evidence",
      "reference": "/docs/security/threat-model",
      "expected": "A label alone is not proof."
    },
    {
      "id": "minimum",
      "title": "You choose your minimum.",
      "description": "IE routes to a matching provider or rejects the request. It must not silently lower your requirement.",
      "takeaway": "No match means your requirement stays in place.",
      "help": "A no-compatible-provider outcome can mean no provider meets your minimum. Lower it only if you accept the weaker protection.",
      "label": "Your choice",
      "reference": "/docs/requirements/routing",
      "expected": "No match means your requirement stays in place."
    },
    {
      "id": "alpha",
      "title": "Know what you are testing.",
      "description": "The Apple Silicon preview uses Open inference. Start with a nonsensitive test message.",
      "takeaway": "The protocol describes more than this preview provides.",
      "help": "The API setup asks for explicit consent before showing an Open example. Treat protocol levels and available verified protection as separate things.",
      "label": "The alpha today",
      "reference": "/docs/guides/provider-l0-apple-silicon-preview",
      "expected": "The protocol describes more than this preview provides."
    }
  ]
},
  {
    "id": "api",
    "name": "Use the API",
    "summary": "Get an API key and make your first request.",
    "audience": "For developers",
    "steps": [
      {
        "id": "sign-in",
        "title": "Sign in",
        "description": "Use your GitHub account to get started.",
        "action": "Sign in",
        "to": "/login",
        "check": "auth",
        "help": "New registrations may be paused during the private alpha. If sign-in is unavailable, try again later.",
        "expected": "Use your GitHub account to get started."
      },
      {
        "id": "create-key",
        "title": "Create an API key",
        "description": "Give your key a name, then save it somewhere private. You will only see it once.",
        "action": "Create API key",
        "to": "/keys",
        "check": "keys",
        "help": "Already have a key saved? Use that one. If you lost it, create a new key and revoke the old one. Never share keys in screenshots or issues.",
        "expected": "Give your key a name, then save it somewhere private. You will only see it once."
      },
      {
        "id": "install",
        "title": "Set up Python",
        "description": "Open a terminal and run these commands. You need Python 3.11 or later.",
        "command": "sdk",
        "help": "On Windows, use Command Prompt. If Python is missing, install it from python.org. Run each command in order.",
        "expected": "Open a terminal and run these commands. You need Python 3.11 or later."
      },
      {
        "id": "find-model",
        "title": "Choose a model",
        "description": "Choose one of the models currently available on the exchange.",
        "check": "models",
        "help": "No models listed? A provider needs to come online. Try again later. Availability can change before you send a request.",
        "expected": "Choose one of the models currently available on the exchange."
      },
      {
        "id": "request",
        "title": "Send your first request",
        "description": "Use a simple test message to check your connection.",
        "command": "request",
        "help": "401: check your key. No compatible provider: check model availability and trust. Keep your key and private prompts out of bug reports.",
        "expected": "Use a simple test message to check your connection."
      }
    ]
  },
  {
    "id": "provider",
    "name": "Provide compute",
    "summary": "Connect your Mac to serve AI models.",
    "audience": "Apple Silicon preview",
    "steps": [
      {
        "id": "hardware",
        "title": "Check your Mac",
        "description": "This preview supports Apple Silicon Macs. Open Terminal on the Mac you want to connect.",
        "command": "hardware",
        "help": "The first command must show arm64. You also need Python 3.11 or later, Git, and space for the model. Intel Macs, Windows, and Linux are outside this preview.",
        "expected": "This preview supports Apple Silicon Macs. Open Terminal on the Mac you want to connect."
      },
      {
        "id": "sign-in",
        "title": "Sign in",
        "description": "Use the account that will own this provider.",
        "action": "Sign in",
        "to": "/login",
        "check": "auth",
        "help": "One account can use the API and provide compute. You do not need a second account.",
        "expected": "Use the account that will own this provider."
      },
      {
        "id": "server",
        "title": "Install the model server",
        "description": "Run this in Terminal. It installs llama.cpp using Homebrew.",
        "command": "server",
        "help": "If brew is missing, install Homebrew from brew.sh and follow its PATH instructions. The final command should print a llama-server version.",
        "expected": "Run this in Terminal. It installs llama.cpp using Homebrew."
      },
      {
        "id": "model",
        "title": "Download a model",
        "description": "Start with Qwen2.5 0.5B Instruct, a small test model. The download is about 398 MB.",
        "command": "model",
        "help": "Wait for the checksum to say OK. If it fails, do not use the file. Larger models need more memory than this first test.",
        "expected": "Start with Qwen2.5 0.5B Instruct, a small test model. The download is about 398 MB."
      },
      {
        "id": "agent",
        "title": "Install the provider",
        "description": "Run these commands in the same Terminal. They install the preview version of the provider.",
        "command": "agent",
        "help": "Use a new checkout; do not replace an existing provider. Installation may need developer tools or compile Python dependencies. This preview has not been independently qualified on a new Mac.",
        "expected": "Run these commands in the same Terminal. They install the preview version of the provider."
      },
      {
        "id": "enroll",
        "title": "Connect your account",
        "description": "Register your Mac and save its provider credential. This is separate from an API key.",
        "action": "Register your Mac",
        "to": "/provide",
        "gate": true,
        "help": "Enrollment may be paused in the private alpha. A 503 means it is unavailable; do not bypass it. If you already registered this Mac, use its existing credential.",
        "expected": "Register your Mac and save its provider credential. This is separate from an API key."
      },
      {
        "id": "connect",
        "title": "Start providing",
        "description": "Run this in the same Terminal. Paste your provider credential when prompted; it will stay hidden.",
        "command": "connect",
        "help": "The agent starts the model server for you. Keep Terminal open. Stop it with Ctrl+C, then run unset IE_PROVIDER_TOKEN. Do not put the credential in command arguments or URLs.",
        "expected": "Run this in the same Terminal. Paste your provider credential when prompted; it will stay hidden."
      },
      {
        "id": "verify",
        "title": "Check your connection",
        "description": "Your Mac should appear online with its model listed.",
        "action": "Open provider dashboard",
        "to": "/dashboard",
        "check": "nodes",
        "help": "Offline? Check that the agent is still running and the model downloaded correctly. Online means connected; earnings require a request to be routed to your Mac. Alpha earnings are simulated.",
        "expected": "Your Mac should appear online with its model listed."
      }
    ]
  }
]

export function feedbackHref(journey, step) {
  // Build only from authored, nonsecret text. User notes are entered in GitHub
  // after navigating, never transported through IE or a prefilled GET URL.
  const title = 'Getting Started: ' + journey.name + ' / ' + step.title
  const body = [
    '### Getting Started step feedback',
    '- Journey: ' + journey.id,
    '- Step ID: ' + step.id,
    '- Expected result: ' + step.expected,
    '',
    '### What actually happened?',
    '<Describe the problem using nonsensitive information.>',
    '',
    '### How could we improve this step?',
    '<Optional feedback.>',
    '',
    'Do not share API keys, provider tokens, auth headers, private prompts, cookies, personal data, or full logs.',
  ].join('\n')
  return 'https://github.com/qzyu999/inference-exchange/issues/new?title=' +
    encodeURIComponent(title) + '&body=' + encodeURIComponent(body)
}


export function resolveStartJourney(id) {
  if (id === 'consumer') return 'api'
  if (id === 'both') return ''
  return id
}
export function sdkExample(model) {
  return `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["IE_API_KEY"],
    base_url="https://alpha.inferenceex.com/v1",
)
response = client.chat.completions.create(
    model=${JSON.stringify(model)},
    messages=[{"role": "user", "content": "Say hello."}],
    extra_body={"ocip_min_confidence": "open"},
)
print(response.choices[0].message.content)
`
}
