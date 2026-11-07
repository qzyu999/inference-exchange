import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'
import { loginHref } from '../lib/nav.js'
import { JOURNEYS, feedbackHref, resolveStartJourney, sdkExample } from '../lib/getting-started.js'
import { PROVIDER_COMMANDS } from '../lib/provider-start-commands.js'
import './getting-started.css'

type Platform = 'mac' | 'windows' | 'linux'
const SDK_COMMANDS: Record<Platform, string> = {
  mac: 'python3 -m venv .venv\nsource .venv/bin/activate\npython -m pip install openai',
  linux: 'python3 -m venv .venv\nsource .venv/bin/activate\npython -m pip install openai',
  windows: 'py -m venv .venv\n.venv\\Scripts\\activate.bat\npython -m pip install openai',
}
const KEY_INPUT: Record<Platform, string> = {
  mac: 'read -rs IE_API_KEY && export IE_API_KEY',
  linux: 'read -rs IE_API_KEY && export IE_API_KEY',
  windows: 'set /p IE_API_KEY=Paste your Inference Exchange API key (visible input): ',
}

function CodeBlock({ code, label = 'Copy commands' }: { code: string; label?: string }) {
  const [message, setMessage] = useState('')
  useEffect(() => setMessage(''), [code])
  async function copy() {
    try { await navigator.clipboard.writeText(code); setMessage('Copied') }
    catch { setMessage('Select the code and copy it manually.') }
  }
  return <div className="ie-setup-code">
    <pre><code>{code}</code></pre>
    <div className="ie-setup-copy"><button type="button" onClick={() => void copy()}>{label}</button><span role="status">{message}</span></div>
  </div>
}

function JourneyLanding() {
  return <div className="ie-start ie-setup ie-setup-landing">
    <div className="ie-setup-intro"><h2>What would you like to do?</h2><p>Choose where to start.</p></div>
    <div className="ie-setup-choices" aria-label="Choose where to start">
      {JOURNEYS.map(journey => <Link key={journey.id} className="ie-setup-choice" to={'/start/' + journey.id}>
        <span className="ie-setup-kicker">{journey.audience}</span>
        <h3>{journey.name} <span aria-hidden="true">→</span></h3>
        <p>{journey.summary}</p>
      </Link>)}

    </div>
    <p className="ie-setup-note">Private alpha · Credits and provider earnings are simulated.</p>
    <div className="ie-setup-links"><Link to="/chat">Try it in your browser</Link><Link to="/docs">Documentation</Link></div>
  </div>
}

