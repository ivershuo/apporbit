import { describe, expect, it } from "vitest";

import type { RunTargetOutcome } from "../src/domain.js";
import { evaluateRunHealth } from "../src/run-health.js";
import { target } from "./helpers.js";

function outcome(status: RunTargetOutcome["status"]): RunTargetOutcome {
  return {
    targetKey: `test:${status}`,
    target: target(),
    status,
    startedAt: "2026-09-20T00:00:00.000Z",
    finishedAt: "2026-09-20T00:00:01.000Z",
    attempts: 1,
    snapshotPath: status === "valid" || status === "partial" ? "snapshots/test.json" : null,
    error: status === "failed" ? { kind: "fixture", message: "unavailable" } : null,
    flags: []
  };
}

describe("run health", () => {
  it("accepts partial snapshots as usable data", () => {
    const result = evaluateRunHealth(
      [outcome("valid"), outcome("partial"), outcome("failed"), outcome("valid")],
      0.75
    );

    expect(result).toEqual({
      totalTargets: 4,
      usableTargets: 3,
      unusableTargets: 1,
      usableRatio: 0.75,
      meetsMinimum: true
    });
  });

  it("rejects a run below the configured usable ratio", () => {
    const result = evaluateRunHealth(
      [outcome("valid"), outcome("failed"), outcome("quarantined"), outcome("failed")],
      0.75
    );

    expect(result.usableRatio).toBe(0.25);
    expect(result.meetsMinimum).toBe(false);
  });

  it("rejects invalid thresholds", () => {
    expect(() => evaluateRunHealth([], 1.01)).toThrow(/between 0 and 1/);
  });
});
