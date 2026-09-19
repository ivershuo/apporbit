import { z } from "zod";

import { SCHEMA_VERSION } from "./version.js";

export const StoreSchema = z.enum(["apple", "google-play"]);
export const ScopeSchema = z.enum(["apps", "games"]);
export const ChartSchema = z.enum(["top-free", "top-paid", "top-grossing"]);
export const PublicationModeSchema = z.enum(["probe", "publish"]);
export const SnapshotStatusSchema = z.enum(["valid", "partial"]);
export const OutcomeStatusSchema = z.enum([
  "not_attempted",
  "valid",
  "partial",
  "failed",
  "quarantined",
  "unsupported"
]);

const UtcDateTimeSchema = z
  .string()
  .datetime({ offset: false });

export const TimeZoneSchema = z.string().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, "expected an IANA time zone");

export const TargetSchema = z.object({
  store: StoreSchema,
  market: z.string().regex(/^[A-Z]{2}$/),
  marketTimeZone: TimeZoneSchema.optional(),
  language: z.string().regex(/^[a-z]{2}$/),
  scope: ScopeSchema,
  chart: ChartSchema,
  normalizedCategory: z.string().min(1),
  storeCategory: z.string().min(1).nullable(),
  expectedCount: z.number().int().min(1).max(500),
  publicationMode: PublicationModeSchema
});

export const RankingEntrySchema = z.object({
  rank: z.number().int().positive(),
  appId: z.string().min(1).max(300)
});

export const SourceSchema = z.object({
  type: z.enum(["apple-rss", "google-play-scraper"]),
  method: z.string().min(1),
  url: z.string().url(),
  collectorVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/)
});

export const SnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  snapshotId: z.string().min(1),
  store: StoreSchema,
  market: z.string().regex(/^[A-Z]{2}$/),
  scope: ScopeSchema,
  chart: ChartSchema,
  normalizedCategory: z.string().min(1),
  storeCategory: z.string().min(1).nullable(),
  capturedAt: UtcDateTimeSchema,
  observationDate: z.string().date(),
  marketTimeZone: TimeZoneSchema.optional(),
  marketObservationDate: z.string().date().optional(),
  status: SnapshotStatusSchema,
  expectedCount: z.number().int().positive(),
  actualCount: z.number().int().nonnegative(),
  complete: z.boolean(),
  source: SourceSchema,
  validation: z.object({
    previousSnapshotId: z.string().min(1).nullable(),
    flags: z.array(z.string().min(1))
  }),
  entries: z.array(RankingEntrySchema)
});

export const AppMetadataObservationSchema = z.object({
  store: StoreSchema,
  appId: z.string().min(1).max(300),
  name: z.string().min(1),
  developer: z.string().min(1),
  developerId: z.string().min(1).optional(),
  developerWebsite: z.string().url().optional(),
  bundleId: z.string().min(1).optional(),
  iconUrl: z.string().url(),
  storeUrl: z.string().url(),
  storeCategories: z.array(z.string()),
  primaryGenreId: z.string().min(1).optional(),
  observedChartCategory: z.string().min(1),
  observedAt: UtcDateTimeSchema,
  market: z.string().regex(/^[A-Z]{2}$/),
  summary: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  installRange: z.string().min(1).optional(),
  minInstalls: z.number().int().nonnegative().optional(),
  maxInstalls: z.number().int().nonnegative().optional(),
  rating: z.number().min(0).max(5).optional(),
  ratingsCount: z.number().int().nonnegative().optional(),
  reviewsCount: z.number().int().nonnegative().optional(),
  released: z.string().min(1).optional(),
  updatedAt: UtcDateTimeSchema.optional(),
  version: z.string().min(1).optional(),
  minimumOsVersion: z.string().min(1).optional(),
  contentRating: z.string().min(1).optional(),
  fileSizeBytes: z.number().int().nonnegative().optional(),
  languages: z.array(z.string().min(1)).optional(),
  price: z.number().nonnegative().optional(),
  priceText: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  free: z.boolean().optional(),
  offersIAP: z.boolean().optional(),
  iapRange: z.string().min(1).optional(),
  adSupported: z.boolean().optional()
});

export const RunTargetOutcomeSchema = z.object({
  targetKey: z.string().min(1),
  target: TargetSchema,
  status: OutcomeStatusSchema,
  startedAt: UtcDateTimeSchema,
  finishedAt: UtcDateTimeSchema,
  attempts: z.number().int().positive(),
  snapshotPath: z.string().min(1).nullable(),
  error: z
    .object({
      kind: z.string().min(1),
      message: z.string().min(1)
    })
    .nullable(),
  flags: z.array(z.string())
});

export const RunManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  collectorVersion: z.string().min(1),
  startedAt: UtcDateTimeSchema,
  finishedAt: UtcDateTimeSchema,
  targets: z.array(RunTargetOutcomeSchema)
});

export const LatestManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  updatedAt: UtcDateTimeSchema,
  targets: z.record(
    z.string(),
    z.object({
      snapshotId: z.string(),
      snapshotPath: z.string(),
      capturedAt: UtcDateTimeSchema
    })
  )
});

export const CapabilitySchema = z.object({
  store: StoreSchema,
  scope: ScopeSchema,
  chart: ChartSchema,
  markets: z.array(z.string().regex(/^[A-Z]{2}$/)),
  status: z.enum(["probe", "supported", "unsupported"]),
  notes: z.string().min(1)
});

export const CapabilitiesManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  updatedAt: UtcDateTimeSchema,
  capabilities: z.array(CapabilitySchema)
});

export type Store = z.infer<typeof StoreSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type Chart = z.infer<typeof ChartSchema>;
export type PublicationMode = z.infer<typeof PublicationModeSchema>;
export type SnapshotStatus = z.infer<typeof SnapshotStatusSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type RankingEntry = z.infer<typeof RankingEntrySchema>;
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type AppMetadataObservation = z.infer<typeof AppMetadataObservationSchema>;
export type RunTargetOutcome = z.infer<typeof RunTargetOutcomeSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type LatestManifest = z.infer<typeof LatestManifestSchema>;

export function targetKey(target: Target): string {
  return [
    target.store,
    target.market,
    target.scope,
    target.chart,
    target.normalizedCategory
  ].join(":");
}
