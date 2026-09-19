import { AppMetadataObservationSchema, type Target } from "../domain.js";
import { sha256 } from "../hash.js";
import { collectorUserAgent } from "../http.js";
import { COLLECTOR_VERSION } from "../version.js";
import type { AdapterObservation, MetadataEnrichment, StoreAdapter } from "./types.js";

const APPLE_ADAPTER_VERSION = "apple-rss-v3+itunes-lookup";
const MAX_RSS_RESPONSE_BYTES = 2_000_000;
const MAX_LOOKUP_RESPONSE_BYTES = 8_000_000;
const LOOKUP_BATCH_SIZE = 50;

interface AppleItem {
  id: string;
  name: string;
  artistName: string;
  artworkUrl100: string;
  url: string;
  genres?: Array<{ genreId?: string; name?: string; url?: string }>;
}

interface ApplePayload {
  feed?: {
    results?: AppleItem[];
  };
}

interface AppleLookupItem {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  artistId?: number;
  artistViewUrl?: string;
  sellerUrl?: string;
  bundleId?: string;
  artworkUrl100?: string;
  artworkUrl512?: string;
  trackViewUrl?: string;
  primaryGenreName?: string;
  primaryGenreId?: number;
  genres?: string[];
  description?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  price?: number;
  formattedPrice?: string;
  currency?: string;
  releaseDate?: string;
  currentVersionReleaseDate?: string;
  version?: string;
  minimumOsVersion?: string;
  trackContentRating?: string;
  fileSizeBytes?: string;
  languageCodesISO2A?: string[];
}

interface AppleLookupPayload {
  results?: AppleLookupItem[];
}

interface AppleEnrichmentContext {
  kind: "apple";
  items: AppleItem[];
}

interface FetchResult<T> {
  body: string;
  payload: T;
  attempts: number;
}

function feedName(target: Target): "top-free" | "top-paid" {
  if (target.chart === "top-free" || target.chart === "top-paid") {
    return target.chart;
  }
  throw new Error(`Apple chart is not supported by the RSS adapter: ${target.chart}`);
}

function isJsonResponse(contentType: string): boolean {
  const value = contentType.toLowerCase();
  return value.includes("application/json") || value.includes("text/json") || value.includes("text/javascript");
}

