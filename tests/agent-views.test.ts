import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAgentViews } from "../scripts/build-agent-views.js";
import { PUBLICATION_MARKER } from "../src/publication.js";
import { DataStore } from "../src/storage.js";
import { metadata, target } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("published agent views", () => {
  it("indexes all published runs and replays latest metadata without probe records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "apporbit-agent-views-"));
    roots.push(root);
    const store = new DataStore(root);
    const currentTarget = target();
    const initial = metadata(currentTarget, ["app-a"])[0]!;
    const updated = { ...initial, name: "Updated app", observedAt: "2026-09-20T02:17:42.000Z" };
    await store.writeImmutableJson(PUBLICATION_MARKER, {
      migration: "probe-to-publish-v1", publicationMode: "publish",
      sourceCommit: "a".repeat(40), sourceDigest: "b".repeat(64), files: []
    });
    await store.writeImmutableText("metadata/events/2026/09/18/first.ndjson", `${JSON.stringify(initial)}\n`);
    await store.writeImmutableText("metadata/events/2026/09/20/second.ndjson", `${JSON.stringify(updated)}\n`);
    await store.writeImmutableText("probes/metadata/events/2026/09/21/probe.ndjson",
      `${JSON.stringify({ ...updated, name: "Probe only", observedAt: "2026-09-21T02:17:42.000Z" })}\n`);
    for (const day of ["18", "20"]) {
      const timestamp = `2026-09-${day}T02:17:42.000Z`;
      const runId = `202609${day}T021742000Z`;
      await store.writeImmutableJson(`runs/2026/09/${day}/${runId}.json`, {
        schemaVersion: 1, runId, collectorVersion: "test",
        startedAt: timestamp, finishedAt: timestamp,
        targets: [{
          targetKey: "google-play:US:apps:top-free:all-apps", target: currentTarget,
          status: "valid", startedAt: timestamp, finishedAt: timestamp, attempts: 1,
          snapshotPath: `snapshots/google-play/US/apps/top-free/2026/09/${day}/${runId}.json`,
          error: null, flags: []
        }]
      });
    }
    const result = await buildAgentViews(root);
    expect(result).toEqual({ runs: 2, markets: 1 });
    const indexPath = store.resolve("views/agent-index-v1.json");
    const firstIndex = await readFile(indexPath, "utf8");
    const index = JSON.parse(firstIndex);
    expect(index.generatedAt).toBe("2026-09-20T02:17:42.000Z");
    expect(index.runs).toHaveLength(2);
    expect(index.runs[0].targets[0].snapshotPath).toContain("/2026/09/20/");
    const catalog = await store.readJson<{ catalog: Record<string, { name: string }> }>(
      "views/agent-catalog-v1/google-play/US.json"
    );
    expect(catalog?.catalog["app-a"]?.name).toBe("Updated app");
    await buildAgentViews(root);
    expect(await readFile(indexPath, "utf8")).toBe(firstIndex);
  });
});
