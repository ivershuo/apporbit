const snapshotCache = new Map();
let ratingSequence = 0;
const siteBaseUrl = new URL("./", import.meta.url);

function siteUrl(relativePath) {
  return new URL(relativePath, siteBaseUrl).toString();
}

export function ratingStars(rating) {
  const value = Math.round(Math.min(5, Math.max(0, rating)) * 10) / 10;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("rating-stars");
  svg.setAttribute("viewBox", "0 0 100 20");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${value.toFixed(1)} out of 5 stars`);
  const id = `rating-fill-${++ratingSequence}`;
  const clip = document.createElementNS(ns, "clipPath");
  clip.id = id;
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("width", String(value * 20));
  rect.setAttribute("height", "20");
  clip.append(rect);
  const defs = document.createElementNS(ns, "defs");
  defs.append(clip);
  svg.append(defs);
  for (const filled of [false, true]) {
    const group = document.createElementNS(ns, "g");
    group.setAttribute("class", filled ? "rating-stars__fill" : "rating-stars__empty");
    if (filled) group.setAttribute("clip-path", `url(#${id})`);
    for (let i = 0; i < 5; i++) {
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", "M10 1.5 12.6 6.8 18.5 7.7 14.2 11.9 15.2 17.8 10 15 4.8 17.8 5.8 11.9 1.5 7.7 7.4 6.8Z");
      path.setAttribute("transform", `translate(${i * 20} 0)`);
      group.append(path);
    }
    svg.append(group);
  }
  return svg;
}

export const ui = {
  timezone: localStorage.getItem("apporbit-timezone") === "local" ? "local" : "utc"
};

export function text(node, value) {
  if (node) node.textContent = value;
}

export function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

export async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

export async function loadDataset() {
  const [runsPayload, catalogPayload, capabilitiesPayload] = await Promise.all([
    fetchJson(siteUrl("api/runs.json")),
    fetchJson(siteUrl("api/catalog.json")),
    fetchJson(siteUrl("api/capabilities.json"))
  ]);
  return {
    runs: runsPayload.runs,
    catalog: catalogPayload.catalog,
    capabilities: capabilitiesPayload.capabilities,
    dataRootLabel: runsPayload.dataRootLabel
  };
}

export function formatTime(value, mode = ui.timezone) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  if (mode === "local") {
    return new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(date);
  }
  return `${date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z")} · UTC`;
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export function formatStoreDate(value, mode = ui.timezone) {
  if (!value) return "—";
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = Date.parse(hasExplicitZone ? value : `${value} UTC`);
  if (Number.isNaN(parsed)) return value;
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: mode === "utc" || !hasExplicitZone ? "UTC" : undefined
  }).format(new Date(parsed));
}

export function bindChrome(onTimezoneChange) {
  const toggle = document.querySelector("#timezone-toggle");
  const update = () => {
    if (!toggle) return;
    const local = ui.timezone === "local";
    toggle.setAttribute("aria-pressed", String(local));
    toggle.textContent = local ? "Times: Local" : "Times: UTC";
    toggle.title = local ? "Show times in UTC" : "Show times in your local time zone";
  };
  update();
  toggle?.addEventListener("click", () => {
    ui.timezone = ui.timezone === "utc" ? "local" : "utc";
    localStorage.setItem("apporbit-timezone", ui.timezone);
    update();
    onTimezoneChange?.();
  });

  const menuButton = document.querySelector("#menu-toggle");
  const nav = document.querySelector("#primary-nav");
  menuButton?.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!open));
    nav?.toggleAttribute("data-open", !open);
  });
}

export function targetKey(target) {
  return [target.store, target.market, target.scope, target.chart, target.normalizedCategory].join(":");
}

export function buildHistories(runs) {
  const histories = new Map();
  const seen = new Set();
  for (const run of runs) {
    for (const outcome of run.targets) {
      if (!outcome.snapshotPath || seen.has(outcome.snapshotPath)) continue;
      seen.add(outcome.snapshotPath);
      const key = outcome.targetKey || targetKey(outcome.target);
      if (!histories.has(key)) histories.set(key, []);
      histories.get(key).push({ ...outcome, runId: run.runId });
    }
  }
  for (const history of histories.values()) {
    history.sort((left, right) => right.finishedAt.localeCompare(left.finishedAt));
  }
  return histories;
}