async function fetchJsonWithRetry<T>(url: string, maximumBytes: number): Promise<FetchResult<T>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": collectorUserAgent()
        },
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) {
        throw new Error(`Apple endpoint returned HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!isJsonResponse(contentType)) {
        throw new Error(`Apple endpoint returned unexpected content type: ${contentType}`);
      }
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > maximumBytes) {
        throw new Error(`Apple response exceeded the ${maximumBytes} byte safety limit`);
      }
      return { body, payload: JSON.parse(body) as T, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  const error = lastError instanceof Error ? lastError : new Error("Apple request failed");
  Object.assign(error, { attempts: 3 });
  throw error;
}

function lookupUrl(ids: string[], market: string): string {
  const search = new URLSearchParams({ id: ids.join(","), country: market.toLowerCase() });
  return `https://itunes.apple.com/lookup?${search}`;
}

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function validIsoDateTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function nonnegativeInteger(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function nonnegativeNumber(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value! >= 0 ? value : undefined;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function errorAttempts(error: unknown): number {
  if (typeof error === "object" && error !== null && "attempts" in error) {
    const attempts = Number(error.attempts);
    if (Number.isInteger(attempts) && attempts > 0) return attempts;
  }
  return 1;
}

export class AppleAdapter implements StoreAdapter {
  async collectRanking(target: Target): Promise<AdapterObservation> {
    if (target.store !== "apple") {
      throw new Error("AppleAdapter received a non-Apple target");
    }
    if (target.scope !== "apps") {
      throw new Error("Apple Games charts are not verified and remain unsupported");
    }

    const url = `https://rss.marketingtools.apple.com/api/v2/${target.market.toLowerCase()}/apps/${feedName(target)}/${target.expectedCount}/apps.json`;
    const rss = await fetchJsonWithRetry<ApplePayload>(url, MAX_RSS_RESPONSE_BYTES);
    const items = rss.payload.feed?.results;
    if (!Array.isArray(items)) {
      throw new Error("Apple RSS payload is missing feed.results");
    }

    // Capture and return the chart before the separate metadata stage begins.
    const capturedAt = new Date().toISOString();

    return {
      target,
      capturedAt,
      attempts: rss.attempts,
      flags: [],
      entries: items.map((item, index) => ({ rank: index + 1, appId: item.id })),
      enrichmentContext: {
        kind: "apple",
        items
      } satisfies AppleEnrichmentContext,
      source: {
        type: "apple-rss",
        method: "rss-marketing-tools-v2",
        url,
        collectorVersion: COLLECTOR_VERSION,
        adapterVersion: APPLE_ADAPTER_VERSION,
        payloadSha256: sha256(rss.payload)
      }
    };
  }

  async enrichMetadata(observation: AdapterObservation): Promise<MetadataEnrichment> {
    const context = observation.enrichmentContext as Partial<AppleEnrichmentContext>;
    if (context.kind !== "apple" || !Array.isArray(context.items)) {
      throw new Error("AppleAdapter received invalid enrichment context");
    }

    const { target } = observation;
    const items = context.items;
    const flags: string[] = [];
    let attempts = 1;
    const detailsById = new Map<string, AppleLookupItem>();
    const lookupOutcomes = await Promise.all(
      batches(items.map((item) => item.id), LOOKUP_BATCH_SIZE).map(async (ids, index) => {
        try {
          const result = await fetchJsonWithRetry<AppleLookupPayload>(
            lookupUrl(ids, target.market),
            MAX_LOOKUP_RESPONSE_BYTES
          );
          return { index, result } as const;
        } catch (error) {
          return { index, error } as const;
        }
      })
    );

    for (const outcome of lookupOutcomes) {
      if ("error" in outcome) {
        attempts = Math.max(attempts, errorAttempts(outcome.error));
        flags.push(`metadata_enrichment_failed:apple_lookup_batch_${outcome.index + 1}`);
        continue;
      }
      attempts = Math.max(attempts, outcome.result.attempts);
      for (const detail of outcome.result.payload.results ?? []) {
        if (detail.trackId !== undefined) detailsById.set(String(detail.trackId), detail);
      }
    }

    const metadataObservedAt = new Date().toISOString();
    const metadata = items.map((item) => {
      const detail = detailsById.get(item.id);
      const price = nonnegativeNumber(detail?.price);
      const categories = detail?.genres?.filter(Boolean) ?? (item.genres ?? []).flatMap((genre) =>
        genre.name ? [genre.name] : []
      );
      return AppMetadataObservationSchema.parse({
        store: "apple",
        appId: item.id,
        name: optionalText(detail?.trackName) ?? item.name,
        developer: optionalText(detail?.artistName) ?? item.artistName,
        developerId: detail?.artistId === undefined ? undefined : String(detail.artistId),
        developerWebsite: optionalText(detail?.sellerUrl) ?? optionalText(detail?.artistViewUrl),
        bundleId: optionalText(detail?.bundleId),
        iconUrl: detail?.artworkUrl512 ?? detail?.artworkUrl100 ?? item.artworkUrl100,
        storeUrl: detail?.trackViewUrl ?? item.url,
        storeCategories: categories,
        primaryGenreId: detail?.primaryGenreId === undefined
          ? item.genres?.[0]?.genreId
          : String(detail.primaryGenreId),
        observedChartCategory: detail?.primaryGenreName ?? categories[0] ?? target.normalizedCategory,
        observedAt: metadataObservedAt,
        market: target.market,
        description: optionalText(detail?.description),
        rating: detail?.averageUserRating,
        ratingsCount: nonnegativeInteger(detail?.userRatingCount),
        released: optionalText(detail?.releaseDate),
        updatedAt: validIsoDateTime(detail?.currentVersionReleaseDate),
        version: optionalText(detail?.version),
        minimumOsVersion: optionalText(detail?.minimumOsVersion),
        contentRating: optionalText(detail?.trackContentRating),
        fileSizeBytes: nonnegativeInteger(detail?.fileSizeBytes),
        languages: detail?.languageCodesISO2A?.filter(Boolean),
        price,
        priceText: optionalText(detail?.formattedPrice),
        currency: optionalText(detail?.currency),
        free: price === undefined ? undefined : price === 0
      });
    });

    return {
      attempts,
      flags,
      metadata
    };
  }
}
