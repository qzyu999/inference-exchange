# Alpha operations

Use this guide for the current two-host, launchd-based alpha.
It records operational knowledge from the recent UI, deployment, and geography work.
It does not confirm that a change is deployed or that backups run on a schedule.

## What runs where

| Role | Responsibility | Local endpoint |
|---|---|---|
| Coordinator host | FastAPI, SQLite, GitHub sign-in, matching, billing, and provider connections | `127.0.0.1:8000` |
| Coordinator host | Caddy serves the React build and forwards API traffic | `127.0.0.1:8080` |
| Provider host | Provider agent and the model server | Model server: `127.0.0.1:9999` |
| Trusted edge | Cloudflare Tunnel, Access policies, and trusted geography headers | Public alpha hostname |

These are separate services.
A healthy model server does not prove that the provider is registered with the coordinator.
A healthy coordinator with zero providers cannot serve a model request.
Both hosts need power, network access, and a working service session.
Check host sleep and reboot behavior before relying on unattended availability.

## Keep a private release record

Record these values after each deployment:

- Deployment time and the commit actually built for the frontend.
- Active coordinator release commit and Python environment.
- Provider version, model file checksum, and local model-server port.
- Database path and the latest verified backup location.
- Service labels and whether they are loaded.
- Feature-flag values and the location of the private environment file.
- Health and provider-reconnect results.

Store this record privately with the deployment configuration.
Do not put credentials or environment-file contents in GitHub issues.
A merged PR and a green CI run are not evidence of a live deployment.

## The checkout and the running backend can differ

The frontend is built from the deployment checkout into `web/dist`.
Caddy must serve that build through its configured web root (`IE_ALPHA_WEB_ROOT` in this alpha).
Building another checkout does not change the served files.
The coordinator launcher can use a detached `ie-api-release-<commit>` checkout.
Its final release `cd` and `PYTHONPATH` select the imported backend code.
The launchd `WorkingDirectory` alone does not identify that release.
Pulling `main` and rebuilding the frontend does not update the backend pin.

To inspect the existing pin without printing the environment or secret reads:

```bash
python3 - <<'PY'
from pathlib import Path
import shlex
import subprocess
launcher = Path.home() / '.inference-exchange/services/coordinator.sh'
lines = launcher.read_text().splitlines()
for index, line in enumerate(lines[:-1]):
    if line.lstrip().startswith('cd ') and lines[index + 1].startswith('export PYTHONPATH='):
        parts = shlex.split(line)
        if len(parts) == 2:
            release = parts[1]
            print('Pinned release:', release)
            subprocess.run(['git', '-C', release, 'rev-parse', 'HEAD'], check=True)
PY
```

This reads configured files, not the memory of an already running process.
After a pin change, restart the service and check health.
Keep the old release until the new release is accepted and rollback is no longer needed.
Do not remove the active release or the shared `.venv`.

## Choose the deployment procedure

| Change | Required action |
|---|---|
| Browser UI or bundled documentation only | Pull the approved commit; run `npm ci` and `npm run build` in `web`; refresh the browser |
| Backend, API, persistence, or runtime behavior | Use the [pinned coordinator helper](deploy-pinned-coordinator.md), including its database backup and restart |
| Provider agent, model, or hardware configuration | Use the provider validation procedure; preserve its existing credential and billing identity |
| Cloudflare or service environment | Review the private configuration separately; rebuilding React cannot apply these changes |

Run deployment commands on the coordinator host for the first two rows.
Do not restart the provider host for a frontend-only change.
The pinned coordinator helper does not install Python dependencies.
Review dependency changes before using its existing environment.
Code rollback does not restore a shared Python environment.
Record its version and validate dependency changes separately.

The helper saves a private online SQLite backup and the old launcher.
It changes the release pin, restarts the loaded service, and checks health plus the public activity route.
It prints a code rollback command.
It restores the launcher if its checks fail.
Use the printed rollback path rather than guessing an older release.
Save the accepted frontend artifact before rebuilding it.
Frontend rollback requires its matching HTML and assets.
The coordinator helper does not back up `web/dist`.

## Database and recovery

The launcher's effective `IE_DB_PATH` selects the live database.
The conventional alpha path is `~/.inference-exchange/alpha-exchange.db`.
The generic development default is `~/.inference-exchange/exchange.db`.
Do not create or switch to a new database while diagnosing missing rows.
First check the effective environment, release pin, and service process.

