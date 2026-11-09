# Issue 279 requirement proposal

Status: Approved. Implementation is in progress.
The second review supersedes the first review's base-model source order.
This document proposes changes to `docs/requirements/catalog.md`.
The executable design is in `issue_279_identity_prototype.py`.
The draft acceptance cases are in `issue_279_model_regressions.py`.
Production code does not import the prototype.
Prototype checks do not verify the production implementation.

## CATALOG-001 additions

An exact comparison alias must not verify an artifact hash.
An exact comparison alias must not establish runtime identity.
An exact comparison alias must not make different quantizations equivalent.

## Proposed CATALOG-003

### CATALOG-003: Exact comparison identity and source labels

MUST: Use a catalog model ID as the comparison identity.
Resolve local models through exact source IDs or reviewed aliases.
Use the same resolution path for offers and reference prices.
Do not join models through parsed name facets.
Keep each model without an exact identity as a separate IE entry.
Keep facets typed.
Keep unknown facet values distinct from known values.
Use source labels for display.
Permit provider-reported repositories to select a comparison row for browsing.
Label those identities as reported by the provider.
Label reviewed aliases as reviewed aliases.
Show artifact verification as a separate state.
Do not present a reported identity as a reviewed identity.

- Principle: P2, P3, P8, P9
- Proposed initial status: not-implemented
- Verified by: none
- Issue: #279

### CATALOG-004: Raw-source comparison history

MUST: Use the exact comparison resolver for historical groups.
Keep historical observations under their raw source IDs.
Derive historical groups from the current exact identity map.
Return the catalog generation with history.
Reject a legacy history lookup that selects multiple model identities.
Preserve separate raw-source price series within a comparison group.

- Principle: P2, P3, P8, P9
- Proposed initial status: not-implemented
- Verified by: none
- Issue: #279

### CATALOG-005: Declared quote kinds

MUST: Declare each quote as a catalog quote or an endpoint quote.
Show the kind in the offer table.
Exclude catalog quotes from provider counts and endpoint depth.
Preserve quote source, rates, route, observation time, quantization, and history.
Do not infer the kind from provider or route labels.

- Principle: P2, P3, P8, P9
- Proposed initial status: not-implemented
- Verified by: none
- Issue: #279

### CATALOG-006: Structured model metadata and quantization labels

MUST: Keep the conversion source separate from base-model lineage.
Do not resolve comparison identity from lineage.
Preserve bounded structured source and display metadata.
Use one shared quantization map.
Keep unknown quantization distinct from a known file type.

- Principle: P2, P3, P8, P9
- Proposed initial status: not-implemented
- Verified by: none
- Issue: #279

These statuses describe the proposed requirements before implementation.
Each phase introduces its requirement with its code.
Set its status to implemented only after its production checks pass.
Only production test paths may appear in Verified by.
The draft cases are not production verification.

## Proposed implementation

### One exact identity map

Keep each published `models[].id` as its catalog model ID.
Add reviewed, namespaced `source_ids` to each catalog model.
Each source ID has a `source` and a raw `model_id`.
Declare these fields in the coordinator snapshot schema.
The current schema ignores fields that it does not declare.
Validate namespace, identifier length, and mapping uniqueness before installation.
Keep the existing reviewed model-name `aliases`.
Treat a native catalog source ID as an exact source.
The ticker must declare that native source in `source_ids`.
Do not copy an ID into a different source namespace.
Do not remove a publisher prefix or a filename suffix to resolve an identity.
Reject a source ID or alias that maps to multiple catalog models.
Keep routes and quantizations on the offer.

For example, an OpenRouter ID does not establish a Hugging Face repository ID.
The publication must declare that relation.
The ticker alias manifest remains the place for reviewed name aliases.
A new reviewed source manifest will hold relations between source namespaces.
Existing publications without `source_ids` retain their exact aliases.
They do not gain inferred repository mappings.

Add one coordinator resolver for the validated publication.
Use that resolver in `ticker_catalog.py` and `reference_pricing.py`.
Use it in both market and reference-price routes.
Remove the parsed `canonical_id` from grouping decisions.
Remove family-only matches from both legacy reference paths.
Do not present a broad reference alternative as the same model.
Keep catalog quote eligibility separate from identity resolution.

