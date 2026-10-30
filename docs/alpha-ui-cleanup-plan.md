# First-tester alpha UI cleanup and test plan

## Objective

A new user can sign in with GitHub and send a real Chat request without
understanding marketplace internals. The user can run the standard OpenAI Python
SDK without cloning the project or first reading the full documentation.

Use the existing M6 L0/Open provider. The coordinator and provider can see
prompts and responses. Do not send secret or personal content during testing.

## Scope of the PR

1. Show model selection and an explicit L0/Open choice when a higher OCIP
   minimum cannot be met. Do not silently lower the required level.
2. Hide experimental preference rankings, unenforced Input/Cached rate sliders,
   and a non-operational OpenRouter fallback claim. Keep the minimum OCIP level
   and server-enforced output price ceiling in an optional settings panel.
3. Put ready-to-copy nonstreaming and streaming Python SDK examples on API Keys.
   Use a public HTTPS base URL. Read the API key from a local environment variable.
4. Show observed recent route statuses rather than random chart bars or guessed
   binary versions.
5. Label provider onboarding as a preview. Do not alter or enable the provider
   signup gate. Preserve the owner's working credential issuance/revocation UI.

This PR does not change routing behavior, fee rates, billing accounts, trust
admission, registration settings, coordinator deployment, or Mac launchd jobs.
The billing receipt remains in simulated currency and retains its minimum charge.

## Automated checks

Run TypeScript + Vite build and the existing web tests, including
`node web/src/lib/alpha-ui.test.mjs`. Keep the Python unit tests,
requirements checker, and image/infra builds in CI. Do not treat source
assertions as proof that the live website behaves correctly.

## Separate live acceptance: MBP A + Mac mini

Only after review/merge, and only when the operator approves a deployment:

1. Read the **deployed** commit, check a current SQLite backup and rollback
   location, and check the real M6 provider is connected. Keep the existing M6
   provider token, billing principal, ownership and historical ledger unchanged.
2. Confirm the age, privacy, L0/Open and feedback disclosures for this tester.
   A short consumer signup window is a global switch, not an invite allowlist.
   Leave independent provider enrollment off.
3. With a fresh user identity/browser, complete GitHub sign-in, explicit L0/Open
   choice, an innocuous test Chat request, model and simulated cost display.
4. Verify the new account's private history and actual integer-microUSD charge.
   Verify that another account cannot see its key, history or transactions.
5. From API Keys, create a fresh `sk-ie-` key. Run both copied examples from
   a separate machine. Revoke the key and confirm a subsequent call gets 401.
6. Verify narrow and desktop layouts, no dead buttons, and error states for
   missing provider, disabled signup and trust mismatch.
7. Separately authorize an operator pause -> HTTP 503 -> resume drill.
   Record the result, sanitized evidence, and a go/no-go for the next tester.

## Rollback

Merging a PR is not a deployment to either Mac. On an owner-approved web
rollout, if the first-user flow regresses, restore the previously deployed
frontend artifact/commit and repeat the affected smoke test. Do not restore
the live SQLite DB merely to undo visual changes. Do not rotate the M6 token.

Related: #186, #174, #160, #92, #94, #122 and #134.
