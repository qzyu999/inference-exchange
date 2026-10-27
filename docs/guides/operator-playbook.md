# Operator playbook

This guide tells an operator how to find and stop abuse during the alpha. It uses only metadata. Do not read user prompts or responses.

All commands need an admin session. Sign in with an email that is in `IE_ADMIN_EMAILS`. Then send the requests from the browser session, or copy the `ie_session` cookie to `curl`.

```bash
export IE=https://<coordinator-hostname>
export COOKIE="ie_session=<admin-session-cookie>"
```

Do not share the session cookie. Do not put it in a script that you commit.

## 1. Find the problem

Look at the system state:

```bash
curl -s -b "$COOKIE" $IE/v1/admin/controls
curl -s -b "$COOKIE" $IE/v1/admin/state
```

- `/v1/admin/controls` shows the queue length, the active requests for each account, and the switches.
- `/v1/admin/state` shows the providers, their load, and the recent bills.

Look at the accounts:

```bash
curl -s -b "$COOKIE" $IE/v1/admin/accounts
```

Each row has the account ID, the creation time, the last sign-in, the request count, and the suspension state. Look for these signs:

- An account with many requests in a short time.
- An account that always has the maximum number of active requests.
- Many new accounts in a short time.

The coordinator log has the request ID, the account ID, the provider, and the token counts. It does not have prompts.

## 2. Stop the problem

Select the smallest action that stops the problem.

### One account

Suspend the account for a time period. Give a reason.

```bash
curl -s -b "$COOKIE" -X POST $IE/v1/admin/accounts/<user_id>/suspend \
  -H "Content-Type: application/json" \
  -d '{"reason": "compute saturation", "duration_seconds": 3600}'
```

To ban the account permanently, set `"duration_seconds": null`.

The suspension does these things:

- It ends all sessions of the account.
- It rejects all API keys of the account with HTTP 403.
- It stays in effect after a restart.

A request that is in progress can complete.

### Many new accounts

Stop new sign-ups:

```bash
curl -s -b "$COOKIE" -X POST $IE/v1/admin/controls \
  -H "Content-Type: application/json" -d '{"signup_disabled": true}'
```

Existing users can still sign in. You can also set `IE_GITHUB_MIN_AGE_DAYS` to reject new GitHub accounts.

### The provider is overloaded

Lower the number of simultaneous requests for each account:

```bash
curl -s -b "$COOKIE" -X POST $IE/v1/admin/controls \
  -H "Content-Type: application/json" -d '{"max_concurrent_per_account": 1}'
```

Clear the queue:

```bash
curl -s -b "$COOKIE" -X POST $IE/v1/admin/queue/clear
```

Queued requests get HTTP 503 with the code `queue_cleared`.

### All traffic

Pause inference:

```bash
curl -s -b "$COOKIE" -X POST $IE/v1/admin/controls \
  -H "Content-Type: application/json" -d '{"inference_paused": true}'
```

New requests get HTTP 503 with the code `inference_paused`.

### A bad provider

Remove the provider from routing. It stays connected:

```bash
curl -s -b "$COOKIE" -X POST $IE/v1/admin/providers/<provider_id>/quarantine \
  -H "Content-Type: application/json" -d '{"reason": "wrong output"}'
```

Revoke the provider token. This also disconnects each provider that uses it:

```bash
curl -s -b "$COOKIE" -X DELETE $IE/v1/admin/provider-tokens/<token_id>
```

## 3. Make sure that the action works

- Send a request with a key of the suspended account. Expect HTTP 403 `account_suspended`.
- Look at `/v1/admin/controls`. Make sure that the active requests and the queue length go down.
- Look at `/v1/admin/account-actions`. Make sure that the action, the reason, and your email are recorded.

## 4. Restore

```bash
curl -s -b "$COOKIE" -X POST $IE/v1/admin/accounts/<user_id>/unsuspend \
  -H "Content-Type: application/json" -d '{"reason": "appeal accepted"}'
curl -s -b "$COOKIE" -X POST $IE/v1/admin/controls \
  -H "Content-Type: application/json" \
  -d '{"inference_paused": false, "signup_disabled": false, "max_concurrent_per_account": 2}'
curl -s -b "$COOKIE" -X POST $IE/v1/admin/providers/<provider_id>/release
```

A revoked provider token cannot be restored. Create a new token for the provider.

## Configuration at start-up

Runtime changes to the controls stop at a restart. To keep a setting, put it in `deploy/.env`:

| Variable | Default | Function |
|---|---|---|
| `IE_INFERENCE_PAUSED` | `0` | `1` pauses inference. |
| `IE_SIGNUP_DISABLED` | `0` | `1` stops new sign-ups. |
| `IE_MAX_CONCURRENT_PER_ACCOUNT` | `2` | Simultaneous requests for each account. `0` means no limit. |
| `IE_QUEUE_MAX_DEPTH` | `50` | Maximum number of queued requests. |
| `IE_QUEUE_TIMEOUT_SECONDS` | `30` | Maximum wait in the queue. |

Suspensions, bans, and revoked provider tokens are in the database. They stay in effect after a restart.

## Known limits

- A suspended user can make a new GitHub account. `IE_GITHUB_MIN_AGE_DAYS` makes this slower. It does not prevent it.
- The system does not detect a stolen API key. If a key is stolen, the user must revoke it, or you must suspend the account.
- The system does not ban IP addresses. Many users can share one IP address.
- There are no automatic alerts yet. You must look at the state yourself.