export function observationDateFromPath(snapshotPath) {
  const match = snapshotPath?.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function targetOptions(histories) {
  return [...histories.entries()].map(([key, history]) => ({
    key,
    target: history[0].target,
    history
  }));
}

export function outcomeForDate(history, date = "latest", allowPartial = true) {
  const eligible = history.filter((outcome) =>
    Boolean(outcome.snapshotPath) &&
    (outcome.status === "valid" || (allowPartial && outcome.status === "partial")) &&
    (date === "latest" || observationDateFromPath(outcome.snapshotPath) === date)
  );
  return eligible.find((outcome) => outcome.status === "valid") ?? eligible[0] ?? null;
}

export function previousValidOutcome(history, current) {
  if (!current) return null;
  return history.find((outcome) =>
    outcome.status === "valid" &&
    Boolean(outcome.snapshotPath) &&
    outcome.snapshotPath !== current.snapshotPath &&
    outcome.finishedAt < current.finishedAt
  ) ?? null;
}

export function snapshotDataUrl(relativePath) {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return siteUrl(`data/${encodedPath}`);
}

export async function loadSnapshot(snapshotPath) {
  if (!snapshotPath) throw new Error("Snapshot path is missing");
  if (!snapshotCache.has(snapshotPath)) {
    snapshotCache.set(snapshotPath, fetchJson(snapshotDataUrl(snapshotPath)));
  }
  return snapshotCache.get(snapshotPath);
}

export function metadataFor(catalog, target, appId) {
  return catalog[`${target.store}:${target.market}:${appId}`] ?? null;
}

export function storeLabel(store) {
  return store === "google-play" ? "Google Play" : "App Store";
}

const marketNames = new Intl.DisplayNames(["en"], { type: "region" });

export function marketFlag(market) {
  const code = String(market ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "◉";
  return String.fromCodePoint(...[...code].map((letter) => 127397 + letter.codePointAt(0)));
}

export function marketLabel(market, { compact = false } = {}) {
  const code = String(market ?? "").toUpperCase();
  const name = code === "CN" ? "China Mainland" : marketNames.of(code) ?? code;
  return compact ? `${marketFlag(code)} ${code}` : `${marketFlag(code)}  ${name}`;
}

export function chartLabel(chart) {
  return ({
    "top-free": "Top Free",
    "top-paid": "Top Paid",
    "top-grossing": "Top Grossing"
  })[chart] ?? chart;
}

export function scopeLabel(scope) {
  return scope === "games" ? "Games" : "Apps";
}

export function compareSnapshots(current, previous) {
  const previousRanks = new Map(previous?.entries.map((entry) => [entry.appId, entry.rank]) ?? []);
  return current.entries.map((entry) => {
    const previousRank = previousRanks.get(entry.appId);
    return {
      ...entry,
      previousRank: previousRank ?? null,
      change: previousRank === undefined ? null : previousRank - entry.rank,
      isNew: previousRank === undefined
    };
  });
}

export function changePresentation(item, hasBaseline = true) {
  if (!hasBaseline) return { label: "—", tone: "neutral", title: "No previous complete chart is available" };
  if (item.isNew) return { label: "NEW", tone: "new", title: "Not present on the previous chart" };
  if (item.change > 0) return { label: `↑ ${item.change}`, tone: "up", title: `Moved from #${item.previousRank} to #${item.rank}` };
  if (item.change < 0) return { label: `↓ ${Math.abs(item.change)}`, tone: "down", title: `Moved from #${item.previousRank} to #${item.rank}` };
  return { label: "—", tone: "neutral", title: "Rank unchanged" };
}

export function appDetailUrl(target, appId) {
  const query = new URLSearchParams({
    store: target.store,
    market: target.market,
    scope: target.scope,
    chart: target.chart,
    category: target.normalizedCategory,
    id: appId
  });
  return siteUrl(`app.html?${query}`);
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function replaceOptions(select, values, selected, labeler = (value) => value, { preserveSelection = false } = {}) {
  const available = preserveSelection && selected && !values.includes(selected) ? [selected, ...values] : values;
  select.replaceChildren(...available.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labeler(value);
    return option;
  }));
  select.value = available.includes(selected) ? selected : available[0] ?? "";
  select.disabled = available.length <= 1;
  return select.value;
}

export function setPanelState(container, title, message, tone = "idle") {
  container.replaceChildren();
  container.dataset.state = tone;
  const heading = element("strong", "empty-state__title", title);
  const copy = element("p", "empty-state__copy", message);
  container.append(heading, copy);
}

export function snapshotDetails(snapshot, previous) {
  const marketDate = snapshot.marketObservationDate ?? snapshot.observationDate;
  return [
    `format-version v${snapshot.schemaVersion}`,
    `chart-id ${snapshot.snapshotId}`,
    `chart-date ${marketDate} ${snapshot.marketTimeZone ?? "UTC"}`,
    `captured-at ${snapshot.capturedAt}`,
    `availability ${snapshot.status === "valid" ? "complete" : snapshot.status}`,
    `source ${snapshot.source.type} / ${snapshot.source.method}`,
    `collector-version ${snapshot.source.collectorVersion}`,
    `source-version ${snapshot.source.adapterVersion}`,
    `entries ${snapshot.actualCount} of ${snapshot.expectedCount} expected`,
    `coverage ${snapshot.complete ? "complete" : "partial"}`,
    previous ? `comparison-chart ${previous.snapshotId}` : "comparison-chart unavailable",
    snapshot.validation.flags.length ? `notes ${snapshot.validation.flags.join(", ")}` : "notes none",
    `content-hash ${snapshot.source.payloadSha256}`
  ];
}

export function dailyRankPoints(snapshots, appId) {
  const byDate = new Map();
  for (const snapshot of snapshots) {
    const date = snapshot.marketObservationDate ?? snapshot.observationDate;
    if (byDate.get(date)?.capturedAt > snapshot.capturedAt) continue;
    const entry = snapshot.entries.find((item) => item.appId === appId);
    byDate.set(date, {
      date,
      capturedAt: snapshot.capturedAt,
      rank: snapshot.status === "valid" ? entry?.rank ?? null : null,
      snapshotValid: snapshot.status === "valid"
    });
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function renderRankChart(container, points, { compact = false } = {}) {
  container.replaceChildren();
  points = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const ranked = points.filter((point) => Number.isFinite(point.rank) && point.snapshotValid !== false);
  if (ranked.length === 0) {
    setPanelState(container, "No ranking observations", "No ranked observations are available for this period.", "idle");
    return;
  }

  const width = compact ? 520 : 920;
  const height = compact ? 180 : 300;
  const padding = compact ? 24 : 42;
  const maxRank = Math.max(100, ...ranked.map((point) => point.rank));
  const dateTime = (point) => Date.parse(point.date + "T00:00:00Z");
  const start = dateTime(points[0]);
  const span = dateTime(points.at(-1)) - start;
  const x = (point) => padding + (span ? (dateTime(point) - start) / span : 0.5) * (width - padding * 2);
  const y = (rank) => padding + ((rank - 1) / Math.max(1, maxRank - 1)) * (height - padding * 2);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Ranking trend; smaller rank values are higher positions");
  svg.classList.add("rank-chart__svg");

  const grid = document.createElementNS(svg.namespaceURI, "g");
  grid.classList.add("rank-chart__grid");
  const label = (value, x, y, anchor) => {
    const node = document.createElementNS(svg.namespaceURI, "text");
    node.textContent = value;
    node.setAttribute("x", String(x));
    node.setAttribute("y", String(y));
    node.setAttribute("text-anchor", anchor);
    node.classList.add("rank-chart__label");
    grid.append(node);
  };
  for (const rank of [...new Set([1, ...[1, 2, 3, 4].map((step) => Math.round(maxRank * step / 4))])]) {
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", String(padding));
    line.setAttribute("x2", String(width - padding));
    line.setAttribute("y1", String(y(rank)));
    line.setAttribute("y2", String(y(rank)));
    grid.append(line);
    label(String(rank), padding - 8, y(rank) + 4, "end");
  }
  const tickCount = Math.min(compact ? 3 : 5, points.length);
  for (let i = 0; i < tickCount; i++) {
    const point = points[Math.round(i * (points.length - 1) / Math.max(1, tickCount - 1))];
    label(new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(dateTime(point)), x(point), height - 6, i === 0 ? "start" : i === tickCount - 1 ? "end" : "middle");
  }
  const segments = [];
  let segment = [];
  for (const point of points) {
    if (!ranked.includes(point)) { segment = []; continue; }
    if (segment.length && dateTime(point) - dateTime(segment.at(-1)) > 86400000) segment = [];
    if (!segment.length) segments.push(segment);
    segment.push(point);
  }
  const linePath = (segment) => segment.map((point, index) => `${index ? "L" : "M"}${x(point)} ${y(point.rank)}`).join(" ");

  const path = document.createElementNS(svg.namespaceURI, "path");
  path.classList.add("rank-chart__line");
  path.setAttribute("d", segments.map(linePath).join(" "));
  const area = document.createElementNS(svg.namespaceURI, "path");
  area.classList.add("rank-chart__area");
  area.setAttribute("d", segments.filter((segment) => segment.length > 1).map((segment) => `${linePath(segment)} L${x(segment.at(-1))} ${height - padding} L${x(segment[0])} ${height - padding} Z`).join(" "));
  svg.append(grid, area, path);

  for (const [index, point] of ranked.entries()) {
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    circle.classList.add("rank-chart__point");
    circle.setAttribute("cx", String(x(point)));
    circle.setAttribute("cy", String(y(point.rank)));
    circle.setAttribute("r", compact ? "3" : "4");
    const title = document.createElementNS(svg.namespaceURI, "title");
    title.textContent = `${point.date}: #${point.rank}`;
    circle.append(title);
    svg.append(circle);
  }
  container.append(svg);
}

export function utcDateMinus(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function outcomeAtOrBefore(history, date) {
  return history.find((outcome) =>
    outcome.status === "valid" &&
    observationDateFromPath(outcome.snapshotPath) <= date
  ) ?? null;
}
