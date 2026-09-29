import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAgentIndex } from "../scripts/build-agent-index.js";
import { PUBLICATION_MARKER } from "../src/publication.js";
import { DataStore } from "../src/storage.js";
import { metadata, target } from "./helpers.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function query(root: string, ...args: string[]) {
  const output = execFileSync(process.execPath, [
    path.resolve("skills/apporbit/scripts/query.mjs"), ...args, "--source", root
  ], { encoding: "utf8", env: { ...process.env, APPORBIT_SITE_DIR: path.join(root, "site") } });
  return JSON.parse(output);
}

describe("GitHub data skill", () => {
  it("ships the complete current data format with the portable skill", async () => {
    const [repositoryFormat, bundledFormat] = await Promise.all([
      readFile(path.resolve("docs/data-format.md"), "utf8"),
      readFile(path.resolve("skills/apporbit/references/data-format.md"), "utf8")
    ]);
    expect(bundledFormat).toBe(repositoryFormat);
  });

  it("ships the repository license with the standalone skill", async () => {
    const [repositoryLicense, bundledLicense] = await Promise.all([
      readFile(path.resolve("LICENSE"), "utf8"),
      readFile(path.resolve("skills/apporbit/LICENSE"), "utf8")
    ]);
    expect(bundledLicense).toBe(repositoryLicense);
  });

  it("reads GitHub-style snapshots, enriches from site metadata, and returns specific page links", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "apporbit-agent-skill-"));
    roots.push(root);
    const store = new DataStore(root);
    const currentTarget = target({ expectedCount: 2 });
    await store.writeImmutableJson(PUBLICATION_MARKER, {
      migration: "probe-to-publish-v1", publicationMode: "publish",
      sourceCommit: "a".repeat(40), sourceDigest: "b".repeat(64), files: []
    });
    const observations = [
      { day: "18", token: "20260918T021700000Z", status: "valid", ids: ["app-a", "app-b"] },
      { day: "19", token: "20260919T021700000Z", status: "valid", ids: ["app-b", "app-c"] },
      { day: "20", token: "20260920T021700000Z", status: "partial", ids: ["app-a"] }
    ] as const;
    for (const item of observations) {
      const date = `2026-09-${item.day}`;
      const timestamp = `${date}T02:17:00.000Z`;
      const snapshotPath = `snapshots/google-play/US/apps/top-free/2026/09/${item.day}/${item.token}.json`;
      await store.writeImmutableJson(snapshotPath, {
        snapshotId: item.token, capturedAt: timestamp, observationDate: date,
        store: currentTarget.store, market: currentTarget.market,
        scope: currentTarget.scope, chart: currentTarget.chart,
        normalizedCategory: currentTarget.normalizedCategory,
        marketObservationDate: date, status: item.status,
        actualCount: item.ids.length, expectedCount: 2,
        entries: item.ids.map((appId, index) => ({ appId, rank: index + 1 }))
      });
      await store.writeImmutableJson(`runs/2026/09/${item.day}/${item.token}.json`, {
        schemaVersion: 1, runId: item.token, collectorVersion: "test",
        startedAt: timestamp, finishedAt: timestamp,
        targets: [{
          targetKey: "google-play:US:apps:top-free:all-apps", target: currentTarget,
          status: item.status, startedAt: timestamp, finishedAt: timestamp,
          attempts: 1, snapshotPath, error: null, flags: []
        }]
      });
    }
    const records = metadata(currentTarget, ["app-a", "app-b", "app-c"]);
    const siteDir = path.join(root, "site");
    const catalogDir = path.join(siteDir, "api/catalog/google-play");
    const appDir = path.join(siteDir, "api/apps/google-play/US");
    await mkdir(catalogDir, { recursive: true });
    await mkdir(appDir, { recursive: true });
    await writeFile(path.join(catalogDir, "US.json"), JSON.stringify({
      catalog: Object.fromEntries(records.map((item) => [item.appId, item]))
    }));
    await writeFile(path.join(appDir, "app-a.json"), JSON.stringify({ metadata: records[0] }));

    expect(await buildAgentIndex(root)).toEqual({ runs: 3 });
    const args = ["--store", "google-play", "--market", "US", "--scope", "apps", "--chart", "top-free"];
    const ranking = query(root, "rankings", ...args);
    expect(ranking.marketObservationDate).toBe("2026-09-19");
    expect(ranking.entries.map((item: { appId: string }) => item.appId)).toEqual(["app-b", "app-c"]);
    expect(ranking.snapshotUrl).toContain("/snapshots/google-play/US/apps/top-free/");
    expect(ranking.metadataUrl).toBe("https://apporbit.ooxxz.com/api/catalog/google-play/US.json");
    expect(ranking.websiteUrl).toBe("https://apporbit.ooxxz.com/?store=google-play&market=US&scope=apps&chart=top-free&date=2026-09-19");
    expect(ranking.entries[0].websiteUrl).toBe("https://apporbit.ooxxz.com/app.html?store=google-play&market=US&scope=apps&chart=top-free&id=app-b");
    expect(query(root, "rankings", ...args, "--allow-partial").status).toBe("partial");

    const movers = query(root, "movers", ...args);
    expect(movers.risers).toMatchObject([{ appId: "app-b", movement: 1 }]);
    expect(movers.entrants).toMatchObject([{ appId: "app-c", previousRank: null }]);
    expect(movers.current.websiteUrl).toContain("date=2026-09-19");
    expect(movers.previous.websiteUrl).toContain("date=2026-09-18");
    expect(movers.trendingWebsiteUrl).toBe("https://apporbit.ooxxz.com/trending.html?store=google-play&market=US&scope=apps&chart=top-free");
    const app = query(root, "app", "--store", "google-play", "--market", "US", "--app-id", "app-a");
    expect(app.metadata.name).toBe("app-a");
    expect(app.websiteUrl).toBe("https://apporbit.ooxxz.com/app.html?store=google-play&market=US&id=app-a");
    expect(query(root, "app", "--store", "google-play", "--market", "US", "--app-id", "app-a", "--scope", "games", "--chart", "top-grossing").websiteUrl)
      .toBe("https://apporbit.ooxxz.com/app.html?store=google-play&market=US&scope=games&chart=top-grossing&id=app-a");
    expect(query(root, "search", "--store", "google-play", "--market", "US", "--query", "app-c").matches[0].websiteUrl).toContain("id=app-c");
    expect(query(root, "coverage")).toMatchObject({
      websiteUrl: "https://apporbit.ooxxz.com/data.html",
      publishedTargets: [{ latestOutcome: { status: "partial" } }]
    });
    await rm(path.join(catalogDir, "US.json"));
    const withoutMetadata = query(root, "rankings", ...args);
    expect(withoutMetadata.entries[0].name).toBeNull();
    expect(withoutMetadata.metadataWarning).toBeTruthy();
  });
});
