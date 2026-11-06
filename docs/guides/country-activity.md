# Shared network activity

Overview shows the same exchange activity to visitors, members, and administrators.
A new account can see activity before it sends any requests.
No date parameters or minimum daily volume are required.

## Globe

The globe uses the latest 30 completed recorded requests across the exchange.
Its window is independent of the latest 30 outcomes below it.
Failed requests do not displace these completed routes.
The history covers at most seven days and 10,000 exchange-wide operational records.
Country anchors are approximate connection origins, not device locations or residences.
A same-country route has a pulse marker.
Reduced-motion settings disable animation.
The example control is labeled as an illustration.
Completed routes are historical activity, not live streams.

## Request outcomes

The shared list shows the latest 30 recorded routing outcomes, newest first.
It can show a settled served model, status, tokens, latency, simulated request cost, and country pair.
It rounds timestamps down to the minute.
It reports missing metadata as unknown.
It does not expose the requested-model string or free-text failure reason.
The completion count in the globe can differ from this mixed-outcome list.
These windows are not all-time totals.

The public response contains no original request IDs or ID hashes, account IDs, emails, IPs, credentials, provider identities, prompts, responses, or private trace links.
Removing identifiers does not guarantee anonymity.
Someone with outside knowledge can still recognize distinctive activity on a small network.

## Private details

Use the detailed-history link to inspect your own exact request traces.
An IE admin can inspect all retained traces.
Other members cannot inspect your detailed traces or personal billing history.
Signup reports remain admin-only.
The legacy `/v1/exchange/activity/recent` endpoint remains owner/admin scoped.
The shared view uses `/v1/exchange/activity/network` instead.

## Country collection

Country collection is disabled by default.
Enable it with `IE_COUNTRY_ACTIVITY_ENABLED=1` and an ingress secret of at least 32 characters.
Keep the coordinator reachable only through your trusted ingress.
Enable Cloudflare IP Geolocation for the API hostname.
Set `X-IE-Geo-Secret` in a Request Header Transform Rule to the same secret as `IE_GEO_INGRESS_SECRET`.
The rule must overwrite client values on HTTP requests and provider WebSocket upgrades.
Keep the secret out of Git, logs, URLs, and screenshots.
Restart the coordinator and reconnect providers after configuration changes.

The trusted `CF-IPCountry` header applies to browser and SDK connections through the public hostname.
VPNs and servers can change the apparent country.
An enabled flag confirms configuration, not valid country delivery.
Capture country pairs only after provider completion and successful settlement.
Do not infer historical countries.
The separate confidential-session API is not included in country collection.
Country data is not an attestation and does not affect routing or trust.

Set `X-IE-Exclude-Geography: 1` to omit countries for a request.
This does not hide its non-geographic activity.
Disabling collection also hides retained countries from activity endpoints.
It does not disable shared non-geographic activity.
Operational retention and account deletion remove the operational records.
Private SQLite backups can retain old records until the operator removes those backups.

## Legacy daily aggregate

`/v1/exchange/country-activity` remains compatible.
It publishes only the previous UTC day's pairs with at least five completed requests from three consumer accounts.
Its count bands use bounded process-memory counters that clear on restart.
Overview no longer uses this delayed aggregate.

See [decision 0007](../decisions/0007-shared-network-activity.md) for the visibility policy.
