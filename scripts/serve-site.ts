import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";

import { loadCapabilities, loadCatalog, loadRuns } from "./site-data.js";
import { buildCatalogStats, compactMetadata, compactRuns } from "./site-output.js";

const projectRoot = process.cwd();
const siteRoot = path.resolve(projectRoot, "site");
const dataRoot = path.resolve(
  projectRoot,
  process.env.APPORBIT_DATA_DIR ?? ".local-data/v1"
);
const port = Number(process.env.PORT ?? "4180");
const host = "127.0.0.1";
const MAX_FILE_SIZE = 5_000_000;
let catalogPromise: ReturnType<typeof loadCatalog> | undefined;

function siteCatalog() {
  catalogPromise ??= loadCatalog(dataRoot);
  return catalogPromise;
}

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
  "/market-order.js": { path: path.join(siteRoot, "market-order.js"), type: "text/javascript; charset=utf-8" },
  "/app-detail.js": { path: path.join(siteRoot, "app-detail.js"), type: "text/javascript; charset=utf-8" },
  "/trending.js": { path: path.join(siteRoot, "trending.js"), type: "text/javascript; charset=utf-8" },
  "/data-page.js": { path: path.join(siteRoot, "data-page.js"), type: "text/javascript; charset=utf-8" },
  "/static-page.js": { path: path.join(siteRoot, "static-page.js"), type: "text/javascript; charset=utf-8" },
  "/tokens.css": { path: path.join(projectRoot, "tokens.css"), type: "text/css; charset=utf-8" }
};

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
    if (url.pathname === "/api/bootstrap.json") {
      const [runs, capabilities] = await Promise.all([
        loadRuns(dataRoot),
        loadCapabilities(projectRoot)
      ]);
      sendJson(response, 200, {
        dataRootLabel: process.env.APPORBIT_DATA_DIR ? "APPORBIT_DATA_DIR" : ".local-data/v1",
        runs: compactRuns(runs),
        capabilities
      });
      return;
    }
    if (url.pathname === "/api/stats.json") {
      sendJson(response, 200, { catalog: buildCatalogStats(await siteCatalog()) });
      return;
    }
    const catalogMatch = url.pathname.match(/^\/api\/catalog\/([^/]+)\/([^/]+)\.json$/);
    if (catalogMatch) {
      const store = decodeURIComponent(catalogMatch[1]!);
      const market = decodeURIComponent(catalogMatch[2]!);
      const catalog = Object.fromEntries(
        Object.values(await siteCatalog())
          .filter((item) => item.store === store && item.market === market)
          .map((item) => [item.appId, compactMetadata(item)])
      );
      sendJson(response, 200, { catalog });
      return;
    }
    const appMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/([^/]+)\/([^/]+)\.json$/);
    if (appMatch) {
      const store = decodeURIComponent(appMatch[1]!);
      const market = decodeURIComponent(appMatch[2]!);
      const appId = decodeURIComponent(appMatch[3]!);
      const metadata = (await siteCatalog())[`${store}:${market}:${appId}`];
      sendJson(response, metadata ? 200 : 404, metadata ? { metadata } : { error: "not_found" });
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
