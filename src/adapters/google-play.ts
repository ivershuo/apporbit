import {
  BlockedError,
  HttpError,
  ParseError,
  RateLimitError,
  category,
  collection,
  createClient,
  type Category,
  type Collection
} from "@mradex77/google-play-scraper";
import type { App as GooglePlayApp, AppItem as GooglePlayAppItem } from "@mradex77/google-play-scraper";

import { AppMetadataObservationSchema, type Chart, type Scope, type Target } from "../domain.js";
import { sha256 } from "../hash.js";
import { collectorUserAgent } from "../http.js";
import { COLLECTOR_VERSION } from "../version.js";
import type { AdapterObservation, MetadataEnrichment, StoreAdapter } from "./types.js";

const GOOGLE_ADAPTER_VERSION = "@mradex77/google-play-scraper@1.2.0";
type GooglePlayClient = Pick<ReturnType<typeof createClient>, "list" | "app">;
export const GOOGLE_PLAY_REQUESTS_PER_SECOND = 3;
const DETAIL_CONCURRENCY_PER_TARGET = 5;

interface GooglePlayEnrichmentContext {
  kind: "google-play";
  items: GooglePlayAppItem[];
}

interface GooglePlayDetailResult {
  detail: GooglePlayApp;
  attempts: number;
  flags: string[];
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

function chartCollection(chart: Chart): Collection {
  const mapping: Record<Chart, Collection> = {
    "top-free": collection.TOP_FREE,
    "top-paid": collection.TOP_PAID,
    "top-grossing": collection.GROSSING
  };
  return mapping[chart];
}

function scopeCategory(scope: Scope): Category {
  return scope === "apps" ? category.APPLICATION : category.GAME;
}

function sourceUrl(target: Target): string {
  const path = target.scope === "games" ? "/store/games" : "/store/apps";
  return `https://play.google.com${path}?hl=${target.language}&gl=${target.market}`;
}

function updatedAtFromEpoch(value: number | undefined): string | undefined {
  if (!Number.isFinite(value) || !value || value < 0) return undefined;
  return new Date(value).toISOString();
}

function failureAttempts(error: unknown): number {
  if (typeof error !== "object" || error === null || !("attempts" in error)) return 1;
  const attempts = Number(error.attempts);
  return Number.isInteger(attempts) && attempts > 0 ? attempts : 1;
}

function failureFlags(error: unknown): string[] {
  if (typeof error !== "object" || error === null || !("metadataFlags" in error)) return [];
  return Array.isArray(error.metadataFlags)
    ? error.metadataFlags.filter((flag): flag is string => typeof flag === "string")
    : [];
}

export class GooglePlayAdapter implements StoreAdapter {
  readonly #client: GooglePlayClient;
  readonly #detailRequests = new Map<string, Promise<GooglePlayDetailResult>>();