Use SQLite's online backup API while the service is running.
Do not copy only the `.db` file while WAL writes can occur.
The deployment helper uses the backup API and checks the backup with `PRAGMA quick_check`.
The [two-machine validation guide](alpha-two-machine-validation.md) covers migration rehearsals on disposable copies.
Do not start a coordinator or a current Store against the live database just to inspect it.
Store startup can apply migrations and change operational state.

A code rollback normally keeps the current database.
Restoring an old database can remove transactions accepted since that backup.
Pause new inference and reconcile those transactions before an actual database restore.
Keep restore testing on a disposable database until recovery is explicitly planned.

Deployment snapshots are not continuous disaster recovery.
A backup on the same host does not protect against losing that host.
Verify a recurring private off-host backup process and test recovery from it.
Set a retention policy for database snapshots, launchers, logs, and old release checkouts.
Do not delete the only accepted recovery copy.
RPO and RTO were not measured in this work.
Backup/restore automation and validation remain part of the [operations backlog](https://github.com/qzyu999/inference-exchange/issues/96).

## Distinguish durable and temporary data

| Data | Lifetime and meaning |
|---|---|
| Users, balances, transactions | SQLite data; operational-history pruning does not delete the ledger |
| Recorded request outcomes and their countries | Up to seven days and 10,000 rows across the exchange; survive restarts |
| Globe routes | Up to 30 distinct directional pairs derived from retained completions; repeated routes take one slot |
| Legacy daily country counters | Process memory; cleared by restart; separate from the current globe |
| Provider connections, queues, reputation, and TPS tracking | Process state; do not assume restart persistence |
| Admin runtime switches | Reset to configured environment values at restart |
| Browser chat history | Account-scoped browser localStorage; not shared across devices or incognito sessions |
| Signup country | Captured at account creation only; old accounts remain unknown |

A restarted in-flight routed request can become `interrupted` if completion was not confirmed.
That status does not prove the client received a response.
A successful health check does not prove ledger conservation or full inference readiness.
Use the [operator playbook](operator-playbook.md) for pauses, account controls, and incident response.

## Geography checks

`IE_COUNTRY_ACTIVITY_ENABLED=1` also requires `IE_GEO_INGRESS_SECRET` of at least 32 characters.
The edge must overwrite `X-IE-Geo-Secret` and supply a valid `CF-IPCountry`.
The marker file can be stored at `~/.inference-exchange/geo-ingress-secret` with private permissions.
A launcher can load that file after sourcing its private environment.
Exports after `source` override values from that environment file.
Check these overrides when a configuration edit appears to have no effect.
Do not paste the marker, environment file, cookies, or complete headers into a bug report.

The enabled flag proves configuration only.
Country routes require both a trusted provider registration and a trusted consumer request.
Reconnect the provider after enabling geography.
When rotating the marker, update both the edge rule and the coordinator secret.
Then restart the coordinator and reconnect providers.
An SDK request through the public hostname receives the same edge treatment as a browser request.
A local request without the trusted marker has unknown geography.
VPNs and servers can affect the apparent country.
Use a nonsensitive real completion to validate the route, not just `/health`.
See [shared country activity](country-activity.md) for public fields, exclusions, retention, and disabled behavior.

## Routine checks

| When | Check |
|---|---|
| After a deployment or restart | Local health, public API route, expected online model, provider reconnect, browser smoke, and a private release record |
| While the alpha is in use | Host availability, provider count, errors, disk space, and the age of the latest successful off-host backup |
| On a scheduled recovery drill | Restore a backup into an isolated location; verify integrity and ledger totals; record recovery time |
| After configuration changes | Confirm signup/enrollment controls, trusted ingress, and credential handling remain as intended |

The repository does not establish that these checks or recurring off-host backups are scheduled on the live hosts.
Keep the chosen cadence and responsible operator in the private operations record.

## Fast diagnosis

- New UI with a missing API route: check the backend pin before changing Cloudflare.
- Public site failure with healthy local services: check Caddy, Tunnel, and Access separately.
- Zero providers: check the provider service and model server on the provider host.
- Empty globe with activity: check trusted country capture, geography exclusions, and retained completions.
- Empty personal history on another account: check the shared network view versus owner-only detailed traces.
- Different spend totals: Overview is exchange-wide; Billing is personal. Both totals are all time and simulated.
- Fewer outcomes after seven days or heavy traffic: check bounded operational retention before suspecting a new database.

Do not rotate the existing provider credential or create a new billing principal to resolve a display issue.
