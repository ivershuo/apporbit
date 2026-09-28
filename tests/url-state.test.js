import { describe, expect, it } from "vitest";

import { appDetailQueryParams, chartQueryParams } from "../site/url-state.js";

const defaults = { store: "apple", market: "US", scope: "apps", chart: "top-free" };

describe("chart URLs", () => {
  it("leaves the default chart URL without query parameters", () => {
    expect(chartQueryParams(defaults).toString()).toBe("");
  });

  it("keeps only nondefault chart selections", () => {
    expect(chartQueryParams({ ...defaults, store: "google-play", market: "JP", scope: "games", chart: "top-grossing" }).toString())
      .toBe("store=google-play&market=JP&scope=games&chart=top-grossing");
  });
});

describe("app detail URLs", () => {
  it("keeps the app identity while omitting default chart context and category", () => {
    expect(appDetailQueryParams({ ...defaults, normalizedCategory: "all-apps" }, "123456").toString())
      .toBe("store=apple&id=123456");
    expect(appDetailQueryParams({ ...defaults, market: "JP" }, "123456").toString())
      .toBe("store=apple&market=JP&id=123456");
  });

  it("preserves nondefault context from other pages and encodes the app ID", () => {
    expect(appDetailQueryParams({ store: "google-play", market: "JP", scope: "games", chart: "top-grossing", normalizedCategory: "all-games" }, "com.example/app").toString())
      .toBe("store=google-play&market=JP&scope=games&chart=top-grossing&id=com.example%2Fapp");
  });
});
