import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { AdapterRegistry } from "../src/adapters/index.js";
import { runCollection } from "../src/pipeline.js";
import { migrateProbes } from "../src/probe-migration.js";
import { isPublished, publicationTargets, PUBLICATION_MARKER } from "../src/publication.js";
import { DataStore } from "../src/storage.js";
import { loadCapabilities, loadCatalog, loadRuns } from "../scripts/site-data.js";
import { FixtureAdapter, metadata, observation, target } from "./helpers.js";

const directories: string[] = [];
const sourceCommit = "a".repeat(40);
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "apporbit-migration-"));
  directories.push(directory);
  const source = path.join(directory, "source");
  const output = path.join(directory, "output");
  const currentTarget = target({ publicationMode: "probe", expectedCount: 25 });
  const manifests = [];
  for (let index = 0; index < 4; index++) {
    const timestamp = `2026-09-${18 + index}T02:17:42.000Z`;
    const adapter = new FixtureAdapter(async (value) => {
      if (index === 3) throw new Error("fixture source unavailable");
      const item = observation(value);
      return { ...item, capturedAt: timestamp,
        entries: index === 1 ? item.entries.slice(0, 20) : item.entries,
        flags: index === 2 ? ["source_integrity:fixture"] : [] };
    }, async (value) => ({
      metadata: metadata(value.target).map((item) => ({ ...item, observedAt: timestamp })),
      attempts: 1, flags: []
    }));
    const result = await runCollection({ outputRoot: source, targets: [currentTarget],
      registry: new AdapterRegistry({ "google-play": adapter }), now: () => new Date(timestamp) });
    manifests.push(result);
  }
  return { source, output, directory, currentTarget, manifests };
}

