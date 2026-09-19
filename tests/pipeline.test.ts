import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { AdapterRegistry } from "../src/adapters/index.js";
import { LatestManifestSchema, SnapshotSchema, targetKey } from "../src/domain.js";
import { runCollection } from "../src/pipeline.js";
import { DataStore } from "../src/storage.js";
import { FixtureAdapter, observation, target } from "./helpers.js";

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
