import { z } from "zod";

import { DataStore } from "./storage.js";
import type { Target } from "./domain.js";

export const PUBLICATION_MARKER = "migrations/probe-to-publish-v1.json";
export const PublicationMarkerSchema = z.object({
  migration: z.literal("probe-to-publish-v1"),
  publicationMode: z.literal("publish"),
  sourceCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(z.object({
    source: z.string(),
    destination: z.string(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    destinationSha256: z.string().regex(/^[a-f0-9]{64}$/)
  }))
});

export async function isPublished(dataRoot: string): Promise<boolean> {
  const marker = await new DataStore(dataRoot).readJson<unknown>(PUBLICATION_MARKER);
  if (marker === null) return false;
  PublicationMarkerSchema.parse(marker);
  return true;
}

export async function publicationTargets(dataRoot: string, targets: Target[]): Promise<Target[]> {
  return await isPublished(dataRoot)
    ? targets.map((target) => ({ ...target, publicationMode: "publish" }))
    : targets;
}
