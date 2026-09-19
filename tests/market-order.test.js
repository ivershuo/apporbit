import { describe, expect, it } from "vitest";

import { marketsByScale } from "../site/market-order.js";

describe("market scale ordering", () => {
  it("orders supported markets by business scale instead of alphabetically", () => {
    expect(marketsByScale(["VN", "DE", "US", "BR", "JP", "CN", "KR", "GB", "IN", "ID"]))
      .toEqual(["US", "CN", "JP", "KR", "GB", "DE", "BR", "IN", "ID", "VN"]);
  });

  it("deduplicates markets and alphabetizes unknown codes at the end", () => {
    expect(marketsByScale(["ZZ", "US", "AA", "US"]))
      .toEqual(["US", "AA", "ZZ"]);
  });
});
