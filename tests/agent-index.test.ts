import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAgentIndex } from "../scripts/build-agent-index.js";
import { PUBLICATION_MARKER } from "../src/publication.js";
import { DataStore } from "../src/storage.js";
import { target } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("published run index", () => {
  it("indexes all published runs without probe records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "apporbit-agent-index-"));
    roots.push(root);
    const store = new DataStore(root);
    const currentTarget = target();
    await store.writeImmutableJson(PUBLICATION_MARKER, {
      migration: "probe-to-publish-v1", publicationMode: "publish",
      sourceCommit: "a".repeat(40), sourceDigest: "b".repeat(64), files: []
    });
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
    await store.writeImmutableJson("probes/runs/2026/09/21/probe.json", {
      schemaVersion: 1, runId: "20260921T021742000Z", collectorVersion: "test",
      startedAt: "2026-09-21T02:17:42.000Z", finishedAt: "2026-09-21T02:17:42.000Z",
      targets: []
    });
    const result = await buildAgentIndex(root);
    expect(result).toEqual({ runs: 2 });
    const indexPath = store.resolve("views/agent-index-v1.json");
    const firstIndex = await readFile(indexPath, "utf8");
    const index = JSON.parse(firstIndex);
    expect(index.generatedAt).toBe("2026-09-20T02:17:42.000Z");
    expect(index.runs).toHaveLength(2);
    expect(index.runs[0].targets[0].snapshotPath).toContain("/2026/09/20/");
    await buildAgentIndex(root);
    expect(await readFile(indexPath, "utf8")).toBe(firstIndex);
  });
});