export function GettingStarted() {
  const { journey: requestedJourney } = useParams()
  const [query] = useSearchParams()
  const { user, loading: authLoading } = useAuth()
  const [platform, setPlatform] = useState<Platform>(() => /Mac/i.test(navigator.platform) ? 'mac' : /Win/i.test(navigator.platform) ? 'windows' : 'linux')
  const [selectedModel, setSelectedModel] = useState('')
  const [allowOpen, setAllowOpen] = useState(false)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const [finished, setFinished] = useState(false)
  const journeyId = resolveStartJourney(requestedJourney)
  const journey = JOURNEYS.find(item => item.id === journeyId)
  const requestedStep = query.get('step')
  const matchingIndex = journey?.steps.findIndex(item => item.id === requestedStep) ?? -1
  const stepIndex = matchingIndex >= 0 ? matchingIndex : 0
  const step = journey?.steps[stepIndex]
  const needModels = journey?.id === 'api' && ['find-model', 'request'].includes(step?.id || '')
  const { data: models, error: modelError, isLoading: modelLoading } = useSWR(needModels ? 'models' : null, api.models, { refreshInterval: 15000 })
  const { data: keys, error: keysError } = useSWR(step?.check === 'keys' && user ? ['myKeys', user.user_id] : null, api.myKeys)
  const { data: nodes, error: nodeError } = useSWR(step?.check === 'nodes' && user ? ['dashboard/provider-nodes', user.user_id] : null, api.ownedProviderNodes, { refreshInterval: 5000 })
  // A model must still be advertised when its example is generated.
  const model = models?.data.find(item => item.id === selectedModel)?.id || ''
  useEffect(() => { setAllowOpen(false); setFinished(false) }, [user?.user_id, selectedModel, journeyId])
  useEffect(() => { stepHeading.current?.focus(); setFinished(false) }, [requestedJourney, requestedStep])

  if (requestedJourney && journeyId !== requestedJourney) return <Navigate replace to={journeyId ? '/start/' + journeyId : '/start'} />
  if (!journey || !step) return <>{requestedJourney && <p role="alert" className="text-ui-body mb-4">Choose a setup path below.</p>}<JourneyLanding /></>

  const next = journey.steps[stepIndex + 1]
  const previous = journey.steps[stepIndex - 1]
  const href = (id: string) => '/start/' + journey.id + '?step=' + id
  const canContinue = step.check === 'auth' ? Boolean(user) : step.id === 'find-model' ? Boolean(model) : true
  const online = nodes?.nodes.filter(node => ['online', 'busy'].includes(node.status)) || []
  const actionHref = step.to === '/login' ? loginHref(href(step.id)) : step.to
  const modelPicker = <div className="ie-setup-field">
    <label htmlFor="setup-model">Available model</label>
    {modelError ? <p role="status">Models are unavailable right now. Try again shortly.</p>
      : modelLoading || !models ? <p role="status">Checking available models…</p>
      : !models.data.length ? <p role="status">No models are online. Try again when a provider connects.</p>
      : <select id="setup-model" value={model} onChange={event => setSelectedModel(event.target.value)}>
        <option value="" disabled>Choose a model</option>{models.data.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
      </select>}
  </div>

  return <div className={'ie-start ie-setup' + (journey.id === 'ocip' ? ' ie-setup-learning' : '')}>
    <Link className="ie-setup-back" to="/start">← Choose a path</Link>
    <header className="ie-setup-header"><p className="ie-setup-kicker">{journey.name}</p>
      <p className="ie-setup-note">Step {stepIndex + 1} of {journey.steps.length}</p>
    </header>
    <nav aria-label={journey.name + ' steps'} className="ie-setup-progress"><ol>{journey.steps.map((item, i) => <li key={item.id}>
      <Link to={href(item.id)} aria-current={i === stepIndex ? 'step' : undefined} aria-label={'Step ' + (i + 1) + ': ' + item.title} title={item.title}><span aria-hidden="true">{i + 1}</span></Link>
    </li>)}</ol></nav>
    <article key={step.id} className="ie-setup-step">
      {step.label && <p className="ie-setup-kicker">{step.label}</p>}
      <h2 ref={stepHeading} tabIndex={-1}>{step.title}</h2><p className="ie-setup-description">{step.description}</p>
      {journey.id === 'ocip' && step.id === 'protocol' && <ol className="ie-setup-flow" aria-label="A request moves from your app through the exchange to a provider">
        <li>Your app</li><li>The exchange</li><li>A provider</li>
      </ol>}
      {step.takeaway && <div className="ie-setup-takeaway"><span>Remember</span><p>{step.takeaway}</p></div>}
      {step.id === 'hardware' && <p className="ie-setup-note">The first line must say <code>arm64</code>. This preview is experimental.</p>}
      {step.command && PROVIDER_COMMANDS[step.command] && <CodeBlock code={PROVIDER_COMMANDS[step.command]} />}
      {step.command === 'server' && <p className="ie-setup-note">Need Homebrew? <a href="https://brew.sh/" target="_blank" rel="noopener noreferrer">Install it first ↗</a></p>}
      {step.command === 'connect' && <p className="ie-setup-note">Open inference is not confidential. Keep Terminal open to stay connected.</p>}
      {step.command === 'model' && <p className="ie-setup-note">Wait for the download to finish and the checksum to say <strong>OK</strong>.</p>}
      {step.command === 'sdk' && <>
        <div className="ie-setup-platform" role="group" aria-label="Operating system">{([['mac', 'macOS'], ['windows', 'Windows CMD'], ['linux', 'Linux']] as [Platform, string][]).map(([id, label]) => <button key={id} aria-pressed={platform === id} onClick={() => setPlatform(id)}>{label}</button>)}</div>
        <CodeBlock code={SDK_COMMANDS[platform]} />
      </>}
      {step.id === 'find-model' && modelPicker}
      {step.gate && <p className="ie-setup-notice">Provider registration may be paused during the private alpha. If unavailable, stop here and try again later.</p>}
      {step.check === 'auth' && <p className="ie-setup-status" role="status">{authLoading ? 'Checking sign-in…' : user ? 'Signed in' : 'Sign in to continue.'}</p>}
      {step.check === 'keys' && user && <p className="ie-setup-status" role="status">{keysError ? 'Could not check your keys.' : !keys ? 'Checking your keys…' : keys.keys.length ? 'You have an active API key. Make sure you have its secret saved.' : 'No API keys yet.'}</p>}
      {step.check === 'nodes' && <p className="ie-setup-status" role="status">{!user ? 'Sign in to check your Mac.' : nodeError ? 'Could not check your connection.' : !nodes ? 'Checking your connection…' : online.length ? 'Connected: ' + online.map(node => node.name + (node.models.length ? ' · ' + node.models.join(', ') : ' · no models listed')).join('; ') : 'No connected providers yet. Keep the agent running while you check.'}</p>}
      {step.command === 'request' && <>
        {modelPicker}
        <label className="ie-setup-consent"><input type="checkbox" checked={allowOpen} onChange={event => setAllowOpen(event.target.checked)} /><span>Allow Open inference for this test. The coordinator and provider can read the message and response. Use a nonsensitive message.</span></label>
        {allowOpen && model && <>
          <h3>1. Set your API key</h3><p>Run this separately in the terminal you set up earlier. Paste your API key when prompted.</p>
          <CodeBlock code={KEY_INPUT[platform]} label="Copy key prompt" />
          <p className="ie-setup-note">{platform === 'windows' ? 'Windows CMD shows the key as you paste it. Use a private terminal.' : 'Your key stays hidden while you paste it.'}</p>
          <h3>2. Run the example</h3><p>Save this as <code>hello_ie.py</code>.</p>
          <CodeBlock code={sdkExample(model)} label="Copy Python example" />
          <CodeBlock code="python hello_ie.py" label="Copy run command" />
          <p className="ie-setup-note">A model response in your terminal means the request worked.</p>
        </>}
      </>}
      <div className="ie-setup-actions">
        {actionHref && !(step.check === 'auth' && user) && <Link className="ie-setup-primary" to={actionHref} target={step.to === '/login' ? undefined : '_blank'} rel="noopener noreferrer">{step.action}{step.to !== '/login' && ' ↗'}</Link>}
        {next ? <Link className={actionHref && !(step.check === 'auth' && user) ? 'ie-setup-secondary' : 'ie-setup-primary'} to={href(next.id)} aria-disabled={!canContinue} onClick={event => { if (!canContinue) event.preventDefault() }}>Continue →</Link>
          : journey.id === 'ocip' ? <><Link className="ie-setup-primary" to="/start/api">Use the API →</Link><Link className="ie-setup-secondary" to="/start/provider">Provide compute →</Link></> : journey.id === 'api' ? <button className="ie-setup-primary" disabled={!allowOpen || !model} onClick={() => setFinished(true)}>I got a response</button> : <Link className="ie-setup-secondary" to="/exchange">Explore the exchange →</Link>}
      </div>
      {finished && <div className="ie-setup-notice" role="status">You marked your first request complete. <Link to="/billing">View your usage</Link> or <Link to="/start/provider">provide compute</Link>.</div>}
      <details className="ie-setup-help"><summary>{journey.id === 'ocip' ? 'Learn more' : 'Need help?'}</summary><p>{step.help}</p>
        {step.command === 'request' && <p>Terminal changed? Choose your platform on the <Link to={href('install')}>Python setup step</Link>.</p>}
        {journey.id === 'provider' && <p><Link to="/docs/guides/provider-l0-apple-silicon-preview">Full technical reference</Link>. Open inference is not confidential. Provider credentials and API keys are separate.</p>}
        {step.reference && <p>{step.reference.startsWith('/') ? <Link to={step.reference}>Read the reference</Link> : <a href={step.reference} target="_blank" rel="noopener noreferrer">Read the OCIP specification ↗</a>}</p>}
        <a href={feedbackHref(journey, step)} target="_blank" rel="noopener noreferrer">Report a problem ↗</a><p className="ie-setup-note">Do not include keys, provider credentials, private prompts, or full logs.</p>
      </details>
    </article>
    <footer className="ie-setup-footer">{previous ? <Link to={href(previous.id)}>← Back</Link> : <Link to="/start">← Choose a path</Link>}<span>{journey.id === 'ocip' ? 'Protocol overview · No sign-in needed' : 'Private alpha · Simulated credits'}</span></footer>
  </div>
}
