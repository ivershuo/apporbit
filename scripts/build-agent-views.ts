import path from "node:path";

import type { AppMetadataObservation } from "../src/domain.js";
import { isPublished } from "../src/publication.js";
import { DataStore } from "../src/storage.js";
import { loadCatalog, loadRuns } from "./site-data.js";
import { compactRuns } from "./site-output.js";

export async function buildAgentViews(dataRoot: string): Promise<{ runs: number; markets: number }> {
  if (!await isPublished(dataRoot)) {
    throw new Error("Agent views require a published v1 data directory");
  }
  const [runs, catalog] = await Promise.all([loadRuns(dataRoot), loadCatalog(dataRoot)]);
  const store = new DataStore(dataRoot);
  const index = {
    schemaVersion: 1,
    generatedAt: runs.reduce((latest, run) => run.finishedAt > latest ? run.finishedAt : latest, "1970-01-01T00:00:00.000Z"),
    runs: compactRuns(runs)
  };

  const markets = new Map<string, Record<string, AppMetadataObservation>>();
  for (const item of Object.values(catalog)) {
    const key = `${item.store}/${item.market}`;
    const items = markets.get(key) ?? {};
    items[item.appId] = item;
    markets.set(key, items);
  }
  for (const [market, items] of markets) {
    await store.writeMutableJson(`views/agent-catalog-v1/${market}.json`, { catalog: items });
  }
  // Write the index last so a failed catalog build never advertises a fresh run view.
  await store.writeMutableJson("views/agent-index-v1.json", index);
  return { runs: runs.length, markets: markets.size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const dataRoot = path.resolve(process.env.APPORBIT_DATA_DIR ?? ".local-data/v1");
  buildAgentViews(dataRoot).then((result) => {
    console.log(`Built agent views from ${result.runs} published runs in ${result.markets} markets.`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
