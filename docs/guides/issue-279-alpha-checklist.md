# Issue 279: owner alpha checklist

Use this checklist after the owner publishes the ticker generation and deploys the coordinator.
Apply each URL path to the configured alpha origin.
Keep the origin and deployment settings in the private operations record.
Record each result as pass, fail, or not tested.
Keep issue #279 open until the required checks pass.

## Prepare the record

Record the deployed coordinator commit.
Record the deployed web commit.
Record the new ticker generation and publication time.
Save the available old Llama observations before publication.
Keep the database and existing provider credentials.
Do not create observations in the live database for this checklist.

Use `GET /v1/exchange/catalog?limit=100&offset=0` to read the catalog.
Request the remaining pages when `total` exceeds 100.
Increase `offset` by 100 for each page.
Restart the read if the catalog generation changes between pages.

## 1. Check the merged Llama model

Paths:

- `/exchange`
- `GET /v1/exchange/catalog?q=Llama%203.2&limit=100`

Select Llama 3.2 1B Instruct in the Exchange.
Find the catalog ID `meta-llama/llama-3.2-1b-instruct`.
Inspect its IE offer and external offers.

Pass condition: One model entry contains the IE offer and its external offers.
The entry has no duplicate standalone IE listing for that checkpoint.
Each offer shows provider, route, and quantization separately.
The IE alias offer has `identity_source: "reviewed_alias"`.
It has `identity_trust: "reviewed"`.
Artifact verification appears as a separate state.
Unknown quantization remains unknown.
The shared row does not claim equivalent quantizations or runtime identity.

Record a reported repository path separately if it takes precedence over the alias.
Do not describe that path as reviewed.
Investigate it before marking the reviewed-alias check as passed.

## 2. Check standalone Qwen and its family

Paths:

- `/exchange`
- `GET /v1/exchange/catalog?q=Qwen2.5%200.5B&ie_only=true&limit=100`

Find the Qwen2.5 0.5B Instruct offer.
Inspect its model ID, family, and offers.
Select the `qwen` family in the Exchange search.

Pass condition: The model ID starts with `ie/`.
The ID has a separate provider component and original model component.
The model has `family: "qwen"`.
Its row contains IE offers only.
It appears in the `qwen` search family.
It does not join an external Qwen model.

## 3. Check releases with the same size

Paths:

- `/exchange`
- `GET /v1/exchange/market`
- `GET /v1/exchange/catalog?q=Qwen&limit=100`

Find Qwen2.5 7B and Qwen3 7B if both are present.

Pass condition: The two releases have separate model IDs and rows.
Their display labels retain the release.
Offers from one release do not appear under the other release.

Record this check as not tested if either release is absent.
Do not add a model or an alias to make the check pass.

## 4. Check local display labels

Paths:

- `/exchange`
- `/models`
- `GET /v1/exchange/market`
- `GET /v1/exchange/catalog?q=Qwen2.5%200.5B&ie_only=true&limit=100`

Inspect the local Qwen and Llama labels.
Compare them with each provider's `original_model`.

Pass condition: The labels retain release, size, and variant.
For example, Qwen retains `Qwen2.5`, `0.5B`, and `Instruct`.
Llama retains `3.2`, `1B`, and `Instruct`.
The original advertised name remains available for model selection.
A local label does not become `Qwen 0.5B Instruct` or `Llama 1B Instruct`.

## 5. Check catalog quote labels and counts

Paths:

- `/exchange`
- `GET /v1/exchange/catalog?q=llama-3.2-1b-instruct&limit=100`

Inspect the offers' `quote_kind` fields.
Compare the API provider count with the Exchange count.
Inspect the endpoint depth, price chart, and headline comparison.

Pass condition: Model-level OpenRouter quotes have `quote_kind: "catalog"`.
The table labels them as catalog quotes.
Named serving offers and IE offers have `quote_kind: "endpoint"`.
Catalog quotes remain visible with their source and observation time.
They contribute zero to provider counts.
They contribute zero to endpoint depth and charts.
They do not qualify for headline savings.
Multiple endpoint offers from one provider do not increase the provider count.
Distinct endpoint routes and quantization details remain visible.

Compare listed token rates only.
Do not describe a percentage as total bill savings.

## 6. Check generation and old observations

Paths:

- `GET /v1/exchange/catalog?limit=1`
- `GET /v1/exchange/reference-prices/history?model=meta-llama%2Fllama-3.2-1b-instruct&days=90`
- `GET /v1/exchange/catalog/history?model=meta-llama%2Fllama-3.2-1b-instruct`

Compare the history generation with the current catalog generation.
Compare the history series with the saved old observations.

Pass condition: The reference-price history route returns HTTP 200.
Its `generation` equals the current catalog generation.
Each raw source and model has a separate series.
Available old observations retain their timestamps and prices.
The catalog history route also returns the catalog generation.

Repeat the read if publication changes the generation during comparison.
Record preservation as not tested if no old observations are available.
Do not claim preservation from an empty response.

## 7. Check an ambiguous legacy key

Path:

`GET /v1/exchange/reference-prices/history?family_key=<legacy-key>&days=90`

Use a legacy key whose stored rows select more than one model.
For example, use `qwen-7b-instruct` only if it has that collision.

Pass condition: The route returns HTTP 409.
The response contains at least two explicit choices.
Each choice identifies a catalog model or a raw source and model.
The response does not return mixed observations as one model.

Select one returned choice with `model`, or with `source` and `model_id`.
Confirm that its history contains only the selected group.
Record this check as not tested if no ambiguous key exists.
Do not seed the live database.

## 8. Check phase 1 rollback controls

Paths:

- `/exchange`
- `GET /v1/exchange/catalog?ie_only=true&limit=100`
- `GET /v1/exchange/market`
- `GET /v1/exchange/reference-prices/history?model=meta-llama%2Fllama-3.2-1b-instruct&days=90`

Record the original control values.
Set `IE_REPOSITORY_COMPARISON=0` in the private deployment configuration.
Set `IE_ENRICHED_MODEL_DISPLAY=0` there.
Restart the coordinator with the owner's existing process.
Read the same offers and history again.

Pass condition: Repository-only IE matches become standalone entries.
Reviewed aliases still select their catalog rows.
IE `display_name` fields use the advertised labels with separators replaced by spaces.
Published catalog labels remain available.
The resolver interface, source map, and raw-source history remain available.
History still returns the catalog generation.
Artifact verification does not change because of a rollback control.

Record the repository-only subcheck as not tested if no such offer exists.
Restore the original control values.
Restart the coordinator.
Repeat checks 1 and 2.

## Record acceptance

Record the deployed commits and ticker generation privately.
Record pass, fail, and not-tested results for each check.
Report failures without credentials or deployment addresses.
Close issue #279 only after the owner accepts the alpha results.
