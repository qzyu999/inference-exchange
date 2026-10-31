// #199 — guided entry points; actions stay in the existing product pages.
// No credentials, prompts, user notes, or account data belong in these definitions.
export const JOURNEYS = [
  {
    id: 'consumer',
    name: 'Use AI',
    summary: 'Ask a model a question in Chat. No code required.',
    audience: 'Consumer',
    steps: [
      { id: 'sign-in', title: 'Sign in to your IE account',
        description: 'Use your GitHub-linked IE account. Account registration is intended to be self-service; it may be temporarily paused during private alpha.',
        expected: 'You see your own account in the sidebar. New-account registration may be temporarily unavailable during private alpha.',
        help: 'If private-alpha signup is paused, ask the coordinator when registration will reopen. This is a temporary test restriction, not a required signup window in the intended product.',
        action: 'Open sign-in', to: '/login', check: 'auth' },
      { id: 'find-model', title: 'Check that a model is online',
        description: 'The Models page and Chat use models advertised by the exchange. A listing is not a promise of capacity or uptime.',
        expected: 'At least one model is listed as online. If none is present, wait for a provider to connect.',
        help: 'No online models means there is no eligible provider for that model. Refresh later; do not select an offline catalog reference.',
        action: 'Explore models', to: '/models', check: 'models' },
      { id: 'chat', title: 'Send a nonsensitive message',
        description: 'Open Chat, choose an available model, and explicitly select L0/Open if you accept that the coordinator and provider can read your prompt and response. Chat defaults to stricter trust.',
        expected: 'A real model response appears. A timeout, offline model, or trust mismatch is not a completed request.',
        help: 'Check the selected model and the trust setting in Chat. L0/Open is not confidential. If the model is offline or the network is unavailable, stop and report the failure.',
        action: 'Open Chat', to: '/chat', check: 'models' },
      { id: 'billing', title: 'Review your usage',
        description: 'The Billing page shows account usage and simulated alpha credits. These credits are not real money.',
        expected: 'If the request was billed, your own transaction appears. An empty history is not proof of an error if no request completed.',
        help: 'If a completed request is missing or billed incorrectly, report the request ID only, not the prompt or API credential.',
        action: 'View my billing', to: '/billing', check: 'auth' },
    ],
  },
  {
    id: 'api',
    name: 'Use the API',
    summary: 'Call the exchange using the official OpenAI Python SDK.',
    audience: 'Consumer · developer',
    steps: [
      { id: 'sign-in', title: 'Sign in before creating a key',
        description: 'API keys belong to one signed-in IE account. Creating keys is self-service; private-alpha signup restrictions may temporarily prevent new accounts from joining.',
        expected: 'You are signed in to your own account.',
        help: 'If private-alpha signup is paused, wait until registration reopens. Never share another user’s key.',
        action: 'Open sign-in', to: '/login', check: 'auth' },
      { id: 'create-key', title: 'Create and securely save an API key',
        description: 'Use the existing API keys page. The sk-ie- secret is shown once. Keep it in your private terminal or secret manager.',
        expected: 'Your account lists a key. The one-time secret was copied securely; existing key metadata cannot reveal it again.',
        help: 'If creation fails, check your signed-in session. Never put a key in a screenshot, code repository, URL, or issue.',
        action: 'Open API keys', to: '/keys', check: 'keys' },
      { id: 'install', title: 'Prepare the Python SDK',
        description: 'Choose your operating system below. No IE repository checkout is needed. Copy the Python code from the existing API keys page and save it as hello_ie.py.',
        expected: 'Your virtual environment has openai installed and hello_ie.py contains the copyable, nonsecret SDK example.',
        help: 'If py is unavailable on Windows, install Python and enable the Python launcher. If pip fails, verify your virtual environment. Never place your API key in source code.',
        action: 'Get Python SDK example', to: '/keys', check: 'models', platform: true },
      { id: 'run-and-revoke', title: 'Send a request, try streaming, then revoke',
        description: 'The API keys page supplies both nonstreaming and streaming examples. They discover an advertised model, use the alpha /v1 base URL, and explicitly allow L0/Open with ocip_min_confidence=open.',
        expected: 'A real response arrives. After you revoke your test key under API keys, reuse must fail with HTTP 401.',
        help: 'A 401 means a missing/revoked key or expired authorization. A model or trust error means no matching live supply. Do not paste raw responses containing private data into GitHub.',
        action: 'Open SDK examples and key controls', to: '/keys', check: 'keys' },
    ],
  },
  {
    id: 'provider',
    name: 'Provide compute',
    summary: 'Connect an Apple Silicon Mac to offer local inference.',
    audience: 'Provider · experimental',
    steps: [
      { id: 'hardware', title: 'Check your Mac first',
        description: 'The current preview is for Apple Silicon/macOS, a GGUF model, Python, and a Metal-capable llama-server. The installation recipe is experimental, not independently qualified.',
        expected: 'uname -m reports arm64. Record macOS, chip, RAM, disk, Python version and whether llama-server is installed.',
        help: 'Intel/Windows/Linux or an unavailable Metal backend is outside this first-provider recipe. Missing prerequisites must be fixed before attempting enrollment.',
        action: 'Read experimental Mac guide', to: 'https://github.com/qzyu999/inference-exchange/blob/main/docs/guides/provider-l0-apple-silicon-preview.md' },
      { id: 'sign-in', title: 'Use your own GitHub identity',
        description: 'Your provider node belongs to your IE account. Signup and node enrollment are intended to be self-service; private-alpha availability restrictions are temporary, not a scheduled-window product requirement.',
        expected: 'You can sign in to your own IE account. New-account signup or provider enrollment may be temporarily unavailable during private alpha.',
        help: 'If signup is temporarily paused, contact the alpha coordinator. Never bypass a global gate or use an administrator token.',
        action: 'Open sign-in', to: '/login', check: 'auth' },
      { id: 'enroll', title: 'Enroll your provider node',
        description: 'Use /provide to enroll your own node and receive a one-time pt-ie- credential. Enrollment is intended to be available on demand; the current private alpha may temporarily restrict it during testing. Do not create or rotate credentials merely to advance this guide.',
        expected: 'When enrollment is available, /provide issues an owner-bound node and shows its credential once. HTTP 503 means enrollment is currently unavailable.',
        help: 'If private-alpha enrollment is paused, stop and ask when it will reopen. A revoked token cannot be reused. Never paste a pt-ie- token in a URL, terminal argument or issue.',
        action: 'Review provider enrollment preview', to: '/provide', check: 'nodes', gate: true },
      { id: 'connect', title: 'Start the local agent using the preview guide',
        description: 'Follow the versioned experimental GGUF/Metal recipe. The agent makes an outbound authenticated wss:// connection; your Mac needs no public inbound inference port.',
        expected: 'After a real connection, your owned node is online and advertises its model in the dashboard. This step is not verified by visiting the guide.',
        help: 'Check the local model path, llama-server health, outbound WebSocket, and credential status. Do not share a credential or raw log.',
        action: 'Read experimental connection guide', to: 'https://github.com/qzyu999/inference-exchange/blob/main/docs/guides/provider-l0-apple-silicon-preview.md', check: 'nodes' },
      { id: 'observe', title: 'Verify your own node status',
        description: 'The dashboard reads authenticated owner-scoped node status, online models, and simulated earnings. Offline and zero earnings are valid states.',
        expected: 'Your own node is online and its advertised model is visible. This does not mean you have served a request.',
        help: 'If offline, inspect your local agent and the guide. If someone else’s node or earnings appear, stop and report an account-isolation defect.',
        action: 'Open private provider dashboard', to: '/dashboard', check: 'nodes' },
      { id: 'serve', title: 'Qualify a real routed request',
        description: 'A separate consumer can request your model if routing selects your node. Requests are not guaranteed to route to any particular provider. Earnings are simulated only.',
        expected: 'Your owner dashboard shows a served request and ledger-reconciled simulated earnings after a successful routed transaction.',
        help: 'No earnings can simply mean no request matched. A ledger mismatch is a stop condition. Record a sanitized request ID, not the prompt, response or token.',
        action: 'Inspect simulated earnings', to: '/dashboard', check: 'earnings' },
    ],
  },
  {
    id: 'both',
    name: 'Do both',
    summary: 'Use models and provide compute with the same IE account.',
    audience: 'Consumer + provider',
    steps: [
      { id: 'account', title: 'Use one GitHub-linked IE account',
        description: 'One identity can consume inference and own provider nodes. The roles remain separate in the transaction ledger.',
        expected: 'You see your own IE account after sign-in.',
        help: 'Do not create duplicate accounts or share a provider credential with a consumer tester.',
        action: 'Open sign-in', to: '/login', check: 'auth' },
      { id: 'consume', title: 'Complete a consumer request',
        description: 'Follow the Use AI journey: choose a live model and explicitly allow L0/Open for nonsensitive prompts.',
        expected: 'A real response is shown in Chat and your own billing history reflects successful charged requests.',
        help: 'A request can go to any eligible provider, not necessarily your Mac. Check model availability and trust before retrying.',
        action: 'Open consumer guide', to: '/start/consumer', check: 'models' },
      { id: 'provide', title: 'Connect your Mac separately',
        description: 'Follow the provider guide to enroll and connect your node. The intended product is self-service; temporary private-alpha restrictions and experimental hardware qualification still apply.',
        expected: 'Only after an actual connection does your owned node appear online.',
        help: 'If provider enrollment is temporarily unavailable during private alpha, stop and wait for it to reopen. Follow the Mac guide and /provide, not an admin route.',
        action: 'Open provider guide', to: '/start/provider', check: 'nodes', gate: true },
      { id: 'compare', title: 'Inspect both sides of the exchange',
        description: 'A consumer debit for an actual transaction equals provider earnings plus the platform fee. Your own request may have been routed to a different provider.',
        expected: 'Billing shows your consumer transactions; the provider dashboard shows only earnings from requests actually served by your node.',
        help: 'Do not assume zero earnings is a bug. Check the matched provider and account ownership. A real ledger imbalance is a stop condition.',
        action: 'Open provider dashboard', to: '/dashboard', check: 'earnings' },
    ],
  },
]

export const GLOSSARY = [
  ['Consumer', 'A person or application requesting AI inference and spending simulated alpha credits.'],
  ['Provider / node', 'An operator offering a computer and a locally served AI model to the exchange.'],
  ['Model', 'The AI system used to generate a response. It must have an online provider to run.'],
  ['OCIP agent', 'The program connecting a provider’s model server to IE via an outbound authenticated connection.'],
  ['Matching / routing', 'The exchange selects an eligible provider for a request. It does not guarantee your own node.'],
  ['L0 / Open', 'The coordinator and provider may read plaintext prompts and responses. Not confidential or attested.'],
  ['API key', 'A one-time-displayed sk-ie- secret used to authenticate SDK requests for your account.'],
  ['Simulated credits', 'Nonredeemable test balances and earnings; there are no real charges or payouts.'],
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

export function progressStorageKey(userId) {
  return 'ie-getting-started-v1-' + (userId || 'guest')
}

export function completedSteps(journey, confirmations) {
  return journey.steps.filter(step => confirmations[journey.id + '/' + step.id] === true).length
}
