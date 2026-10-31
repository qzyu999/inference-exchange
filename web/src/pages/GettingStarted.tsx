import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { loginHref } from '../lib/nav.js'
import { C } from '../lib/theme'
import {
  JOURNEYS, GLOSSARY, completedSteps, feedbackHref, progressStorageKey,
  type StartJourney, type StartStep,
} from '../lib/getting-started.js'

type Platform = 'windows' | 'mac' | 'linux'
const SDK_COMMANDS: Record<Platform, string> = {
  windows: [
    'py -m venv .venv',
    '.venv\\Scripts\\activate.bat',
    'python -m pip install openai',
    'set /p IE_API_KEY=Paste your API key (visible input): ',
    'python hello_ie.py',
  ].join('\n'),
  mac: [
    'python3 -m venv .venv',
    'source .venv/bin/activate',
    'python -m pip install openai',
    'read -rs IE_API_KEY',
    'export IE_API_KEY',
    'python hello_ie.py',
  ].join('\n'),
  linux: [
    'python3 -m venv .venv',
    'source .venv/bin/activate',
    'python -m pip install openai',
    'read -rs IE_API_KEY',
    'export IE_API_KEY',
    'python hello_ie.py',
  ].join('\n'),
}
const MAC_CHECKS = 'uname -m\nsw_vers\npython3 --version\ncommand -v llama-server'

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600'
const panel = 'bg-white rounded-2xl border border-gray-200/60'