  constructor(client?: GooglePlayClient) {
    this.#client = client ?? createClient({
      throttle: GOOGLE_PLAY_REQUESTS_PER_SECOND,
      requestOptions: {
        timeoutMs: 30_000,
        retries: 2,
        headers: {
          "user-agent": collectorUserAgent()
        }
      }
    });
  }

  async collectRanking(target: Target): Promise<AdapterObservation> {
    if (target.store !== "google-play") {
      throw new Error("GooglePlayAdapter received a non-Google-Play target");
    }
    if (target.market === "CN") {
      throw new Error("Google Play charts are unsupported for market CN");
    }

    const flags: string[] = [];
    let attempts = 1;
    let items;
    try {
      items = await this.#client.list({
        country: target.market.toLowerCase(),
        lang: target.language,
        collection: chartCollection(target.chart),
        category: scopeCategory(target.scope),
        num: target.expectedCount,
        fullDetail: false,
        onDegradation: (event) => flags.push(`source_degradation:${event.reason}`),
        onIntegrityEvent: (event) => flags.push(`source_integrity:${event.reason}`),
        requestOptions: {
          onRetry: (event) => {
            attempts = Math.max(attempts, event.attempt + 1);
          }
        }
      });
    } catch (error) {
      if (error instanceof Error) Object.assign(error, { attempts });
      throw error;
    }

    // This timestamp belongs only to the ranking response. The pipeline persists
    // the resulting snapshot before starting any metadata enrichment.
    const capturedAt = new Date().toISOString();
    const rankedItems = items as GooglePlayAppItem[];

    return {
      target,
      capturedAt,
      attempts,
      flags,
      entries: rankedItems.map((item, index) => ({ rank: index + 1, appId: item.appId })),
      enrichmentContext: {
        kind: "google-play",
        items: rankedItems
      } satisfies GooglePlayEnrichmentContext,
      source: {
        type: "google-play-scraper",
        method: "list",
        url: sourceUrl(target),
        collectorVersion: COLLECTOR_VERSION,
        adapterVersion: GOOGLE_ADAPTER_VERSION,
        payloadSha256: sha256(rankedItems)
      }
    };
  }

  async enrichMetadata(observation: AdapterObservation): Promise<MetadataEnrichment> {
    const context = observation.enrichmentContext as Partial<GooglePlayEnrichmentContext>;
    if (context.kind !== "google-play" || !Array.isArray(context.items)) {
      throw new Error("GooglePlayAdapter received invalid enrichment context");
    }

    const { target } = observation;
    const flags: string[] = [];
    let attempts = 1;
    const rankedItems = context.items;
    const detailResults = await mapWithConcurrency(
      rankedItems,
      DETAIL_CONCURRENCY_PER_TARGET,
      async (item) => {
        try {
          return { status: "fulfilled" as const, value: await this.#loadDetail(target, item.appId) };
        } catch (reason) {
          return { status: "rejected" as const, reason };
        }
      }
    );
    const detailsById = new Map<string, GooglePlayApp>();
    let failedDetails = 0;
    for (const result of detailResults) {
      if (result.status === "fulfilled") {
        detailsById.set(result.value.detail.appId, result.value.detail);
        attempts = Math.max(attempts, result.value.attempts);
        flags.push(...result.value.flags);
      } else {
        failedDetails += 1;
        attempts = Math.max(attempts, failureAttempts(result.reason));
        flags.push(...failureFlags(result.reason));
      }
    }
    if (failedDetails > 0) {
      flags.push(`metadata_enrichment_failed:google_play_app_details:${failedDetails}/${rankedItems.length}`);
    }
    const metadataObservedAt = new Date().toISOString();
    const listItems = rankedItems.map((item) => {
      const detail = detailsById.get(item.appId);
      return {
        appId: item.appId,
        title: item.title,
        developer: item.developer,
        developerId: detail?.developerId ?? item.developerId,
        developerWebsite: detail?.developerWebsite,
        icon: item.icon,
        url: item.url,
        storeCategories: detail?.categories?.map((entry) => entry.name) ?? [],
        primaryGenreId: detail?.genreId,
        summary: detail?.summary ?? item.summary,
        description: detail?.description,
        installRange: detail?.installs,
        minInstalls: detail?.minInstalls,
        maxInstalls: detail?.maxInstalls,
        rating: detail?.score,
        ratingsCount: detail?.ratings,
        reviewsCount: detail?.reviews,
        released: detail?.released,
        updatedAt: updatedAtFromEpoch(detail?.updated),
        version: detail?.version,
        minimumOsVersion: detail?.androidVersionText || detail?.androidVersion,
        contentRating: detail?.contentRating,
        price: detail?.price ?? item.price,
        priceText: detail?.priceText,
        currency: detail?.currency,
        free: detail?.free,
        offersIAP: detail?.offersIAP,
        iapRange: detail?.IAPRange,
        adSupported: detail?.adSupported,
        observedChartCategory: detail?.genre ?? target.storeCategory ?? target.normalizedCategory
      };
    });

    return {
      attempts,
      flags: [...new Set(flags)].sort(),
      metadata: listItems.map((item) =>
        AppMetadataObservationSchema.parse({
          store: "google-play",
          appId: item.appId,
          name: item.title,
          developer: item.developer,
          developerId: item.developerId,
          developerWebsite: item.developerWebsite,
          iconUrl: item.icon,
          storeUrl: item.url,
          storeCategories: item.storeCategories,
          primaryGenreId: item.primaryGenreId,
          observedChartCategory: item.observedChartCategory,
          observedAt: metadataObservedAt,
          market: target.market,
          summary: item.summary,
          description: item.description,
          installRange: item.installRange,
          minInstalls: item.minInstalls,
          maxInstalls: item.maxInstalls,
          rating: item.rating,
          ratingsCount: item.ratingsCount,
          reviewsCount: item.reviewsCount,
          released: item.released,
          updatedAt: item.updatedAt,
          version: item.version,
          minimumOsVersion: item.minimumOsVersion,
          contentRating: item.contentRating,
          price: item.price,
          priceText: item.priceText,
          currency: item.currency,
          free: item.free,
          offersIAP: item.offersIAP,
          iapRange: item.iapRange,
          adSupported: item.adSupported
        })
      )
    };
  }

  #loadDetail(target: Target, appId: string): Promise<GooglePlayDetailResult> {
    const key = `${target.market}:${target.language}:${appId}`;
    const existing = this.#detailRequests.get(key);
    if (existing) return existing;

    const request = (async () => {
      let attempts = 1;
      const flags: string[] = [];
      try {
        const detail = await this.#client.app({
          appId,
          country: target.market.toLowerCase(),
          lang: target.language,
          onDegradation: (event) => flags.push(`metadata_degradation:${event.reason}`),
          onIntegrityEvent: (event) => flags.push(`metadata_integrity:${event.reason}`),
          requestOptions: {
            onRetry: (event) => {
              attempts = Math.max(attempts, event.attempt + 1);
            }
          }
        });
        return { detail, attempts, flags };
      } catch (error) {
        if (typeof error === "object" && error !== null) {
          Object.assign(error, { attempts, metadataFlags: flags });
        }
        throw error;
      }
    })();
    this.#detailRequests.set(key, request);
    return request;
  }
}

export function classifyGooglePlayError(error: unknown): string {
  if (error instanceof RateLimitError) return "rate_limit";
  if (error instanceof BlockedError) return "blocked";
  if (error instanceof ParseError) return "parse_error";
  if (error instanceof HttpError && error.status === 0) return "network_error";
  if (error instanceof HttpError) return `http_${error.status}`;
  return "google_play_error";
}
