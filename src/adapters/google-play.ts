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
import type { AdapterObservation, StoreAdapter } from "./types.js";

const GOOGLE_ADAPTER_VERSION = "@mradex77/google-play-scraper@1.2.0";
type GooglePlayClient = Pick<ReturnType<typeof createClient>, "list" | "app">;

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

export class GooglePlayAdapter implements StoreAdapter {
  readonly #client: GooglePlayClient;

  constructor(client?: GooglePlayClient) {
    this.#client = client ?? createClient({
      throttle: 1,
      requestOptions: {
        timeoutMs: 30_000,
        retries: 2,
        headers: {
          "user-agent": collectorUserAgent()
        }
      }
    });
  }

  async collect(target: Target): Promise<AdapterObservation> {
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

    // This timestamp belongs to the ranking response. Metadata enrichment below
    // is deliberately excluded so it cannot shift the chart's observation time.
    const capturedAt = new Date().toISOString();
    const rankedItems = items as GooglePlayAppItem[];
    const detailResults = await Promise.allSettled(rankedItems.map((item) =>
      this.#client.app({
        appId: item.appId,
        country: target.market.toLowerCase(),
        lang: target.language,
        onDegradation: (event) => flags.push(`metadata_degradation:${event.reason}`),
        onIntegrityEvent: (event) => flags.push(`metadata_integrity:${event.reason}`),
        requestOptions: {
          onRetry: (event) => {
            attempts = Math.max(attempts, event.attempt + 1);
          }
        }
      })
    ));
    const detailsById = new Map<string, GooglePlayApp>();
    let failedDetails = 0;
    for (const result of detailResults) {
      if (result.status === "fulfilled") detailsById.set(result.value.appId, result.value);
      else failedDetails += 1;
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
      target,
      capturedAt,
      attempts,
      flags,
      entries: listItems.map((item, index) => ({ rank: index + 1, appId: item.appId })),
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
      ),
      source: {
        type: "google-play-scraper",
        method: "list+app-details",
        url: sourceUrl(target),
        collectorVersion: COLLECTOR_VERSION,
        adapterVersion: GOOGLE_ADAPTER_VERSION,
        payloadSha256: sha256({ ranking: rankedItems, details: listItems })
      }
    };
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
