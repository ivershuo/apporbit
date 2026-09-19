import { AdapterRegistry } from "./adapters/index.js";
import { classifyGooglePlayError } from "./adapters/google-play.js";
import type { AdapterObservation } from "./adapters/types.js";
import {
  LatestManifestSchema,
  RunManifestSchema,
  SnapshotSchema,
  TargetSchema,
  targetKey,
  type AppMetadataObservation,
  type LatestManifest,
  type RankingEntry,
  type RunManifest,
  type RunTargetOutcome,
  type Snapshot,
  type Target
} from "./domain.js";
import { datedPath, snapshotPath, targetSlug, utcPathParts } from "./paths.js";
import { validateObservation } from "./quality.js";
import { sha256 } from "./hash.js";
import { DataStore } from "./storage.js";
import { calendarDateInTimeZone } from "./time.js";
import { COLLECTOR_VERSION, SCHEMA_VERSION } from "./version.js";

export interface RunOptions {
  outputRoot: string;
  targets: Target[];
  registry?: AdapterRegistry;
  publicationMode?: "probe" | "publish";
  now?: () => Date;
  onTargetComplete?: (outcome: RunTargetOutcome) => void;
}

export interface RunResult {
  manifest: RunManifest;
  manifestPath: string;
  stageDurationsMs: {
    ranking: number;
    metadata: number;
  };
}

interface RankedTarget {
  adapter: ReturnType<AdapterRegistry["forTarget"]>;
  observation: AdapterObservation;
  outcome: RunTargetOutcome;
  disposition: "valid" | "partial" | "quarantined";
}

function errorDetails(error: unknown, target: Target): { kind: string; message: string } {
  const kind = target.store === "google-play" ? classifyGooglePlayError(error) : "apple_error";
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  const causeMessage = cause instanceof Error
    ? `${cause.name}: ${cause.message}`
    : cause === undefined
      ? ""
      : String(cause);
  return {
    kind,
    message: causeMessage && causeMessage !== message
      ? `${message}; cause=${causeMessage}`
      : message
  };
}

function errorAttempts(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "attempts" in error &&
    Number.isInteger(error.attempts) &&
    Number(error.attempts) > 0
  ) {
    return Number(error.attempts);
  }
  return 1;
}

function reportTargetComplete(
  reporter: RunOptions["onTargetComplete"],
  outcome: RunTargetOutcome
): void {
  reporter?.(outcome);
}

function makeSnapshot(
  observation: AdapterObservation,
  previousSnapshotId: string | null,
  status: "valid" | "partial",
  flags: string[]
): Snapshot {
  const token = utcPathParts(observation.capturedAt).token;
  const marketTimeZone = observation.target.marketTimeZone ?? "UTC";
  return SnapshotSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    snapshotId: `${targetSlug(observation.target)}-${token}`,
    store: observation.target.store,
    market: observation.target.market,
    scope: observation.target.scope,
    chart: observation.target.chart,
    normalizedCategory: observation.target.normalizedCategory,
    storeCategory: observation.target.storeCategory,
    capturedAt: observation.capturedAt,
    observationDate: observation.capturedAt.slice(0, 10),
    marketTimeZone,
    marketObservationDate: calendarDateInTimeZone(
      observation.capturedAt,
      marketTimeZone
    ),
    status,
    expectedCount: observation.target.expectedCount,
    actualCount: observation.entries.length,
    complete: status === "valid" && observation.entries.length === observation.target.expectedCount,
    source: observation.source,
    validation: { previousSnapshotId, flags },
    entries: observation.entries
  });
}

async function previousSnapshot(
  store: DataStore,
  latest: LatestManifest,
  target: Target
): Promise<Snapshot | null> {
  const pointer = latest.targets[targetKey(target)];
  if (!pointer) return null;
  const raw = await store.readJson<unknown>(pointer.snapshotPath);
  return raw === null ? null : SnapshotSchema.parse(raw);
}

function metadataLines(metadata: AppMetadataObservation[]): string {
  return metadata.map((item) => JSON.stringify(item)).join("\n") + (metadata.length ? "\n" : "");
}

interface CatalogStateItem {
  fingerprint: string;
  lastSeenAt: string;
}

async function writeMetadataChanges(
  store: DataStore,
  metadata: AppMetadataObservation[],
  startedAt: string,
  runId: string,
  probe: boolean
): Promise<void> {
  if (metadata.length === 0) return;
  const statePath = probe ? "probes/views/catalog-state.json" : "views/catalog-state.json";
  const state =
    (await store.readJson<Record<string, CatalogStateItem>>(statePath)) ?? {};
  const changed: AppMetadataObservation[] = [];

  for (const item of metadata) {
    const key = `${item.store}:${item.market}:${item.appId}`;
    const { observedAt: _observedAt, ...stableFields } = item;
    const fingerprint = sha256(stableFields);
    if (state[key]?.fingerprint !== fingerprint) changed.push(item);
    state[key] = { fingerprint, lastSeenAt: item.observedAt };
  }

  await store.writeMutableJson(statePath, state);
  if (changed.length === 0) return;
  const prefix = probe ? "probes/metadata/events" : "metadata/events";
  await store.writeImmutableText(
    datedPath(prefix, startedAt, `${runId}.ndjson`),
    metadataLines(changed)
  );
}

