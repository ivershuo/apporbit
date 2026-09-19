import { describe, expect, it } from "vitest";

import { calendarDateInTimeZone } from "../src/time.js";

describe("market calendar dates", () => {
  it("uses the market date across the UTC boundary", () => {
    expect(calendarDateInTimeZone("2026-09-18T02:17:00.000Z", "America/New_York"))
      .toBe("2026-09-17");
    expect(calendarDateInTimeZone("2026-09-18T19:17:00.000Z", "Asia/Tokyo"))
      .toBe("2026-09-19");
  });
});
