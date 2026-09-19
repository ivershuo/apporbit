import { afterEach, describe, expect, it, vi } from "vitest";

import { GooglePlayAdapter } from "../src/adapters/google-play.js";
import { target } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Google Play adapter observation timing", () => {
  it("records the ranking response time before app detail enrichment", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-18T02:17:00.000Z");
    const rankedItem = {
      appId: "com.example.app",
      title: "Example App",
      developer: "Example Studio",
      developerId: "Example Studio",
      icon: "https://example.com/icon.png",
      url: "https://play.google.com/store/apps/details?id=com.example.app",
      price: 0,
      free: true
    };
    const client = {
      list: vi.fn(async () => [rankedItem]),
      app: vi.fn(async () => {
        vi.setSystemTime("2026-09-18T03:17:00.000Z");
        return {
          ...rankedItem,
          categories: [{ name: "Productivity", id: "PRODUCTIVITY" }],
          genre: "Productivity",
          genreId: "PRODUCTIVITY",
          installs: "1,000+",
          minInstalls: 1000,
          maxInstalls: 1999
        };
      })
    };

    const observation = await new GooglePlayAdapter(client as never).collect(
      target({ expectedCount: 1 })
    );

    expect(observation.capturedAt).toBe("2026-09-18T02:17:00.000Z");
    expect(observation.metadata[0]?.observedAt).toBe("2026-09-18T03:17:00.000Z");
    expect(observation.source.method).toBe("list+app-details");
    expect(client.list).toHaveBeenCalledWith(expect.objectContaining({ fullDetail: false }));
  });
});
