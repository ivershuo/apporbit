import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { DataStore } from "../src/storage.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("data store", () => {
  it("allows identical immutable writes and rejects changed content", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "apporbit-storage-"));
    directories.push(directory);
    const store = new DataStore(directory);

    await store.writeImmutableJson("snapshots/example.json", { value: 1 });
    await store.writeImmutableJson("snapshots/example.json", { value: 1 });
    await expect(
      store.writeImmutableJson("snapshots/example.json", { value: 2 })
    ).rejects.toThrow("immutable data conflict");
  });

  it("does not allow paths to escape the data root", () => {
    const store = new DataStore("/tmp/apporbit-root");
    expect(() => store.resolve("../outside.json")).toThrow("escapes the output root");
  });
});