### Local source order

Resolve the model through these sources in order:

1. The conversion source repository.
2. The original provider repository ID.
3. A reviewed exact model-name alias.

Each repository must resolve through the namespaced exact identity map.
Continue to the next source if the map has no match.
Read the conversion source from `general.source.huggingface.repository`.
Also accept a supported `general.source.url`.
Both fields identify the repository used for conversion.
Reject conflicting conversion source fields as ambiguous.
The existing provider reader already copies the repository field to `repo_id`.
Use `capabilities.model_repo_id` when the provider supplied it.
Otherwise, use `model_identity.repo_id`.
This order preserves the provider agent's explicit repository option.
Do not substitute `model_capabilities.model_repo_id` from capability resolution.
That resolver can follow a repository card to another base model.
It serves a different purpose.

Never use `general.base_model.*` for comparison identity.
Those fields describe lineage.
They can name a Base model when this artifact is an Instruct model.
They can name an ancestor of a fine-tune.
The number of lineage records does not change identity resolution.
Use lineage only for a separate "Based on" label.
Record the selected identity source with the comparison ID.
Record conflicting lower-priority sources for diagnosis.
Do not change artifact verification flags.

The provider supplies both repository reports and GGUF metadata.
An exact source match permits comparison browsing.
It does not verify the provider's artifact or runtime.
Return `identity_source` and `identity_trust` on each IE offer.
Use these identity sources: conversion source, provider repository, reviewed alias, or standalone.
Use these trust labels: reported, reviewed, or unmapped.
Label both repository source types as reported by the provider.
Only the reviewed alias path has the reviewed label.
Show the artifact verification state beside these labels.
Do not derive artifact verification from a comparison match.
Do not describe a shared row as verified model equivalence.

Apply model-level identity fields only to the model that they describe.
Do not apply one identity record to every advertised model.
For providers with multiple models, require an exact per-model record.
Use standalone entries for models without that record or a reviewed alias.

The standalone ID has this form: `ie/<provider>/<model>`.
Encode each component separately.
Use the registered provider ID and the original advertised model name.
Do not use a parsed facet or `unknown` as a component.
An empty name cannot merge entries from different providers.
Keep the unmodified name for provider routing.

### Typed display facets

Replace name-derived identity keys with a facet result.
Use structured metadata before a name fallback.
Use facets for display, search, and filtering only.

| Facet | Type | Unknown value |
| --- | --- | --- |
| `family` | Normalized string label for search | `null` |
| `release` | String label | `null` |
| `total_parameters` | Nonnegative integer count | `null` |
| `active_parameters` | Nonnegative integer count | `null` |
| `variant_tags` | Set of string labels | `null` |
| `quantization` | Reported string label; shared normalization in phase 4 | `null` |

Counts use parameters, not billions.
Convert a size label to a count before filtering.
Keep the original size label for display.
A mixture-of-experts label supplies an estimated total.
Record that the estimate came from a label.
Do not describe it as a measured tensor count.
Keep active parameters separate from total parameters.
Use total parameters for the existing size filter.

Serialize a tag set as a sorted list of unique strings.
Token order must not change the tag set.
An explicit `base` tag means base.
A missing tuning label means unknown.
An explicit empty structured tuning label produces an empty set.
Do not replace either value with `base`.

Use this display order:

1. The catalog `name`.
2. GGUF `general.basename`, with `general.version`, `general.size_label`, and `general.finetune`.
3. The original advertised name.

Keep catalog and GGUF labels as supplied.
Place the GGUF finetune label after the size label.
Keep its spelling, capitalization, and separators.
An Instruct model and a Base model must retain distinct display labels.
For the advertised fallback, replace separators with spaces only.
Do not split mixed tokens such as `R1`, `4o`, or `v0.3`.
Do not change capitalization.
Do not reconstruct the display name from numeric facets.
Do not remove artifact tokens from an advertised label.

