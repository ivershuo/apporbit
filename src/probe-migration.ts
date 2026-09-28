import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  AppMetadataObservationSchema, CapabilitiesManifestSchema, LatestManifestSchema,
  RunManifestSchema, SnapshotSchema, targetKey, type AppMetadataObservation,
  type LatestManifest, type Snapshot
} from "./domain.js";
import { sha256 } from "./hash.js";
import { datedPath, snapshotPath } from "./paths.js";
import { PUBLICATION_MARKER, PublicationMarkerSchema } from "./publication.js";
import { DataStore } from "./storage.js";

const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const snapshotKey = (snapshot: Snapshot) =>
  [snapshot.store, snapshot.market, snapshot.scope, snapshot.chart, snapshot.normalizedCategory].join(":");

async function inventory(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await inventory(root, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Unsupported file type: ${relative}`);
  }
  return files.sort();
}

function promotePath(relative: string): string {
  if (!relative.startsWith("probes/")) return relative;
  if (!/^probes\/(snapshots\/|quarantine\/|runs\/|metadata\/events\/|views\/catalog-state\.json$)/.test(relative)) {
    throw new Error(`Unknown probe file: ${relative}`);
  }
  return relative.slice("probes/".length);
}

async function inspect(root: string) {
  const files = await inventory(root);
  const store = new DataStore(root);
  const snapshots = new Map<string, Snapshot>();
  const identities = new Set<string>();
  const runs = [];
  const catalog: Record<string, AppMetadataObservation> = {};
  for (const file of files) {
    const local = file.startsWith("probes/") ? file.slice(7) : file;
    if (local.startsWith("snapshots/") || local.startsWith("quarantine/")) {
      const snapshot = SnapshotSchema.parse(await store.readJson(file));
      const prefix = `${file.startsWith("probes/") ? "probes/" : ""}${local.startsWith("quarantine/") ? "quarantine" : "snapshots"}`;
      if (snapshotPath(snapshot, prefix) !== file) {
        throw new Error(`Snapshot path mismatch: ${file}`);
      }
      if (snapshot.actualCount !== snapshot.entries.length ||
          new Set(snapshot.entries.map((item) => item.appId)).size !== snapshot.entries.length ||
          snapshot.entries.some((item, index) => item.rank !== index + 1) ||
          (snapshot.status === "valid" && (!snapshot.complete || snapshot.actualCount !== snapshot.expectedCount))) {
        throw new Error(`Snapshot integrity mismatch: ${file}`);
      }
      if (identities.has(snapshot.snapshotId)) throw new Error(`Duplicate snapshot ID: ${snapshot.snapshotId}`);
      identities.add(snapshot.snapshotId);
      snapshots.set(file, snapshot);
    } else if (local.startsWith("runs/")) {
      const run = RunManifestSchema.parse(await store.readJson(file));
      const prefix = file.startsWith("probes/") ? "probes/runs" : "runs";
      if (datedPath(prefix, run.startedAt, `${run.runId}.json`) !== file) {
        throw new Error(`Run path mismatch: ${file}`);
      }
      runs.push({ file, run });
    } else if (local.startsWith("metadata/events/")) {
      for (const line of (await readFile(store.resolve(file), "utf8")).split("\n").filter(Boolean)) {
        const item = AppMetadataObservationSchema.parse(JSON.parse(line));
        const key = `${item.store}:${item.market}:${item.appId}`;
        if (!catalog[key] || catalog[key].observedAt <= item.observedAt) catalog[key] = item;
      }
    }
  }
  const latest: LatestManifest = { schemaVersion: 1, updatedAt: "1970-01-01T00:00:00.000Z", targets: {} };
  const runIds = new Set<string>();
  for (const { file, run } of runs) {
    if (runIds.has(run.runId)) throw new Error(`Duplicate run ID: ${run.runId}`);
    runIds.add(run.runId);
    for (const outcome of run.targets) {
      if (targetKey(outcome.target) !== outcome.targetKey) throw new Error(`Target key mismatch: ${file}`);
      if (!["valid", "partial", "quarantined"].includes(outcome.status)) {
        if (outcome.snapshotPath !== null) throw new Error(`Unobserved target has a snapshot: ${file}`);
        continue;
      }
      const snapshot = outcome.snapshotPath ? snapshots.get(outcome.snapshotPath) : undefined;
      if (!snapshot) throw new Error(`Missing snapshot reference: ${file}: ${outcome.snapshotPath}`);
      if (snapshotKey(snapshot) !== outcome.targetKey) {
        throw new Error(`Snapshot target mismatch: ${file}`);
      }
      const quarantined = outcome.snapshotPath!.startsWith("quarantine/") || outcome.snapshotPath!.startsWith("probes/quarantine/");
      if (quarantined !== (outcome.status === "quarantined") ||
          (!quarantined && snapshot.status !== outcome.status)) {
        throw new Error(`Snapshot status mismatch: ${file}`);
      }
      if (outcome.status !== "valid") continue;
      const previous = latest.targets[outcome.targetKey];
      if (!previous || previous.capturedAt < snapshot.capturedAt) {
        latest.targets[outcome.targetKey] = {
          snapshotId: snapshot.snapshotId,
          snapshotPath: promotePath(outcome.snapshotPath!),
          capturedAt: snapshot.capturedAt
        };
      }
      if (run.finishedAt > latest.updatedAt) latest.updatedAt = run.finishedAt;
    }
  }
  const oldLatest = await store.readJson<unknown>("manifests/latest.json");
  if (oldLatest !== null) {
    for (const [key, pointer] of Object.entries(LatestManifestSchema.parse(oldLatest).targets)) {
      const snapshot = snapshots.get(pointer.snapshotPath);
      if (!snapshot || snapshot.snapshotId !== pointer.snapshotId || snapshot.capturedAt !== pointer.capturedAt ||
          snapshot.status !== "valid" || !latest.targets[key] ||
          snapshotKey(snapshot) !== key ||
          pointer.snapshotPath.includes("quarantine/")) {
        throw new Error(`Invalid latest pointer: ${key}`);
      }
    }
  }
  for (const snapshot of snapshots.values()) {
    if (snapshot.validation.previousSnapshotId !== null && !identities.has(snapshot.validation.previousSnapshotId)) {
      throw new Error(`Missing previous snapshot: ${snapshot.snapshotId}`);
    }
  }
  return { files, runs, snapshots, catalog, latest };
}

/** Prepare a complete replacement in a fresh directory; never modify the source. */
export async function migrateProbes(sourceRoot: string, outputRoot: string, sourceCommit: string) {
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outputRoot);
  if (source === output || output.startsWith(`${source}${path.sep}`) || source.startsWith(`${output}${path.sep}`)) {
    throw new Error("Migration source and output must be separate directories");
  }
  if (!/^[a-f0-9]{40,64}$/.test(sourceCommit)) throw new Error("Expected a Git source commit SHA");
  // Exclusive creation also prevents accidentally overwriting a previous attempt.
  await mkdir(output, { recursive: false });
  const before = await inspect(source);
  const sourceStore = new DataStore(source);
  const marker = await sourceStore.readJson<unknown>(PUBLICATION_MARKER);
  if (marker !== null) {
    const report = PublicationMarkerSchema.parse(marker);
    if (before.files.some((file) => file.startsWith("probes/"))) throw new Error("Published dataset contains probe files");
    for (const file of report.files) {
      if (/^(snapshots|quarantine|runs|metadata\/events)\//.test(file.destination) &&
          digest(await readFile(sourceStore.resolve(file.destination))) !== file.destinationSha256) {
        throw new Error(`Migrated history checksum mismatch: ${file.destination}`);
      }
    }
    await cp(source, output, { recursive: true });
    return { alreadyPublished: true, files: before.files.length };
  }
  if (!before.runs.some(({ file }) => file.startsWith("probes/")) || !Object.keys(before.latest.targets).length) {
    throw new Error("No usable probe history to migrate");
  }
  const writes = new Map<string, Buffer>();
  const audit = [];
  for (const file of before.files) {
    const original = await readFile(sourceStore.resolve(file));
    const destination = promotePath(file);
    let bytes = original;
    if (file.startsWith("probes/runs/")) {
      const run = JSON.parse(original.toString("utf8")) as ReturnType<typeof RunManifestSchema.parse>;
      RunManifestSchema.parse(run);
      for (const outcome of run.targets) {
        outcome.target.publicationMode = "publish";
        if (outcome.snapshotPath) outcome.snapshotPath = promotePath(outcome.snapshotPath);
      }
      bytes = Buffer.from(encode(run));
    }
    if (writes.has(destination) && !writes.get(destination)!.equals(bytes)) {
      throw new Error(`Destination conflict: ${destination}`);
    }
    writes.set(destination, bytes);
    audit.push({ source: file, destination, sourceSha256: digest(original), destinationSha256: digest(bytes) });
  }
  const state: Record<string, { fingerprint: string; lastSeenAt: string }> = {};
  const stateSchema = z.record(z.string(), z.object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    lastSeenAt: z.iso.datetime()
  }));
  const previousStates = [];
  for (const statePath of ["probes/views/catalog-state.json", "views/catalog-state.json"]) {
    const value = await sourceStore.readJson<unknown>(statePath);
    if (value !== null) previousStates.push(stateSchema.parse(value));
  }
  for (const [key, item] of Object.entries(before.catalog)) {
    const { observedAt, ...stable } = item;
    state[key] = { fingerprint: sha256(stable), lastSeenAt: observedAt };
    for (const previous of previousStates) {
      if (previous[key]?.fingerprint === state[key].fingerprint && previous[key].lastSeenAt > state[key].lastSeenAt) {
        state[key].lastSeenAt = previous[key].lastSeenAt;
      }
    }
  }
  for (const previous of previousStates) {
    for (const key of Object.keys(previous)) {
      if (!before.catalog[key]) throw new Error(`Catalog state has no metadata event: ${key}`);
    }
  }
  writes.set("views/catalog-state.json", Buffer.from(encode(state)));
  writes.set("manifests/latest.json", Buffer.from(encode(LatestManifestSchema.parse(before.latest))));
  const capabilitiesBytes = writes.get("capabilities.json");
  if (capabilitiesBytes) {
    const capabilities = CapabilitiesManifestSchema.parse(JSON.parse(capabilitiesBytes.toString("utf8")));
    for (const capability of capabilities.capabilities) {
      if (capability.status === "probe") capability.status = "supported";
    }
    writes.set("capabilities.json", Buffer.from(encode(capabilities)));
  }
  // Derived files can legitimately change; record their actual final checksums.
  for (const entry of audit) entry.destinationSha256 = digest(writes.get(entry.destination)!);
  for (const [file, bytes] of writes) {
    const destination = new DataStore(output).resolve(file);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  }
  const after = await inspect(output);
  if (before.runs.length !== after.runs.length || before.snapshots.size !== after.snapshots.size ||
      sha256(before.catalog) !== sha256(after.catalog)) throw new Error("History or catalog changed during migration");
  for (const [file, snapshot] of before.snapshots) {
    if (sha256(snapshot) !== sha256(after.snapshots.get(promotePath(file)))) {
      throw new Error(`Snapshot changed during migration: ${file}`);
    }
  }
  for (const entry of audit) {
    if (digest(await readFile(new DataStore(output).resolve(entry.destination))) !== entry.destinationSha256) {
      throw new Error(`Output checksum mismatch: ${entry.destination}`);
    }
  }
  // Verify input remained stable even when invoked outside the workflow lock.
  if (JSON.stringify(before.files) !== JSON.stringify(await inventory(source))) throw new Error("Source files changed");
  for (const entry of audit) {
    if (digest(await readFile(sourceStore.resolve(entry.source))) !== entry.sourceSha256) throw new Error("Source bytes changed");
  }
  const report = PublicationMarkerSchema.parse({
    migration: "probe-to-publish-v1", publicationMode: "publish", sourceCommit,
    sourceDigest: sha256(audit.map(({ source, sourceSha256 }) => ({ source, sourceSha256 }))), files: audit
  });
  await new DataStore(output).writeImmutableJson(PUBLICATION_MARKER, report);
  return { alreadyPublished: false, files: audit.length, runs: after.runs.length,
    snapshots: after.snapshots.size, metadataRecords: Object.keys(after.catalog).length,
    latestTargets: Object.keys(after.latest.targets).length, sourceDigest: report.sourceDigest };
}
