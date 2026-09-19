import {
  RankingEntrySchema,
  type RankingEntry,
  type SnapshotStatus
} from "./domain.js";
import type { AdapterObservation } from "./adapters/types.js";

export type QualityDisposition = SnapshotStatus | "quarantined";

export interface QualityResult {
  disposition: QualityDisposition;
  flags: string[];
}

const MINIMUM_USABLE_COUNT = 20;
const MINIMUM_SET_OVERLAP = 0.25;
const MINIMUM_TOP_TEN_OVERLAP = 0.2;
const MAXIMUM_COUNT_DROP = 0.35;

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

export function validateObservation(
  observation: AdapterObservation,
  previousEntries: RankingEntry[] | null
): QualityResult {
  const entries = observation.entries.map((entry) => RankingEntrySchema.parse(entry));
  const flags = [...observation.flags];
  const ids = entries.map((entry) => entry.appId);

  if (entries.some((entry, index) => entry.rank !== index + 1)) {
    throw new Error("ranking is not contiguous and one-based");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("ranking contains duplicate app IDs");
  }
  if (entries.length < Math.min(MINIMUM_USABLE_COUNT, observation.target.expectedCount)) {
    throw new Error(
      `ranking has ${entries.length} entries, below the minimum usable count`
    );
  }

  let disposition: QualityDisposition =
    entries.length < observation.target.expectedCount ? "partial" : "valid";
  if (disposition === "partial") {
    flags.push(`count_below_expected:${entries.length}/${observation.target.expectedCount}`);
  }
  if (flags.some((flag) => flag.startsWith("source_integrity:"))) {
    disposition = "quarantined";
  } else if (
    disposition === "valid" &&
    flags.some((flag) => flag.startsWith("source_degradation:"))
  ) {
    disposition = "partial";
  }

  if (previousEntries && previousEntries.length > 0) {
    const countDrop = 1 - entries.length / previousEntries.length;
    if (countDrop > MAXIMUM_COUNT_DROP) {
      flags.push(`suspicious_count_drop:${countDrop.toFixed(3)}`);
      disposition = "quarantined";
    }

    const overlap = jaccard(new Set(ids), new Set(previousEntries.map((entry) => entry.appId)));
    if (overlap < MINIMUM_SET_OVERLAP) {
      flags.push(`suspicious_set_overlap:${overlap.toFixed(3)}`);
      disposition = "quarantined";
    }

    const topTenOverlap = jaccard(
      new Set(ids.slice(0, 10)),
      new Set(previousEntries.slice(0, 10).map((entry) => entry.appId))
    );
    if (topTenOverlap < MINIMUM_TOP_TEN_OVERLAP) {
      flags.push(`suspicious_top10_overlap:${topTenOverlap.toFixed(3)}`);
      disposition = "quarantined";
    }
  }

  return { disposition, flags: [...new Set(flags)].sort() };
}
