// #199 Phase A: offline contract checks. Not a substitute for browser or external-Mac acceptance.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JOURNEYS, GLOSSARY, completedSteps, feedbackHref, progressStorageKey } from './getting-started.js'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const nav = read('../components/Layout.tsx')
const routes = read('../main.tsx')
const page = read('../pages/GettingStarted.tsx')
const landingNav = read('./nav.js')
const providePage = read('../pages/Provide.tsx')

assert.deepEqual(JOURNEYS.map(journey => journey.id), ['consumer', 'api', 'provider', 'both'])
assert.equal(GLOSSARY.length >= 7, true)
for (const journey of JOURNEYS) {
  const ids = journey.steps.map(step => step.id)
  assert.equal(new Set(ids).size, ids.length, journey.id + ' step IDs must be unique')
  assert.ok(journey.steps.length >= 3, journey.id + ' should have meaningful progression')
  for (const step of journey.steps) {
    for (const prop of ['title', 'description', 'expected', 'help', 'action', 'to']) {
      assert.ok(typeof step[prop] === 'string' && step[prop].trim(), journey.id + '/' + step.id + ' missing ' + prop)
    }
    // Do not invent new credential workflows or link to admin APIs.
    assert.ok(step.to.startsWith('/') || step.to.startsWith('https://github.com/qzyu999/inference-exchange/blob/main/docs/guides/'))
    assert.doesNotMatch(step.to, /\/admin|provider-tokens|token=|sk-ie-[A-Za-z0-9]|pt-ie-[A-Za-z0-9]/)
    const report = new URL(feedbackHref(journey, step))
    assert.equal(report.origin, 'https://github.com')
    assert.equal(report.pathname, '/qzyu999/inference-exchange/issues/new')
    assert.match(report.searchParams.get('body'), new RegExp('Step ID: ' + step.id))
    assert.match(report.searchParams.get('body'), /Do not share API keys, provider tokens/)
    assert.doesNotMatch(report.href, /auth_header|Authorization%3A%20Bearer|account_id|localStorage/)
  }
  const done = {}
  done[journey.id + '/' + journey.steps[0].id] = true
  assert.equal(completedSteps(journey, done), 1)
  done[journey.id + '/' + journey.steps[0].id] = false
  assert.equal(completedSteps(journey, done), 0)
}

const provider = JOURNEYS.find(journey => journey.id === 'provider')
assert.equal(provider.steps.find(step => step.id === 'enroll').title, 'Enroll your provider node')
assert.match(provider.steps.find(step => step.id === 'enroll').description, /intended to be available on demand/)
assert.doesNotMatch(provider.steps.map(step => step.title).join(' '), /approved window/i)
assert.match(JOURNEYS.find(journey => journey.id === 'both').steps.find(step => step.id === 'provide').help, /temporarily unavailable/)

assert.notEqual(progressStorageKey('user-a'), progressStorageKey('user-b'))
assert.notEqual(progressStorageKey('user-a'), progressStorageKey(null))
assert.match(nav, /path: '\/start', label: 'Getting Started'/)
assert.match(nav, /location\.pathname\.startsWith\('\/start\/'\)/)
assert.match(nav, /\{sidebarContent\}/g) // shared desktop/mobile nav
assert.match(nav, /pathname\.startsWith\('\/start\/'\) \? '\/start'/)
assert.match(routes, /path="\/start" element=\{<GettingStarted \/>/)
assert.match(routes, /path="\/start\/:journey" element=\{<GettingStarted \/>/)
assert.match(landingNav, /to: '\/start', label: 'Getting Started'/)
assert.match(page, /role="progressbar"/)
assert.match(page, /user-confirmed/)
assert.match(page, /aria-current=\{i === stepIndex \? 'step'/)
assert.match(page, /useSWR\(needModels \? 'models'/)
assert.match(page, /\['myKeys', user\.user_id\]/)
assert.match(page, /\['dashboard\/provider-nodes', user\.user_id\]/)
assert.match(page, /\['dashboard\/provider-earnings', user\.user_id\]/)
assert.match(page, /Something wrong with this step\? Open GitHub issue/)
assert.match(page, /Private-alpha availability/)
assert.match(page, /disabled by default/)
assert.match(page, /self-service without scheduled windows/)
assert.match(page, /cannot check the live global enrollment switch/)
assert.match(page, /Windows CMD/)
assert.match(page, /Copy setup commands/)
assert.match(page, /read -rs IE_API_KEY/)
assert.doesNotMatch(page, /\/v1\/admin\/|enrollSelfServiceProvider|createUserKey|setItem\(.+token|setItem\(.+key/)
console.log('#199: journeys, safe feedback URLs, routes, scopes and step distinctions passed')