describe("atomic probe promotion preparation", () => {
  it("preserves all history, builds valid-only latest, preserves dedup state and leaves source untouched", async () => {
    const { source, output, currentTarget, manifests } = await fixture();
    const first = manifests[0]!;
    const sourceRunBytes = await readFile(path.join(source, first.manifestPath));
    const report = await migrateProbes(source, output, sourceCommit);
    expect(report).toMatchObject({ alreadyPublished: false, runs: 4, snapshots: 3, latestTargets: 1, metadataRecords: 25 });
    expect(await readFile(path.join(source, first.manifestPath))).toEqual(sourceRunBytes);
    expect(await isPublished(source)).toBe(false);
    expect(await isPublished(output)).toBe(true);
    expect(await readdir(output)).not.toContain("probes");
    const runs = await loadRuns(output);
    expect(runs.map((run) => run.targets[0]!.status)).toEqual(["failed", "quarantined", "partial", "valid"]);
    for (const run of runs) {
      expect(run.targets[0]!.target.publicationMode).toBe("publish");
      expect(run.targets[0]!.snapshotPath?.startsWith("probes/")).not.toBe(true);
    }
    expect(await loadCatalog(source)).toEqual(await loadCatalog(output));
    const store = new DataStore(output);
    const latest = await store.readJson<{ targets: Record<string, { snapshotPath: string }> }>("manifests/latest.json");
    expect(Object.values(latest!.targets)[0]!.snapshotPath).toBe(first.manifest.targets[0]!.snapshotPath!.slice(7));
    for (const result of manifests.slice(0, 3)) {
      const oldPath = result.manifest.targets[0]!.snapshotPath!;
      expect(await readFile(path.join(output, oldPath.slice(7)))).toEqual(await readFile(path.join(source, oldPath)));
    }
    const targets = await publicationTargets(output, [currentTarget]);
    const adapter = new FixtureAdapter(async (value) => ({ ...observation(value), capturedAt: "2026-09-22T02:17:42.000Z" }),
      async (value) => ({ metadata: metadata(value.target), attempts: 1, flags: [] }));
    const result = await runCollection({ outputRoot: output, targets,
      registry: new AdapterRegistry({ "google-play": adapter }), now: () => new Date("2026-09-22T02:17:42.000Z") });
    expect(result.manifestPath).toMatch(/^runs\//);
    const snapshot = await store.readJson<{ validation: { previousSnapshotId: string } }>(result.manifest.targets[0]!.snapshotPath!);
    const priorSnapshot = await new DataStore(source).readJson<{ snapshotId: string }>(first.manifest.targets[0]!.snapshotPath!);
    expect(snapshot!.validation.previousSnapshotId).toBe(priorSnapshot!.snapshotId);
    const metadataDirectory = path.join(output, "metadata/events/2026/09");
    expect(await readdir(metadataDirectory)).not.toContain("22");
  });

  it("is safe to rerun after publication and rejects later damage to migrated immutable files", async () => {
    const { source, output, directory } = await fixture();
    await migrateProbes(source, output, sourceCommit);
    const marker = await readFile(path.join(output, PUBLICATION_MARKER));
    expect(await migrateProbes(output, path.join(directory, "retry"), "b".repeat(40))).toMatchObject({ alreadyPublished: true });
    expect(await readFile(path.join(output, PUBLICATION_MARKER))).toEqual(marker);
    const run = (await loadRuns(output))[0]!;
    const raw = JSON.parse(await readFile(path.join(output, run.manifestPath), "utf8"));
    raw.collectorVersion = "damaged";
    await writeFile(path.join(output, run.manifestPath), JSON.stringify(raw));
    await expect(migrateProbes(output, path.join(directory, "damaged-retry"), sourceCommit)).rejects.toThrow("checksum mismatch");
  });

  it("fails on conflicting files without changing the source or creating a publication marker", async () => {
    const { source, output, manifests } = await fixture();
    const original = manifests[0]!;
    await new DataStore(source).writeImmutableText(original.manifestPath.slice(7), "{}\n");
    await expect(migrateProbes(source, output, sourceCommit)).rejects.toThrow();
    expect(await isPublished(source)).toBe(false);
    expect(await isPublished(output)).toBe(false);
    expect(await readFile(path.join(source, original.manifestPath), "utf8")).toContain('"probe"');
  });

  it("refuses incomplete references, malformed metadata, unknown probe files and symlinks", async () => {
    const { source, output, directory, manifests } = await fixture();
    await rm(path.join(source, manifests[0]!.manifest.targets[0]!.snapshotPath!));
    await expect(migrateProbes(source, output, sourceCommit)).rejects.toThrow("Missing snapshot");
    const second = await fixture();
    await new DataStore(second.source).writeImmutableText("probes/metadata/events/broken.ndjson", "{broken");
    await expect(migrateProbes(second.source, second.output, sourceCommit)).rejects.toThrow();
    const third = await fixture();
    await new DataStore(third.source).writeImmutableText("probes/unknown.json", "{}");
    await expect(migrateProbes(third.source, third.output, sourceCommit)).rejects.toThrow("Unknown probe file");
    const { symlink } = await import("node:fs/promises");
    await symlink(path.join(directory, "source"), path.join(third.source, "linked"));
    await expect(migrateProbes(third.source, path.join(third.directory, "linked-output"), sourceCommit)).rejects.toThrow("Unsupported file type");
  });

  it("does not overwrite an existing output or permit nested source/output paths", async () => {
    const { source, output } = await fixture();
    await expect(migrateProbes(source, path.join(source, "output"), sourceCommit)).rejects.toThrow("separate directories");
    await migrateProbes(source, output, sourceCommit);
    await expect(migrateProbes(source, output, sourceCommit)).rejects.toThrow("EEXIST");
  });

  it("switches capability labels and blocks stale explicit probe writers before any mutation", async () => {
    const { source, output } = await fixture();
    await migrateProbes(source, output, sourceCommit);
    const baseline = await loadCapabilities(process.cwd(), source) as { capabilities: Array<{ status: string }> };
    const published = await loadCapabilities(process.cwd(), output) as typeof baseline;
    expect(baseline.capabilities.some((item) => item.status === "probe")).toBe(true);
    expect(published.capabilities.some((item) => item.status === "probe")).toBe(false);
    expect(published.capabilities.filter((item) => item.status === "unsupported").length)
      .toBe(baseline.capabilities.filter((item) => item.status === "unsupported").length);
    const latestBytes = await readFile(path.join(output, "manifests/latest.json"));
    const result = spawnSync(process.execPath,
      ["--import", "tsx", "src/cli.ts", "collect", "--output", output, "--publication-mode", "probe"],
      { cwd: process.cwd(), encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("probe writes are disabled");
    expect(await readFile(path.join(output, "manifests/latest.json"))).toEqual(latestBytes);
    expect(await readdir(output)).not.toContain("capabilities.json");
    expect(await readdir(output)).not.toContain("probes");
  });
});
