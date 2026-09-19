import type { AdapterObservation, StoreAdapter } from "../src/adapters/types.js";
import { TargetSchema, type Target } from "../src/domain.js";

export function target(overrides: Partial<Target> = {}): Target {
  return TargetSchema.parse({
    store: "google-play",
    market: "US",
    marketTimeZone: "America/New_York",
    language: "en",
    scope: "apps",
    chart: "top-free",
    normalizedCategory: "all-apps",
    storeCategory: "APPLICATION",
    expectedCount: 20,
    publicationMode: "publish",
    ...overrides
  });
}

export function observation(
  currentTarget: Target,
  ids = Array.from({ length: currentTarget.expectedCount }, (_, index) => `app-${index + 1}`)
): AdapterObservation {
  const capturedAt = "2026-09-18T02:17:42.000Z";
  return {
    target: currentTarget,
    capturedAt,
    attempts: 1,
    flags: [],
    entries: ids.map((appId, index) => ({ rank: index + 1, appId })),
    metadata: ids.map((appId) => ({
      store: currentTarget.store,
      appId,
      name: appId,
      developer: "Example Developer",
      iconUrl: `https://example.com/icons/${appId}.png`,
      storeUrl: `https://example.com/apps/${appId}`,
      storeCategories: [],
      observedChartCategory: currentTarget.normalizedCategory,
      observedAt: capturedAt,
      market: currentTarget.market
    })),
    source: {
      type: currentTarget.store === "apple" ? "apple-rss" : "google-play-scraper",
      method: "fixture",
      url: "https://example.com/source",
      collectorVersion: "test",
      adapterVersion: "test",
      payloadSha256: "0".repeat(64)
    }
  };
}

export class FixtureAdapter implements StoreAdapter {
  constructor(readonly handler: (value: Target) => Promise<AdapterObservation>) {}

  collect(value: Target): Promise<AdapterObservation> {
    return this.handler(value);
  }
}
