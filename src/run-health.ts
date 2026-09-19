import type { RunTargetOutcome } from "./domain.js";

export interface RunHealth {
  totalTargets: number;
  usableTargets: number;
  unusableTargets: number;
  usableRatio: number;
  meetsMinimum: boolean;
}

const usableStatuses = new Set<RunTargetOutcome["status"]>(["valid", "partial"]);

export function evaluateRunHealth(
  outcomes: RunTargetOutcome[],
  minimumUsableRatio: number
): RunHealth {
  if (
    !Number.isFinite(minimumUsableRatio) ||
    minimumUsableRatio < 0 ||
    minimumUsableRatio > 1
  ) {
    throw new Error("minimum usable ratio must be a number between 0 and 1");
  }

  const totalTargets = outcomes.length;
  const usableTargets = outcomes.filter((outcome) => usableStatuses.has(outcome.status)).length;
  const usableRatio = totalTargets === 0 ? 0 : usableTargets / totalTargets;
  return {
    totalTargets,
    usableTargets,
    unusableTargets: totalTargets - usableTargets,
    usableRatio,
    meetsMinimum: usableRatio >= minimumUsableRatio
  };
}
