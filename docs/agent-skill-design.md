# AppOrbit Agent skill design

## Decision

Keep a portable, read-only skill in `skills/apporbit/`. Its helper reads the run index and immutable ranking snapshots directly from GitHub's `data` branch, with a local `v1` directory option for testing. It uses the published website only when names, app metadata, or a page for human inspection help the answer. It does not need an API key or an MCP server. A future MCP wrapper can expose the same read operations if agents need structured tool discovery.

The skill bundles a complete copy of `docs/data-format.md` at `references/data-format.md`. Its instructions require the agent to read that copy before interpreting records. A test keeps the two copies identical at release time, so an installed skill does not depend on the repository checkout or ask the end user to read technical documentation. The reference links to the published schemas when exact field types are needed. If the installed copy disagrees with the actual data, the agent checks the latest official remote format and matching schemas, then uses documented raw records when the helper is incompatible. Unresolved mismatches stop the analysis.

The skill's `metadata.version` is its own release version, independent of the application version and the dataset's `schemaVersion` or `generatedAt`. Update it with each skill release and use the same version in the release tag or any future npm distribution. The skill bundles the repository's MIT notice; published data retains its separate ODbL notice.

## Why a derived view is needed

`v1/manifests/latest.json` answers only the newest *valid* snapshot per target. Historical comparisons need run manifests. Asking every agent to enumerate the GitHub tree and download each run would be slow and would use GitHub API rate limits. The collection workflow generates one replaceable view in the same `data` commit as the source records:

- `v1/views/agent-index-v1.json`: compact run outcomes and snapshot paths, including failed and partial outcomes for coverage analysis.
The index builder reads only the published namespace after the migration marker exists. Historical snapshots and run manifests remain the ranking evidence. The index can be rebuilt from them. It is about 0.5 MB for the current 72-run history. Full metadata catalogs would add about 35 MB, so they are outside the published index. The skill instead uses the existing website `api/catalog/<store>/<market>.json` and `api/apps/<store>/<market>/<appId>.json` files when it needs metadata.

## Query behavior

The helper offers coverage, rankings, movers, app lookup, and text search. It selects a complete `valid` chart by default and exposes `partial` only on explicit request for rankings. Movers compare two complete observations of exactly the same target. It returns raw snapshot URLs, capture times, market dates, status, and observed top-N count. When relevant, it also returns direct website URLs for the selected chart dates and apps. Website metadata includes its own `observedAt` because it can be older than the chart or lag behind the data branch. A metadata request failure does not prevent a ranking calculation.

## Operational boundary

Collection can have partial failures. Index generation runs before the data commit even when the quality gate fails, so the committed index reflects the preserved run manifest. If index generation itself fails, the data commit preserves the source records but excludes incomplete index changes, and the workflow reports failure. The prior or missing index must not be treated as current. The skill reports a missing index instead of substituting website rankings.

The first public index appears when the updated collection workflow next runs. Until then the skill's GitHub default source lacks `agent-index-v1.json`; a local published `v1` directory can be indexed with `pnpm agent:index`. The website is `https://apporbit.ooxxz.com/`; its chart, app, trend, and data routes accept specific links documented in the skill. A website page may not select the exact immutable snapshot when several observations share a market date, so raw snapshot URLs remain the citation for precise ranking claims.