export async function runCollection(options: RunOptions): Promise<RunResult> {
  const store = new DataStore(options.outputRoot);
  const registry = options.registry ?? new AdapterRegistry();
  const now = options.now ?? (() => new Date());
  const rankingStageStarted = performance.now();
  const startedAt = now().toISOString();
  const runId = utcPathParts(startedAt).token;
  const existingLatest = await store.readJson<unknown>("manifests/latest.json");
  const latest = existingLatest
    ? LatestManifestSchema.parse(existingLatest)
    : LatestManifestSchema.parse({ schemaVersion: SCHEMA_VERSION, updatedAt: startedAt, targets: {} });
  const outcomes: RunTargetOutcome[] = new Array(options.targets.length);
  const rankedTargets: Array<RankedTarget | undefined> = new Array(options.targets.length);
  const probeMetadata: AppMetadataObservation[] = [];
  const publishedMetadata: AppMetadataObservation[] = [];

  await Promise.all(options.targets.map(async (configuredTarget, index) => {
    const target = TargetSchema.parse({
      ...configuredTarget,
      publicationMode: options.publicationMode ?? configuredTarget.publicationMode
    });
    const itemStartedAt = now().toISOString();
    const adapter = registry.forTarget(target);
    try {
      const previous = await previousSnapshot(store, latest, target);
      const observation = await adapter.collectRanking(target);
      const quality = validateObservation(observation, previous?.entries ?? null);
      const snapshotStatus = quality.disposition === "valid" ? "valid" : "partial";
      const snapshot = makeSnapshot(
        observation,
        previous?.snapshotId ?? null,
        snapshotStatus,
        quality.flags
      );
      const isProbe = target.publicationMode === "probe";
      const prefix = quality.disposition === "quarantined"
        ? isProbe ? "probes/quarantine" : "quarantine"
        : isProbe ? "probes/snapshots" : "snapshots";
      const relativeSnapshotPath = snapshotPath(snapshot, prefix);
      await store.writeImmutableJson(relativeSnapshotPath, snapshot);

      if (!isProbe && quality.disposition === "valid") {
        latest.targets[targetKey(target)] = {
          snapshotId: snapshot.snapshotId,
          snapshotPath: relativeSnapshotPath,
          capturedAt: snapshot.capturedAt
        };
      }
      const outcome: RunTargetOutcome = {
        targetKey: targetKey(target),
        target,
        status: quality.disposition,
        startedAt: itemStartedAt,
        finishedAt: now().toISOString(),
        attempts: observation.attempts,
        snapshotPath: relativeSnapshotPath,
        error: null,
        flags: quality.flags
      };
      outcomes[index] = outcome;
      rankedTargets[index] = {
        adapter,
        observation,
        outcome,
        disposition: quality.disposition
      };
    } catch (error) {
      const outcome: RunTargetOutcome = {
        targetKey: targetKey(target),
        target,
        status: "failed",
        startedAt: itemStartedAt,
        finishedAt: now().toISOString(),
        attempts: errorAttempts(error),
        snapshotPath: null,
        error: errorDetails(error, target),
        flags: []
      };
      outcomes[index] = outcome;
      reportTargetComplete(options.onTargetComplete, outcome);
    }
  }));

  const rankingStageDuration = performance.now() - rankingStageStarted;
  const metadataStageStarted = performance.now();

  await Promise.all(rankedTargets.map(async (ranked) => {
    if (!ranked) return;
    const { adapter, observation, outcome, disposition } = ranked;
    try {
      const enrichment = await adapter.enrichMetadata(observation);
      outcome.attempts = Math.max(outcome.attempts, enrichment.attempts);
      outcome.flags = [...new Set([...outcome.flags, ...enrichment.flags])].sort();
      const isProbe = observation.target.publicationMode === "probe";
      if (isProbe) {
        probeMetadata.push(...enrichment.metadata);
      } else if (disposition !== "quarantined") {
        publishedMetadata.push(...enrichment.metadata);
      }
    } catch (error) {
      outcome.attempts = Math.max(outcome.attempts, errorAttempts(error));
      const details = errorDetails(error, observation.target);
      outcome.flags = [...new Set([
        ...outcome.flags,
        `metadata_enrichment_failed:${details.kind}`
      ])].sort();
    }
    outcome.finishedAt = now().toISOString();
    reportTargetComplete(options.onTargetComplete, outcome);
  }));

  const metadataStageDuration = performance.now() - metadataStageStarted;

  const finishedAt = now().toISOString();
  const manifest = RunManifestSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    runId,
    collectorVersion: COLLECTOR_VERSION,
    startedAt,
    finishedAt,
    targets: outcomes
  });
  const allProbe = outcomes.every((outcome) => outcome.target.publicationMode === "probe");
  const runPrefix = allProbe ? "probes/runs" : "runs";
  const manifestPath = datedPath(runPrefix, startedAt, `${runId}.json`);
  await store.writeImmutableJson(manifestPath, manifest);

  await writeMetadataChanges(store, probeMetadata, startedAt, runId, true);
  await writeMetadataChanges(store, publishedMetadata, startedAt, runId, false);
  if (!allProbe && outcomes.some((outcome) => outcome.status === "valid")) {
    latest.updatedAt = finishedAt;
    await store.writeMutableJson("manifests/latest.json", LatestManifestSchema.parse(latest));
  }

  return {
    manifest,
    manifestPath,
    stageDurationsMs: {
      ranking: Math.round(rankingStageDuration),
      metadata: Math.round(metadataStageDuration)
    }
  };
}