function JourneyLanding() {
  return (
    <div className="max-w-5xl space-y-7">
      <section className={panel + ' p-6 md:p-8 space-y-3'}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.gold }}>Private alpha · start here</p>
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: C.blueBlack }}>
          What would you like to do?
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed max-w-2xl">
          Use AI, build with the API, connect your own Mac, or do both.
          Each guide takes you through a few real actions. You can resume later.
        </p>
        <p className="text-xs text-gray-500">
          This is an experimental exchange. Credits are simulated and cannot be redeemed.
          L0/Open inference is not confidential. Provider installation has not yet passed independent-Mac qualification.
        </p>
      </section>
      <div className="grid sm:grid-cols-2 gap-4" aria-label="Choose a Getting Started journey">
        {JOURNEYS.map((journey, index) => (
          <Link key={journey.id} to={'/start/' + journey.id}
            className={panel + ' group p-5 md:p-6 transition-shadow hover:shadow-md ' + focus}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: C.gold }}>
                {journey.audience}
              </span>
              <span className="text-xs text-gray-400">0{index + 1}</span>
            </div>
            <h3 className="text-xl font-semibold mt-4 group-hover:underline" style={{ color: C.blueBlack }}>
              {journey.name}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">{journey.summary}</p>
            <p className="mt-5 text-xs font-semibold" style={{ color: C.deepBlue }}>
              {journey.steps.length} guided steps · Open guide →
            </p>
          </Link>
        ))}
      </div>
      <details className={panel + ' p-5 md:p-6'}>
        <summary className="cursor-pointer text-sm font-semibold" style={{ color: C.blueBlack }}>
          New to IE? A few useful definitions
        </summary>
        <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-4 mt-5">
          {GLOSSARY.map(([term, meaning]) => (
            <div key={term}>
              <dt className="text-sm font-semibold" style={{ color: C.blueBlack }}>{term}</dt>
              <dd className="text-xs text-gray-600 mt-1 leading-relaxed">{meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="text-sm text-gray-600">
        Looking for technical reference material? <Link className="underline" style={{ color: C.deepBlue }} to="/docs">Go to Docs</Link>.
      </p>
    </div>
  )
}

function StepAction({ journey, step }: { journey: StartJourney; step: StartStep }) {
  const isLogin = step.to === '/login'
  const href = isLogin ? loginHref('/start/' + journey.id + '?step=' + step.id) : step.to
  const classes = 'inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-semibold ' + focus
  const style = { color: '#fff', background: C.blueBlack }
  if (/^https:\/\//.test(href)) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={classes} style={style}>{step.action} ↗</a>
  }
  return <Link to={href} className={classes} style={style}>{step.action} →</Link>
}

export function GettingStarted() {
  const { journey: requestedJourney } = useParams()
  const [query] = useSearchParams()
  const { user, loading: authLoading } = useAuth()
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({})
  const [loadedScope, setLoadedScope] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [platform, setPlatform] = useState<Platform>('windows')
  const [copyMessage, setCopyMessage] = useState('')

  const journey = JOURNEYS.find(item => item.id === requestedJourney)
  const requestedStep = query.get('step')
  const matchingIndex = journey?.steps.findIndex(item => item.id === requestedStep) ?? -1
  const stepIndex = matchingIndex >= 0 ? matchingIndex : 0
  const step = journey?.steps[stepIndex]
  const scope = progressStorageKey(user?.user_id)

  useEffect(() => {
    if (authLoading) return
    try {
      const saved = JSON.parse(localStorage.getItem(scope) || '{}')
      setConfirmations(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {})
    } catch {
      setConfirmations({})
    }
    setLoadedScope(scope)
  }, [scope, authLoading])

  useEffect(() => {
    setHelpOpen(false)
    setCopyMessage('')
  }, [requestedJourney, requestedStep])

  // Read-only existing APIs. These checks show the present account/network
  // state, never automatically mark a step as completed.
  const needModels = journey?.id === 'consumer' || journey?.id === 'api' || journey?.id === 'both'
  const needKeys = journey?.id === 'api'
  const needNodes = journey?.id === 'provider' || journey?.id === 'both'
  const { data: models, error: modelError, isLoading: modelLoading } =
    useSWR(needModels ? 'models' : null, api.models, { refreshInterval: 15000 })
  const { data: keys, error: keysError } =
    useSWR(needKeys && user ? ['myKeys', user.user_id] : null, api.myKeys)
  const { data: nodes, error: nodeError } =
    useSWR(needNodes && user ? ['dashboard/provider-nodes', user.user_id] : null, api.ownedProviderNodes)
  const { data: earnings, error: earningsError } =
    useSWR(needNodes && user ? ['dashboard/provider-earnings', user.user_id] : null, api.ownedProviderEarnings)

  if (!journey || !step) {
    return (
      <>
        {requestedJourney && <p role="alert" className="mb-4 text-sm text-red-700">That journey does not exist. Choose a guide below.</p>}
        <JourneyLanding />
      </>
    )
  }

  const visibleConfirmations = loadedScope === scope && !authLoading ? confirmations : {}
  const doneCount = completedSteps(journey, visibleConfirmations)
  const checked = visibleConfirmations[journey.id + '/' + step.id] === true
  const next = journey.steps[stepIndex + 1]
  const previous = journey.steps[stepIndex - 1]

  function confirmStep() {
    if (authLoading || loadedScope !== scope) return
    const updated = { ...visibleConfirmations, [journey!.id + '/' + step!.id]: !checked }
    setConfirmations(updated)
    try { localStorage.setItem(scope, JSON.stringify(updated)) } catch { /* Storage is optional. */ }
  }

  async function copyCommands() {
    try {
      await navigator.clipboard.writeText(SDK_COMMANDS[platform])
      setCopyMessage('Commands copied. They contain no API key.')
    } catch {
      setCopyMessage('Clipboard unavailable. Select and copy the commands manually.')
    }
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <Link to="/start" className={'underline ' + focus} style={{ color: C.deepBlue }}>← All journeys</Link>
        <span className="text-gray-400">/</span>
        <span className="font-semibold" style={{ color: C.blueBlack }}>{journey.name}</span>
      </div>

      <section className={panel + ' p-6 md:p-8 space-y-4'}>
        <div className="flex items-start flex-wrap justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: C.gold }}>{journey.audience}</p>
            <h2 className="text-2xl font-bold mt-1" style={{ color: C.blueBlack }}>{journey.name}</h2>
            <p className="text-sm text-gray-600 mt-1">{journey.summary}</p>
          </div>
          <span className="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600">
            {doneCount} of {journey.steps.length} user-confirmed
          </span>
        </div>
        <div role="progressbar" aria-label="Self-reported journey progress" aria-valuemin={0}
          aria-valuemax={journey.steps.length} aria-valuenow={doneCount}
          className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: (100 * doneCount / journey.steps.length) + '%', background: C.green }} />
        </div>
        <p className="text-xs text-gray-500">
          Progress is saved on this device for the current account. A checkmark means <strong>you confirmed it</strong>,
          not that IE verified a request or installation.
        </p>
        <nav aria-label={journey.name + ' steps'}>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {journey.steps.map((item, i) => (
              <li key={item.id}>
                <Link to={'/start/' + journey.id + '?step=' + item.id}
                  aria-current={i === stepIndex ? 'step' : undefined}
                  className={'flex items-start gap-2 rounded-xl border px-3 py-3 text-xs leading-relaxed ' + focus}
                  style={{
                    borderColor: i === stepIndex ? C.gold : '#e5e7eb',
                    background: i === stepIndex ? '#fcfaf4' : '#fff',
                    color: C.blueBlack,
                  }}>
                  <span aria-hidden="true" className="font-semibold shrink-0" style={{ color: visibleConfirmations[journey.id + '/' + item.id] ? C.green : C.gold }}>
                    {visibleConfirmations[journey.id + '/' + item.id] ? '✓' : String(i + 1).padStart(2, '0')}
                  </span>
                  <span>{item.title}</span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      </section>

      <article className={panel + ' p-6 md:p-8 space-y-5'}>
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: C.gold }}>Step {stepIndex + 1} of {journey.steps.length}</p>
          <h3 className="text-xl md:text-2xl font-semibold mt-1" style={{ color: C.blueBlack }}>{step.title}</h3>
          <p className="text-sm mt-3 leading-relaxed text-gray-600">{step.description}</p>
        </div>

        {step.gate && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>Enrollment is off by default.</strong> This guide cannot verify the live global enrollment switch.
            Do not issue a credential until the coordinator has approved a supervised window.
            A 503 from /provide means enrollment is closed. This is not a live “enabled” indicator.
          </div>
        )}

        {step.id === 'hardware' && journey.id === 'provider' && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-600">Run locally on your own Mac (read-only):</p>
            <pre className="overflow-x-auto rounded-xl p-4 text-xs leading-relaxed" style={{ background: C.blueBlack, color: '#eee' }}>
              <code>{MAC_CHECKS}</code>
            </pre>
            <p className="text-xs text-gray-500">
              Browser pages cannot verify your Mac architecture, RAM, macOS or local tools.
              Collect the output privately; share only nonsensitive compatibility details.
            </p>
          </div>
        )}

        {step.platform && (
          <section className="space-y-3" aria-label="Python SDK setup commands">
            <p className="text-sm font-semibold" style={{ color: C.blueBlack }}>Choose your terminal</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Operating system">
              {([
                ['windows', 'Windows CMD'], ['mac', 'macOS'], ['linux', 'Linux'],
              ] as [Platform, string][]).map(([id, label]) => (
                <button type="button" key={id} aria-pressed={platform === id}
                  onClick={() => { setPlatform(id); setCopyMessage('') }}
                  className={'px-3 py-2 rounded-lg border text-xs ' + focus}
                  style={{ borderColor: platform === id ? C.gold : '#ddd', background: platform === id ? '#fcfaf4' : '#fff' }}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              First save the existing <strong>non-streaming Python example</strong> from API keys as hello_ie.py.
              Paste your own key only when the terminal prompts you; none is included in these commands.
            </p>
            <pre className="overflow-x-auto rounded-xl p-4 text-xs leading-relaxed" style={{ background: C.blueBlack, color: '#eee' }}>
              <code>{SDK_COMMANDS[platform]}</code>
            </pre>
            <button type="button" onClick={() => void copyCommands()}
              className={'px-3 py-2 rounded-lg border text-xs font-semibold ' + focus}>Copy setup commands</button>
            {copyMessage && <p role="status" className="text-xs text-gray-600">{copyMessage}</p>}
            <p className="text-xs text-gray-500">
              {platform === 'windows'
                ? 'CMD set /p shows what you type. Avoid screen sharing and clear the session afterward.'
                : 'The read command accepts the key without echoing it. Do not save it in shell history or a project file.'}
              {' '}The /keys page owns the actual SDK code, including model discovery, base_url and L0/Open trust setting.
            </p>
          </section>
        )}

        {step.check && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2" aria-live="polite">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.deepBlue }}>Read-only live check</p>
            {step.check === 'auth' && (
              <p className="text-sm text-gray-700">
                {authLoading ? 'Checking sign-in…' : user ? 'Signed in: ' + (user.name || user.email) : 'No IE account session. Sign in to continue.'}
              </p>
            )}
            {step.check === 'models' && (
              <p className="text-sm text-gray-700">
                {modelError ? 'Model availability cannot be checked right now.'
                  : modelLoading || !models ? 'Loading online model IDs…'
                  : models.data.length ? 'Advertised online models: ' + models.data.map(model => model.id).join(', ')
                  : 'No models are advertised online right now.'}
              </p>
            )}
            {step.check === 'keys' && (
              <p className="text-sm text-gray-700">
                {!user ? 'Sign in to read your own API key metadata.'
                  : keysError ? 'Your API key status is unavailable.'
                  : !keys ? 'Loading your key metadata…'
                  : 'Your account lists ' + keys.keys.length + ' active key(s). Keys listed do not prove a request succeeded or 401 revocation was tested.'}
              </p>
            )}
            {step.check === 'nodes' && (
              <p className="text-sm text-gray-700">
                {!user ? 'Sign in to check your own provider nodes.'
                  : nodeError ? 'Your node status is unavailable.'
                  : !nodes ? 'Loading your nodes…'
                  : nodes.nodes.filter(node => node.status === 'online').length +
                    ' online owned node(s), ' + nodes.nodes.length + ' total. Account ownership is verified by the backend; hardware is self-reported.'}
              </p>
            )}
            {step.check === 'earnings' && (
              <p className="text-sm text-gray-700">
                {!user ? 'Sign in to read your own provider earnings.'
                  : earningsError ? 'Earnings data cannot be checked right now.'
                  : !earnings ? 'Loading your owner-scoped earnings…'
                  : 'Your nodes have served ' + earnings.summary.requests_served +
                    ' recorded request(s). Ledger check: ' +
                    (earnings.summary.reconciled ? 'matched' : 'needs investigation') +
                    '. This does not prove a request was served during this guide.'}
              </p>
            )}
            <p className="text-xs text-gray-500">Live observations are not step completion. Use the action below and confirm only after seeing the expected result.</p>
          </div>
        )}

        <div className="rounded-xl border border-gray-100 p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.deepBlue }}>Expected result</p>
          <p className="text-sm text-gray-700">{step.expected}</p>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <StepAction journey={journey} step={step} />
          <button type="button" aria-pressed={checked} onClick={confirmStep} disabled={authLoading || loadedScope !== scope}
            className={'px-4 py-2.5 rounded-xl border text-sm font-semibold disabled:opacity-50 ' + focus}
            style={{ borderColor: checked ? C.green : '#d1d5db', color: checked ? C.green : C.blueBlack }}>
            {checked ? '✓ I marked this complete' : 'I completed this step'}
          </button>
        </div>

        <section className="border-t border-gray-100 pt-5 space-y-3">
          <button type="button" aria-expanded={helpOpen} aria-controls="start-step-help"
            onClick={() => setHelpOpen(open => !open)} className={'text-sm font-semibold underline ' + focus}
            style={{ color: C.deepBlue }}>
            {helpOpen ? 'Hide troubleshooting' : "What if this doesn't work? / I'm stuck"}
          </button>
          {helpOpen && (
            <div id="start-step-help" className="rounded-xl bg-gray-50 p-4 space-y-3">
              <p className="text-sm leading-relaxed text-gray-700">{step.help}</p>
              <p className="text-xs text-gray-600">
                Report the exact step through GitHub. You can describe the problem there.
                <strong> Never include passwords, API keys, provider tokens, cookies, auth headers, private prompts, personal data or full logs.</strong>
                No notes, credentials or account details are inserted in the report URL.
              </p>
              <a className={'inline-block text-sm font-semibold underline ' + focus}
                href={feedbackHref(journey, step)} target="_blank" rel="noopener noreferrer"
                aria-label={'Report a problem with ' + step.title + ' on GitHub'}>
                Something wrong with this step? Open GitHub issue ↗
              </a>
            </div>
          )}
        </section>

        <div className="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-gray-100">
          {previous
            ? <Link className={'text-sm underline ' + focus} to={'/start/' + journey.id + '?step=' + previous.id}>← Previous step</Link>
            : <Link className={'text-sm underline ' + focus} to="/start">← All journeys</Link>}
          {next
            ? <Link className={'rounded-lg px-4 py-2 text-sm font-semibold ' + focus}
                style={{ background: '#eef1f2', color: C.blueBlack }}
                to={'/start/' + journey.id + '?step=' + next.id}>Next step →</Link>
            : <Link className={'text-sm font-semibold underline ' + focus} to="/start">Explore other journeys →</Link>}
        </div>
      </article>
      <p className="text-xs text-gray-500">
        Advanced setup, protocol and security details are in <Link className="underline" to="/docs">Docs</Link>.
        The provider installation flow remains experimental until an independent Mac owner qualifies it.
      </p>
    </div>
  )
}
