import { describe, expect, it } from "vitest";

import { validateObservation } from "../src/quality.js";
import { observation, target } from "./helpers.js";

describe("quality gate", () => {
  it("accepts a complete, contiguous ranking", () => {
    const result = validateObservation(observation(target()), null);
    expect(result).toEqual({ disposition: "valid", flags: [] });
  });

  it("rejects duplicate IDs", () => {
    const fixture = observation(target());
    fixture.entries[1]!.appId = fixture.entries[0]!.appId;
    expect(() => validateObservation(fixture, null)).toThrow("duplicate app IDs");
  });

  it("marks a usable short response as partial", () => {
    const currentTarget = target({ expectedCount: 25 });
    const fixture = observation(
      currentTarget,
      Array.from({ length: 20 }, (_, index) => `app-${index + 1}`)
    );
    expect(validateObservation(fixture, null)).toEqual({
      disposition: "partial",
      flags: ["count_below_expected:20/25"]
    });
  });

  it("quarantines an implausibly replaced ranking", () => {
    const fixture = observation(target());
    const previous = Array.from({ length: 20 }, (_, index) => ({
      rank: index + 1,
      appId: `previous-${index + 1}`
    }));
    const result = validateObservation(fixture, previous);
    expect(result.disposition).toBe("quarantined");
    expect(result.flags).toContain("suspicious_set_overlap:0.000");
    expect(result.flags).toContain("suspicious_top10_overlap:0.000");
  });
});
