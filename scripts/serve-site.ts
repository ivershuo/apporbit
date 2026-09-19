import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";

import {
  AppMetadataObservationSchema,
  CapabilitiesManifestSchema,
  RunManifestSchema,
  type AppMetadataObservation,
  type RunManifest
} from "../src/domain.js";

const projectRoot = process.cwd();
const siteRoot = path.resolve(projectRoot, "site");
const dataRoot = path.resolve(
  projectRoot,
  process.env.APPORBIT_DATA_DIR ?? ".local-data/v1"
);
const port = Number(process.env.PORT ?? "4180");
const host = "127.0.0.1";
const MAX_FILE_SIZE = 5_000_000;

const staticFiles: Record<string, { path: string; type: string }> = {
  "/": { path: path.join(siteRoot, "index.html"), type: "text/html; charset=utf-8" },
  "/index.html": { path: path.join(siteRoot, "index.html"), type: "text/html; charset=utf-8" },
  "/app.html": { path: path.join(siteRoot, "app.html"), type: "text/html; charset=utf-8" },
  "/trending.html": { path: path.join(siteRoot, "trending.html"), type: "text/html; charset=utf-8" },
  "/data.html": { path: path.join(siteRoot, "data.html"), type: "text/html; charset=utf-8" },
  "/about.html": { path: path.join(siteRoot, "about.html"), type: "text/html; charset=utf-8" },
  "/styles.css": { path: path.join(siteRoot, "styles.css"), type: "text/css; charset=utf-8" },
  "/theme.css": { path: path.join(siteRoot, "theme.css"), type: "text/css; charset=utf-8" },
  "/orbit-mark.svg": { path: path.join(siteRoot, "orbit-mark.svg"), type: "image/svg+xml" },
  "/hero-globe.svg": { path: path.join(siteRoot, "hero-globe.svg"), type: "image/svg+xml" },
  "/app-store.png": { path: path.join(siteRoot, "app-store.png"), type: "image/png" },
  "/google-play.svg": { path: path.join(siteRoot, "google-play.svg"), type: "image/svg+xml" },
  "/app.js": { path: path.join(siteRoot, "app.js"), type: "text/javascript; charset=utf-8" },
  "/shared.js": { path: path.join(siteRoot, "shared.js"), type: "text/javascript; charset=utf-8" },
  "/app-detail.js": { path: path.join(siteRoot, "app-detail.js"), type: "text/javascript; charset=utf-8" },
  "/trending.js": { path: path.join(siteRoot, "trending.js"), type: "text/javascript; charset=utf-8" },
  "/data-page.js": { path: path.join(siteRoot, "data-page.js"), type: "text/javascript; charset=utf-8" },
  "/static-page.js": { path: path.join(siteRoot, "static-page.js"), type: "text/javascript; charset=utf-8" },
  "/tokens.css": { path: path.join(projectRoot, "tokens.css"), type: "text/css; charset=utf-8" }
};

interface RunWithPath extends RunManifest {
  manifestPath: string;
}

function responseHeaders(type: string): Record<string, string> {
  return {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  };
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, responseHeaders("application/json; charset=utf-8"));
  response.end(`${JSON.stringify(value)}\n`);
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

async function loadRuns(): Promise<RunWithPath[]> {
  const roots = [path.join(dataRoot, "probes/runs"), path.join(dataRoot, "runs")];
  const files = (await Promise.all(roots.map((root) => walkFiles(root, ".json")))).flat();
  const runs: RunWithPath[] = [];
  for (const file of files) {
    try {
      const manifest = RunManifestSchema.parse(JSON.parse(await readFile(file, "utf8")));
      runs.push({ ...manifest, manifestPath: path.relative(dataRoot, file).split(path.sep).join("/") });
    } catch (error) {
      console.warn(`Skipping invalid run manifest ${file}:`, error);
    }
  }
  return runs
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

async function loadCatalog(): Promise<Record<string, AppMetadataObservation>> {
  const roots = [
    path.join(dataRoot, "probes/metadata/events"),
    path.join(dataRoot, "metadata/events")
  ];
  const files = (await Promise.all(roots.map((root) => walkFiles(root, ".ndjson")))).flat().sort();
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

async function loadCapabilities(): Promise<unknown> {
  const file = path.join(projectRoot, "config/capabilities.json");
  return CapabilitiesManifestSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

function safeDataPath(pathname: string): string | null {
  try {
    const relative = decodeURIComponent(pathname.slice("/data/".length));
    if (!relative || path.isAbsolute(relative) || relative.includes("\\")) return null;
    const resolved = path.resolve(dataRoot, relative);
    if (!resolved.startsWith(`${dataRoot}${path.sep}`)) return null;
    if (!resolved.endsWith(".json") && !resolved.endsWith(".ndjson")) return null;
    return resolved;
  } catch {
    return null;
  }
}

async function sendFile(response: ServerResponse, filePath: string, type: string): Promise<void> {
  try {
    const details = await stat(filePath);
    if (!details.isFile() || details.size > MAX_FILE_SIZE) {
      sendJson(response, 404, { error: "file_not_available" });
      return;
    }
    response.writeHead(200, {
      ...responseHeaders(type),
      "content-length": String(details.size)
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (url.pathname === "/api/runs") {
      const runs = await loadRuns();
      sendJson(response, 200, {
        dataRootLabel: process.env.APPORBIT_DATA_DIR ? "APPORBIT_DATA_DIR" : ".local-data/v1",
        runs
      });
      return;
    }
    if (url.pathname === "/api/catalog") {
      sendJson(response, 200, { catalog: await loadCatalog() });
      return;
    }
    if (url.pathname === "/api/capabilities") {
      sendJson(response, 200, { capabilities: await loadCapabilities() });
      return;
    }
    if (url.pathname.startsWith("/data/")) {
      const filePath = safeDataPath(url.pathname);
      if (!filePath) {
        sendJson(response, 400, { error: "invalid_data_path" });
        return;
      }
      await sendFile(
        response,
        filePath,
        filePath.endsWith(".ndjson") ? "application/x-ndjson; charset=utf-8" : "application/json; charset=utf-8"
      );
      return;
    }
    const staticFile = staticFiles[url.pathname];
    if (!staticFile) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }
    await sendFile(response, staticFile.path, staticFile.type);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "internal_server_error" });
  }
});

server.listen(port, host, () => {
  console.log(`AppOrbit local viewer: http://${host}:${port}`);
  console.log(`Data directory: ${dataRoot}`);
});
