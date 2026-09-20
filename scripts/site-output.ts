import type { AppMetadataObservation } from "../src/domain.js";
import type { RunWithPath } from "./site-data.js";

export function compactRuns(runs: RunWithPath[]) {
  return runs.map((run) => ({
    runId: run.runId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    targets: run.targets.map((outcome) => ({
      targetKey: outcome.targetKey,
      target: outcome.target,
      status: outcome.status,
      finishedAt: outcome.finishedAt,
      snapshotPath: outcome.snapshotPath
    }))
  }));
}

export function compactMetadata(item: AppMetadataObservation) {
  return {
    store: item.store,
    market: item.market,
    appId: item.appId,
    name: item.name,
    developer: item.developer,
    iconUrl: item.iconUrl,
    storeUrl: item.storeUrl,
    storeCategories: item.storeCategories,
    observedAt: item.observedAt,
    rating: item.rating,
    ratingsCount: item.ratingsCount,
    installRange: item.installRange,
    minInstalls: item.minInstalls,
    maxInstalls: item.maxInstalls,
    price: item.price,
    priceText: item.priceText,
    free: item.free,
    offersIAP: item.offersIAP,
    iapRange: item.iapRange,
    adSupported: item.adSupported,
    contentRating: item.contentRating,
    version: item.version,
    minimumOsVersion: item.minimumOsVersion,
    released: item.released,
    updatedAt: item.updatedAt
  };
}

function distinctAppKey(item: AppMetadataObservation): string {
  return `${item.store}:${item.appId}`;
}

function groupedDistinctCounts(
  records: AppMetadataObservation[],
  valuesForRecord: (record: AppMetadataObservation) => string[]
): Array<{ name: string; count: number }> {
  const groups = new Map<string, Set<string>>();
  for (const item of records) {
    for (const value of valuesForRecord(item)) {
      if (!value) continue;
      const apps = groups.get(value) ?? new Set<string>();
      apps.add(distinctAppKey(item));
      groups.set(value, apps);
    }
  }
  return [...groups.entries()]
    .map(([name, apps]) => ({ name, count: apps.size }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function buildCatalogStats(catalog: Record<string, AppMetadataObservation>) {
  const records = Object.values(catalog);
  const uniqueApps = new Set(records.map(distinctAppKey));
  const developers = new Set(records.map((item) => item.developer).filter(Boolean));
  const latestObserved = records.map((item) => item.observedAt).sort().at(-1) ?? null;
  const dimensions = [
    ["Ratings", (item: AppMetadataObservation) => Number.isFinite(item.rating) || Number.isFinite(item.ratingsCount)],
    ["Installs", (item: AppMetadataObservation) => Boolean(item.installRange) || Number.isFinite(item.minInstalls) || Number.isFinite(item.maxInstalls)],
    ["App pricing", (item: AppMetadataObservation) => item.free !== undefined || Boolean(item.priceText) || Number.isFinite(item.price)],
    ["Monetization", (item: AppMetadataObservation) => item.offersIAP !== undefined || item.adSupported !== undefined || Boolean(item.iapRange)],
    ["Lifecycle", (item: AppMetadataObservation) => Boolean(item.released) || Boolean(item.updatedAt) || Boolean(item.version)],
    ["Compatibility", (item: AppMetadataObservation) => Boolean(item.minimumOsVersion) || Boolean(item.contentRating) || Number.isFinite(item.fileSizeBytes)]
  ] as const;

  const markets = new Map<string, { apple: number; googlePlay: number }>();
  for (const item of records) {
    const counts = markets.get(item.market) ?? { apple: 0, googlePlay: 0 };
    if (item.store === "apple") counts.apple += 1;
    if (item.store === "google-play") counts.googlePlay += 1;
    markets.set(item.market, counts);
  }

  return {
    records: records.length,
    apps: uniqueApps.size,
    developers: developers.size,
    latestObserved,
    dimensions: dimensions.map(([name, predicate]) => ({
      name,
      count: records.filter(predicate).length
    })),
    categories: groupedDistinctCounts(records, (record) => record.storeCategories ?? []).slice(0, 10),
    topDevelopers: groupedDistinctCounts(
      records,
      (record) => record.developer ? [record.developer] : []
    ).slice(0, 10),
    markets: [...markets.entries()].map(([market, counts]) => ({ market, ...counts }))
  };
}

export type CompactRun = ReturnType<typeof compactRuns>[number];
export type CatalogStats = ReturnType<typeof buildCatalogStats>;
