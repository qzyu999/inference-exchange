# Update a pinned coordinator

Use this helper only for an existing launchd coordinator.
The launcher must use a final `exec` line.
Its release `cd` must be followed by `export PYTHONPATH`.
The service must already be loaded.

Pull `main` in the deployment checkout.
Build the web app with `npm ci` and `npm run build` in `web`.
Use the existing Python environment to run the helper:

```bash
.venv/bin/python scripts/deploy_pinned_coordinator.py \
  --repo "$PWD" \
  --db "$HOME/.inference-exchange/alpha-exchange.db"
```

The default launcher is `~/.inference-exchange/services/coordinator.sh`.
Use `--launcher` to select another launcher.
Use `--service` to select another launchd label.
Use `--url` to select another local coordinator URL.

The helper checks the current database path from the launcher environment.
It refuses a missing database or a path mismatch.
It preserves the environment file and geography marker.
It does not install dependencies.
It creates a clean detached release checkout at the current `origin/main` commit.
It checks the application import without starting the app or opening the database.

It saves the current launcher with restricted permissions.
It creates an online SQLite backup that includes committed WAL data.
It checks backup integrity before changing the launcher.
It changes only the release path and `PYTHONPATH` prefix.
It restarts the loaded service with `launchctl kickstart`.
The restart briefly interrupts in-flight requests.
Providers must reconnect.

It checks local health and the new public network activity route.
It does not send a billable inference request.
A failed check restores the old launcher and attempts to restart that version.
The database remains in place.
The analytics schema changes are additive.

After success, the helper prints the release commit, backup paths, and a code rollback command.
The rollback command keeps new transactions in the current database.
Do not restore an old database automatically: it can lose transactions made after the backup.
The web build has a separate rollback through your usual deployment process.
Keep backups private.
Remove old backups according to your retention policy.

## Review after deployment

Open Overview while signed in and signed out.
Both views show the same shared network activity.
Send a new API request with a compatible trust setting.
Check that the completion appears in Request outcomes.
The list uses request time, newest first.
The private trace keeps its request time when its status changes.
A same-country route has a pulse marker.
A route requires trusted country data from both connections.
The provider must reconnect after geography is enabled.

Open Billing.
The all-time model breakdown includes charges beyond the latest 50 rows.
Overview spend covers the whole exchange.
Billing spend covers your account.
Both use simulated credits in this alpha.

Open Admin with an IE admin account.
Check total accounts and signup country counts.
Old accounts show Unknown.
Repeat sign-in does not add a signup.
Refresh Overview after a coordinator restart.
Completed operational records remain within the retention window.
Older process-memory traces cannot be recovered.
Financial history is retained separately.