Use the name parser only for total and active parameter counts.
Take release and variant tags from structured fields.
Take family from the catalog field first.
Then match the advertised name against reviewed family labels.
Build that list from the family fields in the published catalog.
Refresh the list with each new catalog generation.
Use the GGUF basename only for display.
It can include the release and does not define a search family.
Compare family labels without case.
Return one trimmed, casefolded family value for search.
Case variants of one reviewed label represent one family.
The fallback must match complete labels.
Do not treat the first advertised token as the family.
A publisher prefix can occupy that position.
Keep family unknown if the fallback has no unambiguous match.
Do not require a vendor or product-line dictionary.
Do not infer tuning semantics from advertised tokens.
A facet error must not affect the comparison ID.

### Structured GGUF fields and shared quantization

Include this work in the implementation scope.
Add a bounded `gguf` object to `model_identity`.
The provider change will land with the approved requirement.
The prototype demonstrates the proposed extraction fields now.
Read these existing metadata fields:

- `general.basename`
- `general.version`
- `general.size_label`
- `general.finetune`
- `general.source.huggingface.repository`
- `general.source.url`
- `general.base_model.count`
- `general.base_model.<index>.name`
- `general.base_model.<index>.basename`
- `general.base_model.<index>.version`
- `general.base_model.<index>.repo_url`

Keep the conversion source separate from base-model lineage.
Keep lineage separate from the artifact `repo_id`.
Keep `filename`, `file_hash`, and `architecture` separate.
Do not infer a repository from `general.name`.
Accept only explicit repository IDs or supported repository URLs.
Do not fetch a URL supplied in GGUF metadata.
Limit the number of base-model records to 16.
Limit each metadata string to 512 characters.
Treat absent, invalid, or truncated metadata as unknown.
Validate these fields before a coordinator uses them.
Allowlist any fields that enter the public catalog.
Do not export local file paths.

Move the GGUF file-type map to `shared/model_quantization.py`.
Use that map in the provider reader and the facet parser.
Normalize existing `F16` and `F32` reports to `FP16` and `FP32`.
Keep unknown file types as unknown.
Do not assume file type zero when the metadata is absent.
Test every shared file-type entry and both legacy spellings.
Quantization normalization does not resolve a comparison identity.

### History derived from raw IDs

Do not add a `legacy_family_key` column.
Do not rewrite historical prices, raw IDs, or observation times.
The existing `(source, model_id)` is the durable identity input.
Keep the existing `family_key` only for legacy lookup discovery.
Do not use it to group observations.

Resolve each raw source ID through the current published identity map.
Read each source and model as a separate price series.
Do not collapse multiple raw models into one price per provider and day.
For an unresolved source, allow an exact raw-source history request.
Do not create a same-model comparison for that source.

Return the catalog `generation` with derived history.
Derive groups on read.
Do not persist a second set of identity keys.
This implementation has no derived-group cache.
Do not add cache fields or version rules before a cache exists.

Add a `(source, model_id, fetched_at)` index for bounded history reads.
Make that index migration repeatable.
Keep prices and observation times unchanged.
An identity-map change can regroup old observations.
Return the map generation that produced the response.
Do not claim to reconstruct the identity map from an earlier date.

Add an exact catalog `model` query for comparison history.
Also accept an exact `source` and `model_id` query for raw history.
Keep the existing `family_key` query as a compatibility lookup.
Find the raw IDs represented by that old key.
Resolve each candidate through the current identity map.
Return history only if those candidates select one exact group.
Return HTTP 409 with explicit model choices if they select multiple groups.
An unresolved raw source remains a distinct choice.
Do not select the cheapest or newest candidate.
After an unambiguous lookup, read all observations for its exact group.
This includes observations written under other old parser keys.
Bound history reads to the existing retention period.

### UI and rollout

Use catalog model IDs as UI selection keys.
Resolve live IE details through exact catalog offer IDs.
Remove substring and fuzzy offer joins.
Read typed counts for size filtering when the API supplies them.
Use name facets only as a display fallback.
Retain the original advertised name for model selection and routing.

