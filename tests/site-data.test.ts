import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCatalog, loadRuns } from "../scripts/site-data.js";
import { PUBLICATION_MARKER } from "../src/publication.js";
import { DataStore } from "../src/storage.js";
import { metadata, target } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("website data namespace", () => {
  it("reads probe history before publication and ignores stray probe files afterward", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "apporbit-site-data-"));
    roots.push(root);
    const store = new DataStore(root);
    const item = target();
    const probe = metadata(item)[0]!;
    const published = { ...probe, observedAt: "2026-09-18T02:17:00.000Z", name: "Published name" };
    await store.writeImmutableText("probes/metadata/events/probe.ndjson",
      `${JSON.stringify({ ...probe, observedAt: "2026-09-19T02:17:00.000Z" })}\n`);
    await store.writeImmutableText("metadata/events/published.ndjson", `${JSON.stringify(published)}\n`);
    const run = { schemaVersion: 1, runId: "20260918T021700000Z", collectorVersion: "test",
      startedAt: "2026-09-18T02:17:00.000Z", finishedAt: "2026-09-18T02:18:00.000Z", targets: [] };
    await store.writeImmutableJson("probes/runs/2026/09/18/probe.json", run);
    await store.writeImmutableJson("runs/2026/09/18/published.json", { ...run, runId: "20260918T021700001Z" });

    expect(await loadRuns(root)).toHaveLength(2);
    expect(Object.values(await loadCatalog(root))[0]!.name).toBe(probe.name);

    await store.writeImmutableJson(PUBLICATION_MARKER, {
      migration: "probe-to-publish-v1", publicationMode: "publish",
      sourceCommit: "a".repeat(40), sourceDigest: "b".repeat(64), files: []
    });
    const runs = await loadRuns(root);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.manifestPath).toMatch(/^runs\//);
    expect(Object.values(await loadCatalog(root))[0]!.name).toBe("Published name");
  });
});
