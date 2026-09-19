# AppOrbit data format v1

All paths below are relative to the `v1/` directory on the repository's orphan `data` branch. JSON is UTF-8. Exact timestamps are UTC ISO 8601 strings ending in `Z`. `observationDate` remains the UTC calendar date for compatibility; `marketObservationDate` is the calendar date in `marketTimeZone` and is the date used by snapshot directory paths and daily chart views.

## Stability model

Published snapshots and run manifests are immutable. Writing different bytes to an existing immutable path is an error. Mutable manifests and derived views are replaceable and must be reconstructable from accepted snapshots.

Probe data lives below `probes/`. It is evidence used to validate coverage and reliability, not a supported public dataset, and cannot move a published latest pointer.

## Key paths

```text
v1/
  capabilities.json
  manifests/latest.json
  snapshots/<store>/<market>/<scope>/<chart>/YYYY/MM/DD/<UTC-token>.json
  runs/YYYY/MM/DD/<run-id>.json
  quarantine/...
  metadata/events/YYYY/MM/DD/<run-id>.ndjson
  probes/snapshots/...
  probes/quarantine/...
  probes/runs/YYYY/MM/DD/<run-id>.json
  probes/metadata/events/YYYY/MM/DD/<run-id>.ndjson
  schemas/snapshot-v1.schema.json
  schemas/run-v1.schema.json
```

## Snapshot semantics

- `valid`: complete enough to publish and eligible to update `latest`.
- `partial`: usable but shorter or degraded; retained without updating `latest`.
- `quarantined`: stored under a quarantine path because cross-run checks detected an implausible change.
- A parse error, duplicate App ID, non-contiguous ranking, or fewer than 20 usable entries is a target failure and creates no snapshot.

Rank entries deliberately contain only `rank` and `appId`. Metadata is stored separately so a name or icon URL change does not rewrite ranking history. Only source icon URLs are retained; image binaries and rendered charts are excluded.

## App metadata observations

Metadata change events are keyed by `(store, market, appId)` because ratings, prices, availability, and localized store copy can differ by market. Both adapters retain the shared identity fields and all useful store fields exposed by the collection sources:

- identity and discovery: app name, developer, developer ID, developer website, bundle ID, categories, primary genre ID, icon URL, store URL, summary, and full description;
- demand and reputation: install range and bounds, rating, ratings count, and reviews count;
- commercial model: numeric and formatted price, currency, free/paid status, in-app purchases, IAP range, and ad support;
- lifecycle and compatibility: release date, latest update time, version, minimum OS, content rating, download size, and supported languages.

Fields remain optional because the two stores expose different dimensions and individual listings may omit them. Ranking timestamps are recorded immediately after the chart response, before metadata enrichment. Apple metadata is enriched in batches through the iTunes Lookup API; Google Play metadata is fetched separately after its ranked list response. Failed enrichment leaves the ranking usable and adds a `metadata_enrichment_failed:*` validation flag.

## Run manifests

Every run records each selected target independently. One target failure does not cancel other targets. Consumers must use run manifests to distinguish a failed collection from an app being absent from a successfully observed chart.

The checked-in JSON Schemas are generated from the runtime Zod models. `pnpm schema:check` detects drift, and `pnpm schema:generate` intentionally refreshes generated schema artifacts after a model change.

## Licensing and third-party content

AppOrbit-owned database rights are licensed under ODbL 1.0. Individual content obtained from app stores or supplied by publishers and developers is not licensed by AppOrbit. See [`DATA-LICENSE`](../DATA-LICENSE) for the applicable scope and reuse requirements.

## Time display

Consumers should treat `capturedAt` as the canonical instant and may format it in the client's local time zone. Daily views should use `marketObservationDate`; `observationDate` remains the UTC date and must not be reinterpreted as a local date. Older snapshots without market fields fall back to their UTC observation date.
