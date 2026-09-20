import { describe, expect, it } from "vitest";

import { AppMetadataObservationSchema } from "../src/domain.js";
import { buildCatalogStats, compactMetadata, compactRuns } from "../scripts/site-output.js";

function record(market: string, overrides: Record<string, unknown> = {}) {
  return AppMetadataObservationSchema.parse({
    store: "google-play",
    market,
    appId: "com.example.app",
    name: "Example App",
    developer: "Example Studio",
    iconUrl: "https://example.com/icon.png",
    storeUrl: "https://example.com/app",
    storeCategories: ["Tools"],
    observedChartCategory: "Tools",
    observedAt: "2026-09-20T02:17:00.000Z",
    description: "A deliberately large full description",
    summary: "Full summary",
    rating: 4.5,
    ratingsCount: 100,
    ...overrides
  });
}

describe("static site output", () => {
  it("keeps heavy detail fields out of market catalog summaries", () => {
    const summary = compactMetadata(record("US"));

    expect(summary).toMatchObject({
      appId: "com.example.app",
      name: "Example App",
      rating: 4.5
    });
    expect(summary).not.toHaveProperty("description");
    expect(summary).not.toHaveProperty("summary");
  });

  it("precomputes global catalog statistics without shipping catalog records", () => {
    const us = record("US");
    const jp = record("JP", { observedAt: "2026-09-20T03:17:00.000Z" });
    const stats = buildCatalogStats({
      "google-play:US:com.example.app": us,
      "google-play:JP:com.example.app": jp
    });

    expect(stats).toMatchObject({
      records: 2,
      apps: 1,
      developers: 1,
      latestObserved: "2026-09-20T03:17:00.000Z"
    });
    expect(stats.markets).toEqual(expect.arrayContaining([
      { market: "US", apple: 0, googlePlay: 1 },
      { market: "JP", apple: 0, googlePlay: 1 }
    ]));
  });

  it("removes diagnostic fields from the browser run index", () => {
    const compact = compactRuns([{
      schemaVersion: 1,
      runId: "20260920T021700000Z",
      collectorVersion: "test",
      startedAt: "2026-09-20T02:17:00.000Z",
      finishedAt: "2026-09-20T02:18:00.000Z",
      manifestPath: "probes/runs/2026/09/20/run.json",
      targets: [{
        targetKey: "google-play:US:apps:top-free:all-apps",
        target: {
          store: "google-play",
          market: "US",
          marketTimeZone: "America/New_York",
          language: "en",
          scope: "apps",
          chart: "top-free",
          normalizedCategory: "all-apps",
          storeCategory: "APPLICATION",
          expectedCount: 100,
          publicationMode: "probe"
        },
        status: "valid",
        startedAt: "2026-09-20T02:17:00.000Z",
        finishedAt: "2026-09-20T02:18:00.000Z",
        attempts: 3,
        snapshotPath: "probes/snapshots/example.json",
        error: null,
        flags: ["diagnostic"]
      }]
    }]);

    expect(compact[0]?.targets[0]).not.toHaveProperty("attempts");
    expect(compact[0]?.targets[0]).not.toHaveProperty("flags");
    expect(compact[0]?.targets[0]).not.toHaveProperty("error");
  });
});
