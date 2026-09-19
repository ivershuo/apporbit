import type { Snapshot, Target } from "./domain.js";

export interface UtcPathParts {
  year: string;
  month: string;
  day: string;
  token: string;
}

export function utcPathParts(timestamp: string): UtcPathParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(
    timestamp
  );
  if (!match) throw new Error(`expected a UTC ISO timestamp: ${timestamp}`);
  const [, year, month, day, hour, minute, second, milliseconds = "000"] = match;
  return {
    year: year!,
    month: month!,
    day: day!,
    token: `${year}${month}${day}T${hour}${minute}${second}${milliseconds}Z`
  };
}

export function targetSlug(target: Target): string {
  return [target.store, target.market, target.scope, target.chart, target.normalizedCategory]
    .join("-")
    .toLowerCase();
}

export function snapshotPath(snapshot: Snapshot, prefix = "snapshots"): string {
  const time = utcPathParts(snapshot.capturedAt);
  const date = snapshot.marketObservationDate ?? snapshot.observationDate;
  const [year, month, day] = date.split("-");
  return [
    prefix,
    snapshot.store,
    snapshot.market,
    snapshot.scope,
    snapshot.chart,
    year,
    month,
    day,
    `${time.token}.json`
  ].join("/");
}

export function datedPath(prefix: string, timestamp: string, fileName: string): string {
  const time = utcPathParts(timestamp);
  return [prefix, time.year, time.month, time.day, fileName].join("/");
}