Declare `quote_kind: "catalog" | "endpoint"` in the coordinator schema.
Use `endpoint` as the compatibility default for old publications.
The ticker must emit the kind for catalog, endpoint, and direct quotes.
Do not infer the kind from provider or route names.
Label catalog quotes in the offer table.
Exclude them from provider counts and endpoint depth.
Retain their source, rates, observation time, and history.
Retained offers after a failed collection must keep their original kind.
For old records, let the ticker assign kinds from its own offer ID contract.
The exact ID created by the catalog offer factory identifies a catalog quote.
The endpoint factory adds the endpoint tag to that ID.
Reviewed direct-card IDs identify direct endpoint quotes.
Reject an old record with an unknown origin before publication.
Do not classify it from provider or route display names.
Do not change their observation times during that backfill.

Deploy the coordinator and web changes before the ticker changes.
Publish a new ticker snapshot after both deployments.
Check the Llama model on alpha.
Confirm that unmatched Qwen has a separate IE entry.

## Release phases

Each phase has a separate implementation change.
Each phase must deploy and revert without a later phase.
Keep the completed earlier phases when reverting one phase.
Run the production checks for that phase before deployment.
Preserve the shared exact-ID resolver contract during a feature rollback.
Keep published source mappings available to the history reader.
Do not remove an API that another deployed phase uses.

| Phase | Requirement and initial status | Scope | Planned production checks |
| --- | --- | --- | --- |
| 1 | CATALOG-003: not-implemented | Exact resolver, source labels, display-only facets, UI joins, reported identity labels, removal of family-only matches | `tests/test_comparison_identity.py`, `tests/test_model_facets.py`, `tests/test_reference_pricing.py`, `web/src/lib/catalog.test.mjs`, `web/src/lib/model-size.test.mjs` |
| 2 | CATALOG-004: not-implemented | Raw-source history, query changes, generation in responses, repeatable index migration | `tests/test_reference_price_history.py`, `tests/test_store_read_consistency.py` |
| 3 | CATALOG-005: not-implemented | Quote kind in coordinator, web, and ticker | `tests/test_ticker_catalog.py`, `web/src/lib/catalog.test.mjs`, ticker `tests/test_exchange_snapshot.py` |
| 4 | CATALOG-006: not-implemented | GGUF source, display, and lineage fields; shared quantization map | `tests/test_model_identity.py`, `tests/test_model_quantization.py`, `tests/test_comparison_identity.py` |

These planned paths are not Verified by entries.
Add actual passing tests when each requirement becomes implemented.

### Phase 1

Use the current provider `repo_id` and explicit repository option.
The existing reader already extracts the conversion repository when present.
The resolver accepts conversion source fields when a provider supplies them.
It must work without the new fields planned for phase 4.
Keep catalog source labels and existing advertised labels available.
Use typed counts when available.
Retain numeric name fallback for the size filter.
Add namespaced source mappings to the publication contract.
Deploy the coordinator and web before the compatible publisher change.
Keep the exact name aliases available for older publications.
Build the family fallback list from the current published family fields.
Replace that list when the catalog generation changes.
Test reported identity labels independently of artifact verification.
Test that an Instruct artifact cannot select a Base row through lineage.

Use two phase 1 rollback controls.
The selected rollback preserves the shared resolver API.

| Part | Rollback state | Effect |
| --- | --- | --- |
| Conversion and provider repository grouping | `allow_repository_reports=false` | Ignore repository reports for IE comparison grouping. Use a reviewed alias or a standalone entry. |
| Enriched IE display | `enriched_display=false` | Show the advertised IE label with separators replaced by spaces. |
| Resolver interface | Keep | Exact source lookup and history calls remain available. |
| Reviewed exact aliases | Keep | Reviewed local models keep their catalog comparison rows. |
| Published source-ID map | Keep | The history reader resolves the same raw source IDs. |
| Raw observations and history queries | Keep | History data and phase 2 responses remain unchanged. |

These controls do not change published catalog source labels.
Set `IE_REPOSITORY_COMPARISON=0` to disable reported repository grouping.
Set `IE_ENRICHED_MODEL_DISPLAY=0` to disable enriched IE display.
They do not change typed parameter counts or artifact verification.
They do not return to parsed identity keys or fuzzy joins.
Phase 1 must not require the history index or quote kind.
It can run without the expanded provider metadata.
The draft rollback case tests both controls.
It verifies that repository-only models become standalone.
It verifies that reviewed aliases still select catalog rows.
It verifies that raw-source history and catalog generation stay unchanged.
Move this case to `tests/test_comparison_identity.py` when phase 1 lands.
Run it against the phase 2 history contract when phase 2 lands.

