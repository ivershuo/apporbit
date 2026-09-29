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

## Automatic promotion to published data

The probe history was promoted on 2026-09-28 in data commit `fefa501`. The
`Migrate probes to publish` workflow also supports manual reruns for verification
and recovery. No schedule pause, configuration edit, manual file move, or pointer
update was needed.

The migration and all collection workflows share the same concurrency group. In an
isolated directory, the migration validates the complete `data` branch, promotes all
probe snapshots, quarantine files, run manifests and metadata events, reconstructs
the metadata deduplication state and valid-only latest pointers, and builds the site.
Snapshot and metadata bytes, IDs, timestamps, errors, and quality statuses are retained.
Promoted run manifests update only their target publication modes and snapshot paths.
Conflicts, malformed records, missing references, source changes and build errors stop
publication. Unknown probe files and symlinks also stop migration rather than being lost.

Only after verification does one atomic Git push update `data` and create the backup
branch `data-backup/probe-to-publish-v1` at the original commit. A concurrent write or
backup conflict rejects the entire push. The migration report and source/output file
checksums are stored at `v1/migrations/probe-to-publish-v1.json`.

This marker is the publication switch: collectors automatically use `publish`,
verified capability entries become `supported`, and website data links point at the
published paths and data-branch capabilities. The checked-in probe configuration
remains the baseline for new, unmigrated data directories. Explicit probe writes to
the published directory are
rejected before modifying it; use a separate directory for future experiments.
Existing schedules, workflow names, quality gates, and page behavior otherwise remain
unchanged. Successful migration triggers the existing Pages deployment workflow.

Rerunning migration verifies the published history and builds the site without another
data commit or backup. A Pages deployment failure does not undo or repeat the migration;
the next collection completion or a migration rerun triggers deployment again. If
rollback is required, restore the **entire** pre-migration tree from the backup in a
new `data` commit; removing only the marker would mix publication modes. The workflow
does not force-push or rewrite data history.

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
The browser loads a compact bootstrap index first, then fetches ranking metadata from
store-and-market catalog shards. Full descriptions and other heavy fields are emitted
as per-app detail files and loaded only when an app page is opened. Dataset-wide charts
use a small precomputed statistics file instead of downloading the complete catalog.

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

## AI Agent access

The read-only [AppOrbit skill](./skills/apporbit/SKILL.md) queries the public GitHub `data` branch directly for chart rankings, changes, and coverage. When useful, it reads metadata and provides specific chart or app links from [the website](https://apporbit.ooxxz.com/). Its [design note](./docs/agent-skill-design.md) explains the sources and quality rules. The published run index is refreshed by the collection workflow; for a local published `v1` directory, run `APPORBIT_DATA_DIR=/absolute/path/to/v1 pnpm agent:index`.

Install the skill for Codex with `npx skills add ivershuo/apporbit --skill apporbit -g -a codex`. The same repository source can be installed for other supported agents by changing the `-a` value.

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
