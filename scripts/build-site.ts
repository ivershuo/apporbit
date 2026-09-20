import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { SnapshotSchema } from "../src/domain.js";
import { loadCapabilities, loadCatalog, loadRuns } from "./site-data.js";
import { buildCatalogStats, compactMetadata, compactRuns } from "./site-output.js";

const projectRoot = process.cwd();
const siteRoot = path.join(projectRoot, "site");
const dataRoot = path.resolve(
  projectRoot,
  process.env.APPORBIT_DATA_DIR ?? ".local-data/v1"
);
const outputRoot = path.resolve(
  projectRoot,
  process.env.APPORBIT_SITE_OUTPUT ?? "dist/pages"
);

function dataFilePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\\")) {
    throw new Error(`Invalid data path: ${relativePath}`);
  }
  const resolved = path.resolve(dataRoot, relativePath);
  if (!resolved.startsWith(`${dataRoot}${path.sep}`) || !resolved.endsWith(".json")) {
    throw new Error(`Invalid snapshot path: ${relativePath}`);
  }
  return resolved;
}

async function writeJson(relativePath: string, value: unknown): Promise<void> {
  const destination = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value)}\n`);
}

function encodedSegment(value: string): string {
  return encodeURIComponent(value);
}

async function writeCatalogFiles(
  catalog: Awaited<ReturnType<typeof loadCatalog>>
): Promise<void> {
  const marketCatalogs = new Map<string, Record<string, ReturnType<typeof compactMetadata>>>();
  const detailWrites: Array<() => Promise<void>> = [];

  for (const item of Object.values(catalog)) {
    const marketPath = `${encodedSegment(item.store)}/${encodedSegment(item.market)}`;
    const marketCatalog = marketCatalogs.get(marketPath) ?? {};
    marketCatalog[item.appId] = compactMetadata(item);
    marketCatalogs.set(marketPath, marketCatalog);
    detailWrites.push(() => writeJson(
      `api/apps/${marketPath}/${encodedSegment(item.appId)}.json`,
      { metadata: item }
    ));
  }

  for (let index = 0; index < detailWrites.length; index += 100) {
    await Promise.all(detailWrites.slice(index, index + 100).map((write) => write()));
  }
  await Promise.all([...marketCatalogs.entries()].map(([marketPath, marketCatalog]) =>
    writeJson(`api/catalog/${marketPath}.json`, { catalog: marketCatalog })
  ));
}

async function makeSitePathsPortable(): Promise<void> {
  const entries = await readdir(outputRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const file = path.join(outputRoot, entry.name);
    const html = await readFile(file, "utf8");
    await writeFile(file, html.replace(/\b(href|src)="\/(?!\/)/g, '$1="./'));
  }
}

async function copySnapshots(snapshotPaths: string[]): Promise<void> {
  for (const relativePath of snapshotPaths) {
    const source = dataFilePath(relativePath);
    SnapshotSchema.parse(JSON.parse(await readFile(source, "utf8")));
    const destination = path.join(outputRoot, "data", relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

async function build(): Promise<void> {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await cp(siteRoot, outputRoot, { recursive: true });
  await copyFile(path.join(projectRoot, "tokens.css"), path.join(outputRoot, "tokens.css"));
  await makeSitePathsPortable();

  const [runs, catalog, capabilities] = await Promise.all([
    loadRuns(dataRoot),
    loadCatalog(dataRoot),
    loadCapabilities(projectRoot)
  ]);
  const snapshotPaths = [
    ...new Set(
      runs.flatMap((run) =>
        run.targets.flatMap((outcome) => outcome.snapshotPath ? [outcome.snapshotPath] : [])
      )
    )
  ].sort();

  await Promise.all([
    writeJson("api/bootstrap.json", {
      dataRootLabel: "data branch / v1",
      runs: compactRuns(runs),
      capabilities
    }),
    writeJson("api/stats.json", { catalog: buildCatalogStats(catalog) }),
    writeCatalogFiles(catalog),
    writeFile(path.join(outputRoot, ".nojekyll"), "")
  ]);
  await copySnapshots(snapshotPaths);

  console.log(
    `Built ${outputRoot} with ${runs.length} runs, ${snapshotPaths.length} snapshots, and ${Object.keys(catalog).length} catalog entries.`
  );
}

await build();