### Phase 2

Deploy the history reader and exact query contract.
Add the history index without rewriting data.
Test old and new observations under one exact raw source ID.
Test ambiguous old keys and separate source series.
Test that the response reports the current catalog generation.
Test the index migration twice.

Revert the history endpoint change to roll back phase 2.
Keep the additive index and all raw observations.
Phase 1 can continue without phase 2.
No later phase may require the new history query.

### Phase 3

Deploy the coordinator quote schema before the publisher emits the field.
Deploy the web labels and counts with that schema.
Then deploy the ticker field and backfill of old retained records.
Test the compatibility default and invalid quote kinds.
Test endpoint counts and catalog quote labels.
Test retained quote kind and unchanged observation times after source failure.
Test source links, route labels, and separate quantization details.

Revert the quote-specific publisher and UI changes to roll back phase 3.
An older consumer ignores the additive field.
Keep the phase 1 resolver and phase 2 history reader.
The phase does not require expanded GGUF fields.

### Phase 4

Deploy support for the optional GGUF fields before updating provider reports.
Then deploy the provider metadata reader and shared quantization map.
Test conversion source URLs and repository IDs.
Test that lineage cannot change a comparison ID.
Test all shared file types and legacy spellings.
Test absent metadata as unknown.
Test metadata bounds and unchanged artifact verification.

Revert the metadata reader and map consumers to roll back phase 4.
Older reports continue through `repo_id` or reviewed aliases.
Keep phases 1 through 3 deployed.

## Cleanup when requirements land

Move the relevant draft cases into production tests for each phase.
Replace their prototype imports with production code.
CI does not run files in `docs/design`.
Do not cite those draft files in Verified by.
When all relevant requirements land, delete the prototype and draft cases.
Delete the retained review sections from this proposal.
Keep the final approved design and phase guidance as needed.

## Review disposition

| Review item | Rework |
| --- | --- |
| R1 | Requirements use general rules. Display uses source labels and structured facets. |
| R2 | Catalog IDs and one namespaced exact resolver replace parsed joins. |
| R3 | Counts are integers. Tags are sets. Unknown is separate from base. |
| R4 | Raw-source history replaces key rewriting. Ambiguous old keys require a choice. |
| R5 | GGUF fields and one shared quantization map are in the implementation scope. |
| S1 | Conversion sources replace the withdrawn base-model order. Lineage never resolves identity. |
| S2 | Source labels set display. Numeric parsing preserves mixed tokens and capitalization. |
| S3 | Repository reports select browsing rows with a reported label. Artifact verification stays separate. |
| S4 | Four changes have separate requirements, tests, deployment, and rollback steps. |
| S5 | Derived cache fields and versions are removed. History returns catalog generation. |
| S6 | Draft files are excluded from Verified by and removed when production requirements land. |
| T1 | GGUF display includes the supplied finetune label after the size label. |
| T2 | Catalog family or reviewed label matches produce one normalized search family. Basename is display only. |
| T3 | CATALOG-001 adds only alias limits. CATALOG-005 owns quote rules and provenance. |
| T4 | Rollback controls revert repository grouping and IE display. Exact maps, aliases, resolver APIs, and history remain. |

The draft cases cover all original parser examples as facets and display.
They cover new labels without a vendor dictionary.
They cover conversion sources, provider repositories, and reviewed aliases.
They prove that Base lineage cannot select an Instruct model's comparison ID.
They preserve the four mixed-token examples from the second review.
They test source labels and separate reported and reviewed identity states.
They keep Instruct and Base GGUF display labels distinct.
They keep release-bearing GGUF names in one reviewed search family.
They verify that phase 1 rollback retains exact aliases and raw-source history.
They keep similar artifact names separate without an explicit relation.
They keep unparseable names and different providers separate.
They reopen a database with colliding old keys.
They verify that changed facet keys do not lose or mix price history.
They preserve separate source series under a reviewed catalog model.

