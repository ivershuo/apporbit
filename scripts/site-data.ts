import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  AppMetadataObservationSchema,
  CapabilitiesManifestSchema,
  RunManifestSchema,
  type AppMetadataObservation,
  type RunManifest
} from "../src/domain.js";

export interface RunWithPath extends RunManifest {
  manifestPath: string;
}

async function walkFiles(directory: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const results = await Promise.all(
      entries.map(async (entry) => {
        const itemPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return walkFiles(itemPath, suffix);
        return entry.isFile() && entry.name.endsWith(suffix) ? [itemPath] : [];
      })
    );
    return results.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function loadRuns(dataRoot: string): Promise<RunWithPath[]> {
  const roots = [path.join(dataRoot, "probes/runs"), path.join(dataRoot, "runs")];
  const files = (await Promise.all(roots.map((root) => walkFiles(root, ".json")))).flat();
  const runs: RunWithPath[] = [];
  for (const file of files) {
    try {
      const manifest = RunManifestSchema.parse(JSON.parse(await readFile(file, "utf8")));
      runs.push({
        ...manifest,
        manifestPath: path.relative(dataRoot, file).split(path.sep).join("/")
      });
    } catch (error) {
      console.warn(`Skipping invalid run manifest ${file}:`, error);
    }
  }
  return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function loadCatalog(
  dataRoot: string
): Promise<Record<string, AppMetadataObservation>> {
  const roots = [
    path.join(dataRoot, "probes/metadata/events"),
    path.join(dataRoot, "metadata/events")
  ];
  const files = (await Promise.all(roots.map((root) => walkFiles(root, ".ndjson"))))
    .flat()
    .sort();
  const catalog: Record<string, AppMetadataObservation> = {};
  for (const file of files) {
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
    for (const line of lines) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      const result = AppMetadataObservationSchema.safeParse(value);
      if (!result.success) continue;
      const item = result.data;
      const key = `${item.store}:${item.market}:${item.appId}`;
      if (!catalog[key] || catalog[key].observedAt <= item.observedAt) catalog[key] = item;
    }
  }
  return catalog;
}

export async function loadCapabilities(projectRoot: string): Promise<unknown> {
  const file = path.join(projectRoot, "config/capabilities.json");
  return CapabilitiesManifestSchema.parse(JSON.parse(await readFile(file, "utf8")));
}
