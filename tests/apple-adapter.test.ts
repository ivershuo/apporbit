import { afterEach, describe, expect, it, vi } from "vitest";

import { AppleAdapter } from "../src/adapters/apple.js";
import { TargetSchema } from "../src/domain.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Apple adapter metadata enrichment", () => {
  it("merges iTunes Lookup fields without truncating the store description", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-18T02:17:00.000Z");
    const description = Array.from({ length: 80 }, () => "A complete description.").join(" ");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://itunes.apple.com/lookup?")) {
        vi.setSystemTime("2026-09-18T03:17:00.000Z");
        return jsonResponse({
          resultCount: 1,
          results: [{
            trackId: 123,
            trackName: "Example App",
            artistName: "Example Studio",
            artistId: 456,
            sellerUrl: "https://example.com",
            bundleId: "com.example.app",
            artworkUrl512: "https://example.com/icon-512.png",
            trackViewUrl: "https://apps.apple.com/us/app/example/id123",
            primaryGenreName: "Productivity",
            primaryGenreId: 6007,
            genres: ["Productivity", "Utilities"],
            description,
            averageUserRating: 4.75,
            userRatingCount: 1200,
            price: 1.99,
            formattedPrice: "$1.99",
            currency: "USD",
            releaseDate: "2025-01-02T08:00:00Z",
            currentVersionReleaseDate: "2026-09-18T08:30:00Z",
            version: "2.4.0",
            minimumOsVersion: "17.0",
            trackContentRating: "12+",
            fileSizeBytes: "10485760",
            languageCodesISO2A: ["EN", "JA"]
          }]
        });
      }
      return jsonResponse({
        feed: {
          results: [{
            id: "123",
            name: "Example",
            artistName: "Studio",
            artworkUrl100: "https://example.com/icon-100.png",
            url: "https://apps.apple.com/us/app/example/id123",
            genres: [{ genreId: "6007", name: "Productivity" }]
          }]
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const target = TargetSchema.parse({
      store: "apple",
      market: "US",
      marketTimeZone: "America/New_York",
      language: "en",
      scope: "apps",
      chart: "top-paid",
      normalizedCategory: "all-apps",
      storeCategory: null,
      expectedCount: 1,
      publicationMode: "probe"
    });
    const adapter = new AppleAdapter();
    const observation = await adapter.collectRanking(target);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(observation.source.method).toBe("rss-marketing-tools-v2");
    expect(observation.capturedAt).toBe("2026-09-18T02:17:00.000Z");
    const enrichment = await adapter.enrichMetadata(observation);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(enrichment.metadata[0]?.observedAt).toBe("2026-09-18T03:17:00.000Z");
    expect(enrichment.flags).toEqual([]);
    expect(enrichment.metadata[0]).toMatchObject({
      appId: "123",
      name: "Example App",
      developer: "Example Studio",
      developerId: "456",
      developerWebsite: "https://example.com",
      bundleId: "com.example.app",
      primaryGenreId: "6007",
      storeCategories: ["Productivity", "Utilities"],
      rating: 4.75,
      ratingsCount: 1200,
      price: 1.99,
      priceText: "$1.99",
      free: false,
      version: "2.4.0",
      minimumOsVersion: "17.0",
      contentRating: "12+",
      fileSizeBytes: 10_485_760,
      languages: ["EN", "JA"],
      description
    });
  });
});

describe("Apple Games category RSS", () => {
  const target = TargetSchema.parse({
    store: "apple",
    market: "US",
    marketTimeZone: "America/New_York",
    language: "en",
    scope: "games",
    chart: "top-free",
    normalizedCategory: "all-games",
    storeCategory: "6014",
    expectedCount: 1,
    publicationMode: "probe"
  });

  function categoryEntry(genreId = "6014") {
    return {
      "im:name": { label: "Example Game" },
      "im:artist": { label: "Game Studio" },
      "im:image": [{ label: "https://example.com/icon-53.png" }, { label: "https://example.com/icon-100.png" }],
      id: { label: "https://apps.apple.com/us/app/example-game/id123", attributes: { "im:id": "123" } },
      category: { attributes: { "im:id": genreId, label: "Games" } }
    };
  }

  it("uses Apple's Games chart and retains its rank and metadata", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("https://itunes.apple.com/lookup?")) {
        return jsonResponse({ resultCount: 0, results: [] });
      }
      return new Response(JSON.stringify({ feed: { entry: [categoryEntry()] } }), {
        status: 200,
        headers: { "content-type": "text/javascript; charset=UTF-8" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new AppleAdapter();
    const observation = await adapter.collectRanking(target);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://itunes.apple.com/us/rss/topfreeapplications/limit=1/genre=6014/json",
      expect.any(Object)
    );
    expect(observation.source).toMatchObject({ type: "apple-rss", method: "itunes-rss-category" });
    expect(observation.entries).toEqual([{ rank: 1, appId: "123" }]);
    const enrichment = await adapter.enrichMetadata(observation);
    expect(enrichment.metadata[0]).toMatchObject({
      store: "apple",
      market: "US",
      appId: "123",
      name: "Example Game",
      developer: "Game Studio",
      iconUrl: "https://example.com/icon-100.png",
      storeCategories: ["Games"],
      primaryGenreId: "6014"
    });
  });

  it("rejects a category feed that is not a Games chart", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ feed: { entry: [categoryEntry("6007")] } })));
    await expect(new AppleAdapter().collectRanking(target)).rejects.toThrow("is not a game");
  });

  it("uses the paid Games feed for the top-paid chart", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ feed: { entry: [categoryEntry()] } }));
    vi.stubGlobal("fetch", fetchMock);
    await new AppleAdapter().collectRanking({ ...target, chart: "top-paid" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://itunes.apple.com/us/rss/toppaidapplications/limit=1/genre=6014/json",
      expect.any(Object)
    );
  });
});