The current plan above supersedes the source order in the retained reviews.

## Third review: changes required

Reviewer status: Approve after T1, T2, T3, and T4.

The rework resolves S1 to S6.
The draft cases pass: `python -m pytest docs/design/issue_279_model_regressions.py -q --rootdir docs/design` reports 38 passed.

### T1. Required: keep the variant in the GGUF display name

The GGUF display order uses `general.basename`, `general.version`, and `general.size_label`.
It does not use `general.finetune`.
The draft case shows the result.
A model with finetune `Instruct-Coder` displays as `NewFamily 2.1 30B-A3B`.
An Instruct GGUF and a Base GGUF of one model then get the same label.
Issue #279 reports this variant loss.

Make these changes:

- Add `general.finetune` to the GGUF display order, after `general.size_label`.
- Keep the finetune label as supplied.
- Change the draft case to expect `NewFamily 2.1 30B-A3B Instruct-Coder`.
- Add a case with an Instruct GGUF and a Base GGUF of one model. The two display names must be different.

### T2. Required: do not use the GGUF basename as the family

The proposal takes `family` from the catalog field or the GGUF basename.
The llama.cpp converter usually puts the release in the basename.
For example, `Qwen2.5-7B-Instruct` usually has the basename `Qwen2.5`.
A Qwen3 model usually has the basename `Qwen3`.
Qwen2.5 and Qwen3 then get different families.
Issue #279 requires that family search grouping stays the same.
The case of the label also changes between sources.
The draft case returns `NewFamily`.
A catalog family can be lowercase.

Make these changes:

- Use the GGUF basename only as a display label.
- Take `family` from the catalog field first.
- Then use the reviewed family labels that the fallback already uses.
- Compare family labels without case.
- Return one normalized family value for search.
- Keep family unknown if no source gives an unambiguous match.
- Change the draft case that expects family `NewFamily` from the basename.
- Add a case where Qwen2.5 and Qwen3 GGUFs have one search family.

### T3. Required: remove the duplicate quote kind rules

The section "CATALOG-001 additions" still contains the quote kind rules.
CATALOG-005 now contains the same rules.
Two requirements must not state one rule.

Make these changes:

- Keep only the three alias limits in "CATALOG-001 additions".
- Keep the quote kind rules in CATALOG-005 only.
- Keep "Preserve the source, route, observation time, and quantization of each quote" in CATALOG-005 only.

### T4. Required: clarify the phase 1 rollback

The phase 1 rollback text reverts phase 1.
It also keeps the phase 1 resolver, the exact aliases, and the source ID map.
A reader cannot tell which parts are reverted.

Make one of these changes:

- List the parts that the rollback reverts and the parts that it keeps. For example: revert the provider repository grouping and the enriched display; keep the resolver interface, the exact aliases, and the source ID map.
- Or state that a phase 1 rollback also reverts the resolver, and that phase 2 must then be reverted first.

Add a draft case or a planned production check for the selected rollback mode.

## Second review: changes required

Reviewer status: Approve after the blocking change and the required changes.

The rework fixes the foundation.
Keep the exact resolver, the display-only facets, and the raw-source history.
The draft cases pass: `python -m pytest docs/design/issue_279_model_regressions.py -q --rootdir docs/design` reports 25 passed.

### S1. Blocking: do not use the GGUF base model for identity

The first review recommended this order: GGUF base model, provider `repo_id`, reviewed alias.
That order is wrong.
The reviewer withdraws it.

`general.base_model.*` names the model that this model came from.
llama.cpp conversion copies it from the `base_model` field of the model card.
It does not name this model.
For example, the card for `meta-llama/Llama-3.2-1B-Instruct` lists `meta-llama/Llama-3.2-1B` as its base.
An Instruct GGUF then resolves to the Base model.
A fine-tune such as `Hermes-3-Llama-3.1-8B` resolves to Llama 3.1 8B.
The proposal rejects `model_capabilities.model_repo_id` for the same reason.

Change the local source order to:

