import path from "node:path";

import { isPublished } from "../src/publication.js";
import { DataStore } from "../src/storage.js";
import { loadRuns } from "./site-data.js";
import { compactRuns } from "./site-output.js";

export async function buildAgentIndex(dataRoot: string): Promise<{ runs: number }> {
  if (!await isPublished(dataRoot)) {
    throw new Error("The run index requires a published v1 data directory");
  }
  const runs = await loadRuns(dataRoot);
  const store = new DataStore(dataRoot);
  const index = {
    schemaVersion: 1,
    generatedAt: runs.reduce((latest, run) => run.finishedAt > latest ? run.finishedAt : latest, "1970-01-01T00:00:00.000Z"),
    runs: compactRuns(runs)
  };
  await store.writeMutableJson("views/agent-index-v1.json", index);
  return { runs: runs.length };
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const dataRoot = path.resolve(process.env.APPORBIT_DATA_DIR ?? ".local-data/v1");
  buildAgentIndex(dataRoot).then((result) => {
    console.log(`Built run index from ${result.runs} published runs.`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
