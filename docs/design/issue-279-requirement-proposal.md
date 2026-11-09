# Model comparison identity and rollout

Issue: #279.
The four implementation phases are complete.
[The catalog requirements](../requirements/catalog.md) define the required behavior.
Production tests verify each phase.

## Exact comparison identity

Use `models[].id` as the comparison identity.
Use one resolver for catalog offers, market rows, reference prices, and history.
The published `source_ids` map namespaced raw source IDs to catalog models.
Reviewed model-name aliases can map local advertised names to those models.
Reject ambiguous source mappings and aliases.
Do not infer a relation from matching text in different source namespaces.
Do not use parsed facets to join models.
Keep an unmapped local model as `ie/<provider>/<model>`.
Encode the provider and original model components separately.
Keep the original advertised name for inference routing.

Resolve local source claims in this order:

1. The GGUF conversion source repository or supported conversion source URL.
2. The original provider repository ID.
3. A reviewed exact model-name alias.

Use `capabilities.model_repo_id` when the provider supplied it.
Otherwise, use `model_identity.repo_id`.
Do not substitute the repository from capability resolution.
That resolver can follow base-model lineage.
Never use `general.base_model.*` to select a comparison identity.
A Base ancestor does not identify an Instruct model or a fine-tune.
Apply each identity record only to the model that it describes.

An exact reported repository permits comparison browsing.
It does not verify a file or a runtime.
Each IE offer declares `identity_source`, `identity_trust`, and `artifact_verification`.
Repository claims have the reported label.
Reviewed aliases have the reviewed label.
Keep artifact verification separate from both labels.

## Source labels and typed facets

Use this display order:

1. The catalog name.
2. GGUF basename, version, size label, and finetune label.
3. The original advertised name.

Preserve catalog and GGUF labels as supplied.
Keep the finetune label after the size label.
For an advertised fallback, replace separators with spaces only.
Preserve mixed tokens and capitalization.
Parse names only for numeric parameter counts.

| Facet | Representation |
| --- | --- |
| Family | Normalized string, or null |
| Release | Structured string label, or null |
| Total parameters | Integer count, or null |
| Active parameters | Separate integer count, or null |
| Variant tags | Sorted unique tags, or null |
| Quantization | Shared canonical label, or null |

Unknown tuning is distinct from an explicit Base tag.
Counts use parameters, not billions.
Use total parameters for size filtering.
A mixture-of-experts size label provides a label estimate.
Do not describe that estimate as a measured tensor count.

Take family from the catalog field first.
Build the reviewed fallback labels from family fields in the current publication.
Refresh that list with each catalog generation.
Match advertised names against those labels without case.
Return one normalized search value when the match is unambiguous.
Use the GGUF basename only for display.
It can include a release and does not define a family.
A facet error must not change comparison identity.

## Raw-source history

Keep observations under their raw `(source, model_id)` values.
Derive comparison groups from the current published source map.
Return the catalog generation with history.
Keep each raw source and model as a separate series.
Select the last actual observation per source, model, and UTC day.
Do not rewrite stored prices, raw IDs, or observation times.
The index on `(source, model_id, fetched_at)` is additive and repeatable.

`GET /v1/exchange/reference-prices/history` accepts one selector:

- `model` selects an exact catalog model.
- `source` and `model_id` select one raw source identity.
- `family_key` discovers the exact groups represented by a legacy key.

Return HTTP 409 with explicit choices if a legacy key selects multiple groups.
Do not select the cheapest or newest group.
After an unambiguous selection, include observations written under other old keys.
Limit reads to the retention period.
There is no derived-group cache or cache version field.

## Quote kinds

Each quote declares `quote_kind` as `catalog` or `endpoint`.
An older publication uses the endpoint compatibility default.
The ticker declares kinds at its collection factories.
It backfills old records from those factories' ID and origin contracts.
It does not classify quotes from provider or route display names.
It rejects records with unknown origins.
Backfill preserves original observation times.

Show catalog quotes and their source details.
Exclude them from provider counts, endpoint depth, charts, and headline savings.
Keep distinct serving offers visible.
Count a named provider once when it has multiple serving offers.
Keep zero rates distinct from unknown rates.
An IE cache setting of zero does not publish a special cache rate.
Cached tokens then use the input rate under the billing policy.
Require fresh quotes and matching known quantization and context for percentages.
Percentages compare listed token rates.
They do not compare total request bills.

## Structured GGUF metadata

The provider preserves bounded basename, version, size, finetune, and source fields.
It preserves base-model records separately as lineage.
The conversion source comes from `general.source.huggingface.repository` or a supported `general.source.url`.
The reader does not fetch a URL supplied in metadata.
Each structured string is limited to 512 characters.
The lineage list is limited to 16 records.
Missing or invalid values remain unknown.
Do not export local file paths.

The provider and facet parser use `shared/model_quantization.py`.
Its file-type map follows llama.cpp's `llama_ftype` enum.
It does not use tensor-type numbers as file-type numbers.
Normalize F16 to FP16 and F32 to FP32.
Keep missing, invalid, and removed file types unknown.
Preserve reported quantization alongside its normalized label.
Quantization normalization does not verify an artifact.

## Phases and deployment

| Phase | Requirement | Production checks |
| --- | --- | --- |
| 1: Exact identity and source labels | CATALOG-003 | `tests/test_comparison_identity.py`, `tests/test_model_facets.py`, `tests/test_reference_pricing.py`, web catalog and size checks |
| 2: Raw-source history | CATALOG-004 | `tests/test_reference_price_history.py`, Store read and concurrency checks |
| 3: Quote kinds | CATALOG-005 | `tests/test_ticker_catalog.py`, `tests/test_quote_contracts.py`, web catalog checks, ticker snapshot checks |
| 4: Structured metadata and quantization | CATALOG-006 | `tests/test_model_identity.py`, `tests/test_model_quantization.py` |

Deploy each phase separately.
Deploy coordinator support before the ticker publishes new fields.
Deploy the web labels with coordinator support.
Deploy support for optional GGUF fields before provider updates.
Publish a new ticker generation after its changes deploy.
Check mapped Llama offers and the standalone local Qwen offer on alpha.

Use these phase 1 rollback controls:

- Set `IE_REPOSITORY_COMPARISON=0` to disable reported repository grouping.
- Set `IE_ENRICHED_MODEL_DISPLAY=0` to restore advertised IE display labels.

Keep the resolver interface, reviewed aliases, and published source map.
Keep raw-source history available.
The rollback does not return to parsed keys or fuzzy joins.

Revert the phase 2 history endpoint change to roll back phase 2.
Keep the additive index and raw observations.
Revert quote-specific publisher and web changes to roll back phase 3.
Keep earlier identity and history contracts.
Revert the metadata reader and map consumers to roll back phase 4.
Older provider reports remain usable through repository claims or reviewed aliases.