1. The conversion source repository: `general.source.huggingface.repository` or a supported `general.source.url`. `_extract_repo_id` already reads the first field into `repo_id`.
2. The original provider repository ID.
3. A reviewed exact model-name alias.

Do not use `general.base_model.*` to resolve a comparison identity.
You can show it as lineage, for example "Based on X".
Change `test_structured_source_priority_and_multiple_bases`.
The test must show that a base-model match never selects the comparison identity.
Add a test where an Instruct GGUF has a Base model in `general.base_model.0` and resolves to the Instruct catalog model, or to a standalone entry.

### S2. Required: use source labels for display

The prototype fallback degrades common names:

| Input | Family | Release | Display |
| --- | --- | --- | --- |
| `Meta-Llama-3.1-8B-Instruct` | meta | 3.1 | Meta Llama 3.1 8B Instruct |
| `DeepSeek-R1-Distill-Qwen-7B` | deepseek | 1 | DeepSeek R 1 Distill Qwen 7B |
| `gpt-4o-mini` | gpt | 4 | Gpt 4 O Mini |
| `Mistral-7B-Instruct-v0.3` | mistral | 0.3 | Mistral 7B Instruct V 0.3 |

The first token is not always the family.
A publisher prefix, such as `Meta`, becomes the family.
The tokenizer splits mixed tokens such as `R1`, `4o`, and `v0.3`.
Capitalization changes labels such as `GPT`.

Make these changes:

- Take the display name from a source label, in this order: catalog `name`, GGUF `general.basename` with `general.version` and `general.size_label`, then the advertised name.
- For the advertised name, replace separators with spaces only. Do not split tokens. Do not change case.
- Use the parser only for numeric facets: total parameters and active parameters.
- Take `family` from structured data first, such as a catalog field or the GGUF basename. Use the parser only as a fallback.
- Keep mixed letter-and-digit tokens complete.
- Add the four names above to the draft cases.

### S3. Required: state the trust level of a provider-reported repository

The provider reports `repo_id` itself.
An operator approves a reviewed alias.
Under this proposal, any provider can report a repository and appear in that comparison row.
That can be acceptable for browsing.
State that decision in CATALOG-003.
Show the identity source on each IE offer, for example "reported by provider" or "reviewed alias".
Show the artifact verification state separately.
Do not show a reported identity as a reviewed identity.

### S4. Required: release in phases

The scope is too large for one change.
Release it in these phases:

1. The exact resolver, display-only facets, UI joins, and removal of family-only matches.
2. History by raw source ID, the history query changes, and the index migration.
3. `quote_kind` in the coordinator, the web, and the ticker.
4. GGUF `general.*` fields in `model_identity` and the shared quantization map.

Make each phase deployable and revertible alone.
Give each phase its own tests and requirement status.

### S5. Required: remove the cache versioning

The first implementation derives groups on read.
It has no cache.
Remove `identity_version`, `cache_key`, and the version-based cache rules.
Add them when a cache exists.
Keep the catalog `generation` in history responses.

### S6. Minor

- When the requirement lands, delete the prototype, the draft cases, and both review sections. Move the tests into `tests/`.
- CI does not run files in `docs/design`. Do not list them in **Verified by**.

The original review is retained below.

## Review: rework required

Reviewer status: Not ready for owner approval.

Keep these parts of the proposal:

- The `catalog` and `endpoint` quote kind. The kind is declared, not inferred.
- The three limits on exact comparison aliases.
- Catalog model IDs as UI selection keys.
- The removal of substring and fuzzy joins in the UI.
- The removal of reference price matches by family alone.

Rework the model identity part.
The proposal fixes the parser cases from #279.
It keeps name parsing as the source of model identity.
That foundation does not scale, and it conflicts with CATALOG-001.

### R1. Do not hardcode vendor knowledge in requirements

"Keep CodeLlama in its own family" names one model.
State the general rule instead, for example "match the longest family token".
"Model line" has no definition.
A parser can find a model line only through a vendor word list, such as `sonnet` and `opus`.
Each new vendor or product line then needs a code change.
`FAMILIES` stays a manual dictionary.
Mixtral works only when a person adds it.

