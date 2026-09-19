import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  ChartSchema,
  PublicationModeSchema,
  ScopeSchema,
  StoreSchema,
  TargetSchema,
  TimeZoneSchema,
  type Target
} from "./domain.js";

const TargetGroupSchema = z.object({
  store: StoreSchema,
  markets: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1),
  language: z.string().regex(/^[a-z]{2}$/).default("en"),
  scopes: z.array(ScopeSchema).min(1),
  charts: z.array(ChartSchema).min(1),
  expectedCount: z.number().int().min(1).max(500).default(100),
  publicationMode: PublicationModeSchema.default("probe")
});

const TargetsConfigSchema = z.object({
  schemaVersion: z.literal(1),
  marketTimeZones: z.record(z.string().regex(/^[A-Z]{2}$/), TimeZoneSchema),
  groups: z.array(TargetGroupSchema).min(1)
});

function storeCategory(store: Target["store"], scope: Target["scope"]): string | null {
  if (store === "google-play") {
    return scope === "apps" ? "APPLICATION" : "GAME";
  }
  return scope === "apps" ? null : "6014";
}

export async function loadTargets(configPath: string): Promise<Target[]> {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  const config = TargetsConfigSchema.parse(raw);
  const targets: Target[] = [];

  for (const group of config.groups) {
    for (const market of group.markets) {
      const marketTimeZone = config.marketTimeZones[market];
      if (!marketTimeZone) throw new Error(`missing market time zone for ${market}`);
      for (const scope of group.scopes) {
        for (const chart of group.charts) {
          targets.push(
            TargetSchema.parse({
              store: group.store,
              market,
              marketTimeZone,
              language: group.language,
              scope,
              chart,
              normalizedCategory: scope === "apps" ? "all-apps" : "all-games",
              storeCategory: storeCategory(group.store, scope),
              expectedCount: group.expectedCount,
              publicationMode: group.publicationMode
            })
          );
        }
      }
    }
  }

  return targets;
}
