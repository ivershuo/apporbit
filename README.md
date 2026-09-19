# AppOrbit

AppOrbit collects App Store and Google Play ranking observations and presents them as versioned data and a lightweight local website.

## What is included

- Ranking snapshots by store, market, category, and chart
- App metadata captured alongside ranking observations
- UTC capture times and market-local observation dates
- Run manifests, validation results, and generated JSON Schemas
- A local website for exploring charts, app details, trends, and coverage

Apple rankings use the Marketing Tools RSS feed with iTunes Lookup enrichment. Google Play collection is isolated behind a replaceable adapter. Collection runs in two explicit stages: every ranking response is timestamped, validated, and persisted before metadata enrichment starts. Google Play detail requests share a 3 requests/second limiter and are deduplicated by market and App ID within each run. App icons are stored as source URLs; image binaries are not included in the dataset.

## Requirements

- Node.js 22.12 or newer
- pnpm 10.21.0

## Setup and collection

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm collect:full
```

Collected data is written to `.local-data/v1` by default. `collect:full` runs the complete matrix in `config/targets.json`. Use `pnpm collect:full:strict` when any failed target should produce a non-zero exit code.

The `collect` command also accepts filters such as `--store`, `--market`, `--scope`, `--chart`, `--limit`, `--output`, and `--publication-mode`.

Scheduled collection accepts partial target failures. A run is considered usable when a
target produces either a `valid` or `partial` snapshot, and the GitHub workflow fails only
when fewer than 75% of selected targets are usable or the collector itself crashes. The
threshold is configurable through the workflow's `minimum_usable_ratio` input. Every
non-valid target remains visible in the run manifest and GitHub Step Summary. Use
`--fail-on-any-error` (or `pnpm collect:full:strict`) when strict all-target success is
required instead.

## Local website

After collecting data, start the read-only local server:

```bash
pnpm site:dev
```

Open <http://127.0.0.1:4180>.

To use another data directory:

```bash
APPORBIT_DATA_DIR=/absolute/path/to/v1 pnpm site:dev
```

Set `PORT` to override the default port.

## GitHub Pages

The `Deploy GitHub Pages` workflow builds the static website from `main` and reads
the versioned dataset from the orphan `data` branch. The generated artifact contains
static equivalents of the local `/api/*` responses and only the ranking snapshots
referenced by run manifests. Generated files are never committed to `main` or `data`.

To enable the first deployment, open **Settings → Pages** and change **Source** to
**GitHub Actions**, then run the workflow manually or push a website change to `main`.
Later collection workflow completions automatically rebuild the site with the latest
data. The generated links work both at `/apporbit/` and at a custom domain.

Build the same artifact locally with:

```bash
APPORBIT_DATA_DIR=/absolute/path/to/data-branch/v1 pnpm site:build
```

The output directory is `dist/pages`.

## Data layout

The repository uses `main` for source code and documentation. Dataset files can be published from the orphan `data` branch under `v1/`. See [docs/data-format.md](./docs/data-format.md) for paths, record fields, and time semantics.

## Repository map

- `config/targets.json`: collection matrix and publication mode
- `config/capabilities.json`: store and market capabilities
- `src/adapters/`: store integrations
- `schemas/`: generated data contracts
- `site/`: local data website
- `docs/data-format.md`: storage and consumer contract

## Licensing and data rights

AppOrbit source code, including the website and collection pipeline, is licensed under the [MIT License](./LICENSE).

Database rights owned by AppOrbit contributors, including rights in the database structure, selection, arrangement, normalization, validation, and AppOrbit-generated derived data, are licensed under the [Open Database License 1.0](./DATA-LICENSE).

The data may include third-party content such as app names, descriptions, artwork URLs, ratings, prices, and other store metadata. The ODbL does not grant rights in that content. Trademarks, artwork, store content, and other third-party material remain subject to the rights and terms of their respective owners. Reusers are responsible for determining whether their use of third-party content is permitted.

AppOrbit is not affiliated with or endorsed by Apple or Google.