### R2. Use one identity system

CATALOG-001 joins source IDs through explicit, exact, reviewed aliases.
The proposal keeps a second identity system: a comparison key that the parser derives from the name.
`test_quantization_and_publisher_do_not_change_comparison_key` gives `bartowski/Llama-3.2-1B-Instruct-Q4_K_M.gguf` and `meta-llama/Llama-3.2-1B-Instruct` the same key.
That is an automatic join based on the name.
Issue #279 says that only a reviewed alias can group these two models.
Reference prices still join through the parsed key.
So the rule against fuzzy joins applies to the catalog, but not to reference prices.

### R3. Use typed facets, not combined strings

- `size: "30B A3B"` combines total and active parameters. Store them as two numbers. Size filtering in #277 needs the numbers.
- `variant: "Coder Instruct"` is an ordered string. Store variants as a set of tags. Otherwise, a different token order gives a different key.
- `claude-sonnet-4.5-base` uses `base` as the default variant. `base` is a real variant: a model before instruction tuning. Use a separate value for "unknown".
- `"" -> "unknown-base"` puts every name that the parser cannot read under one key. This conflicts with "Keep each distinct model under a distinct key".

### R4. Make the history migration repeatable

A `legacy_family_key` column fixes one migration only.
The next parser change needs another column.
History reads through the legacy key return mixed data.
For example, `qwen-7b-instruct` mixes Qwen2.5 and Qwen3 history.
The `reference_prices` table already stores the raw `model_id`.
Treat the key as derived data.
Store a `key_version` with each row, or derive the group when you read.
Do not treat an old derived key as the source of truth.
Do not serve mixed legacy history as one model.

### R5. Use structured identity data that already exists

The provider agent already sends `model_identity`.
It includes `repo_id`, `filename`, `file_hash`, and `architecture` (`inference_exchange/provider/model_identity.py`).
GGUF files can also contain `general.basename`, `general.version`, `general.size_label`, `general.finetune`, and `general.base_model.*`.
The agent reads only `general.name` now.
Upstream catalogs have stable IDs, such as OpenRouter and Hugging Face slugs.
Use name parsing only when no structured source exists.

Also remove the duplicate quantization table.
`model_identity.py` reports `F32` and `F16`.
`model_catalog.py` maps the same file types to `FP32` and `FP16`.
Use one shared table.

### Required design

1. A comparison identity is a catalog model ID.
2. A local model gets a comparison identity from exact sources only. Use this order: GGUF base model repository, provider `repo_id`, reviewed alias. If no exact source exists, keep the model as a standalone `ie/<provider>/<model>` entry.
3. The parser produces facets only: family, release, total parameters, active parameters, variant tags, and quantization. Use facets for display, search, and filters. Do not use facets to join offers or reference prices. A wrong facet can then mislabel a row, but it cannot merge two models.
4. Facets are typed. Sizes are numbers. Variants are a set. "Unknown" is a separate value from `base`.
5. Derived keys have a version. The system can rebuild them from stored raw IDs.
6. Reference prices join through the same exact ID or alias path as the catalog.
7. Requirements state general rules. Requirements do not name specific models.

### Proposed CATALOG-003 direction

MUST: Derive a comparison identity only from an exact source ID or a reviewed alias.
Do not join offers or reference prices through parsed name facets.
Keep a model without an exact identity as a standalone IE entry.
Keep parsed facets typed.
Keep unknown facet values distinct from known values.
Keep history grouped by raw source ID and rebuildable after a parser change.

### Rework tasks

- Rewrite CATALOG-003 to the direction above.
- Move the identity cases in `issue_279_model_regressions.py` to facet and display tests.
- Change `test_quantization_and_publisher_do_not_change_comparison_key`. It must show that the two models join only when a GGUF base model, `repo_id`, or reviewed alias links them.
- Add a test that two unparseable names stay distinct.
- Add a test that a parser change does not lose or mix stored history.
- Replace the `legacy_family_key` migration with a versioned or derived key plan.
- Add the GGUF `general.*` identity fields to `model_identity`, or record why they are out of scope.
- Keep the quote kind section and the deployment order unchanged.
