import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { AdapterRegistry } from "../src/adapters/index.js";
import { LatestManifestSchema, SnapshotSchema, targetKey } from "../src/domain.js";
import { runCollection } from "../src/pipeline.js";
import { DataStore } from "../src/storage.js";
import { FixtureAdapter, metadata, observation, target } from "./helpers.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function clock(): () => Date {
  let tick = 0;
  return () => new Date(Date.parse("2026-09-18T02:17:00.000Z") + tick++);
}

describe("collection pipeline", () => {
  it("records target failures without cancelling successful targets", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "apporbit-pipeline-"));
    directories.push(directory);
    const us = target({ market: "US" });
    const jp = target({ market: "JP" });
    const adapter = new FixtureAdapter(async (current) => {
      if (current.market === "JP") throw new Error("fixture unavailable");
      return observation(current);
    });
    const registry = new AdapterRegistry({ "google-play": adapter });

    const result = await runCollection({
      outputRoot: directory,
      targets: [us, jp],
      registry,
      now: clock()
    });

    expect(result.manifest.targets.map((item) => item.status)).toEqual(["valid", "failed"]);
    const store = new DataStore(directory);
    const latest = LatestManifestSchema.parse(await store.readJson("manifests/latest.json"));
    const pointer = latest.targets[targetKey(us)];
    expect(pointer).toBeDefined();
    expect(latest.targets[targetKey(jp)]).toBeUndefined();
    const snapshot = SnapshotSchema.parse(await store.readJson(pointer!.snapshotPath));
    expect(snapshot.actualCount).toBe(20);
    expect(snapshot.marketTimeZone).toBe("America/New_York");
    expect(snapshot.marketObservationDate).toBe("2026-09-17");
    expect(pointer!.snapshotPath).toContain("/2026/09/17/");
  });

  it("starts selected targets concurrently to keep chart captures close together", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "apporbit-concurrent-"));
    directories.push(directory);
    let active = 0;
    let maximumActive = 0;
    const adapter = new FixtureAdapter(async (current) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return observation(current);
    });

    await runCollection({
      outputRoot: directory,
      targets: [target({ market: "US" }), target({ market: "JP", marketTimeZone: "Asia/Tokyo" })],
      registry: new AdapterRegistry({ "google-play": adapter }),
      now: clock()
    });

    expect(maximumActive).toBe(2);
  });

  it("persists every ranking snapshot before metadata enrichment starts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "apporbit-stages-"));
    directories.push(directory);
    const events: string[] = [];
    const adapter = new FixtureAdapter(
      async (current) => {
        events.push(`ranking:${current.market}`);
        return observation(current);
      },
      async (current) => {
        const files = await readdir(directory, { recursive: true });
        const snapshotCount = files.filter((file) =>
          String(file).includes("snapshots/") && String(file).endsWith(".json")
        ).length;
        events.push(`metadata:${current.target.market}:${snapshotCount}`);
        return {
          metadata: metadata(current.target, current.entries.map((entry) => entry.appId)),
          flags: [],
          attempts: 1
        };
      }
    );

    await runCollection({
      outputRoot: directory,
      targets: [target({ market: "US" }), target({ market: "JP", marketTimeZone: "Asia/Tokyo" })],
      registry: new AdapterRegistry({ "google-play": adapter }),
      now: clock()
    });

    expect(events.slice(0, 2)).toEqual(["ranking:US", "ranking:JP"]);
    expect(events.slice(2).sort()).toEqual([
      "metadata:JP:2",
      "metadata:US:2"
    ]);
  });

  it("keeps a valid ranking when metadata enrichment fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "apporbit-enrichment-failure-"));
    directories.push(directory);
    const adapter = new FixtureAdapter(
      async (current) => observation(current),
      async () => {
        throw new Error("metadata service unavailable");
      }
    );

    const result = await runCollection({
      outputRoot: directory,
      targets: [target()],
      registry: new AdapterRegistry({ "google-play": adapter }),
      now: clock()
    });

    expect(result.manifest.targets[0]).toMatchObject({
      status: "valid",
      error: null,
      flags: ["metadata_enrichment_failed:google_play_error"]
    });
    expect(result.manifest.targets[0]?.snapshotPath).not.toBeNull();
  });

  it("keeps probe observations away from the published latest manifest", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "apporbit-probe-"));
    directories.push(directory);
    const probe = target({ publicationMode: "probe" });
    const adapter = new FixtureAdapter(async (current) => observation(current));

    const result = await runCollection({
      outputRoot: directory,
      targets: [probe],
      registry: new AdapterRegistry({ "google-play": adapter }),
      now: clock()
    });

    expect(result.manifestPath).toContain("probes/runs/");
    expect(result.manifest.targets[0]!.snapshotPath).toContain("probes/snapshots/");
    expect(await new DataStore(directory).readJson("manifests/latest.json")).toBeNull();
  });
});
