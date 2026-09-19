import {
  appDetailUrl,
  bindChrome,
  buildHistories,
  chartLabel,
  element,
  formatDate,
  loadDataset,
  loadSnapshot,
  marketLabel,
  metadataFor,
  outcomeAtOrBefore,
  outcomeForDate,
  replaceOptions,
  scopeLabel,
  setPanelState,
  storeLabel,
  targetOptions,
  text,
  unique,
  utcDateMinus
} from "./shared.js";
import { marketsByScale } from "./market-order.js";

const query = new URLSearchParams(location.search);
const state = {
  dataset: null,
  histories: new Map(),
  options: [],
  filters: {
    store: query.get("store") ?? "apple",
    market: query.get("market") ?? "US",
    scope: query.get("scope") ?? "apps",
    chart: query.get("chart") ?? "top-free",
    window: query.get("window") ?? "7"
  }
};

const nodes = {
  store: document.querySelector("#trending-store"), market: document.querySelector("#trending-market"), scope: document.querySelector("#trending-scope"),
  chart: document.querySelector("#trending-chart"), window: document.querySelector("#trending-window"), status: document.querySelector("#trending-status"),
  moved: document.querySelector("#moved-count"), entrants: document.querySelector("#entrant-count"), markets: document.querySelector("#tracked-markets"),
  stores: document.querySelector("#tracked-stores"), empty: document.querySelector("#trending-empty"), grid: document.querySelector("#mover-grid"),
  risers: document.querySelector("#riser-list"), fallers: document.querySelector("#faller-list"), newEntries: document.querySelector("#new-list"), topTen: document.querySelector("#top-ten-list")
};

function selectedTarget() {
  return state.options.find(({ target }) => target.store === state.filters.store && target.market === state.filters.market && target.scope === state.filters.scope && target.chart === state.filters.chart) ?? null;
}

function syncFilters() {
  const capabilities = state.dataset.capabilities.capabilities.filter((item) => item.status !== "unsupported");
  state.filters.store = replaceOptions(nodes.store, unique([...state.options.map(({ target }) => target.store), ...capabilities.map((item) => item.store)]), state.filters.store, storeLabel);
  const scopes = unique([...state.options.filter(({ target }) => target.store === state.filters.store).map(({ target }) => target.scope), ...capabilities.filter((item) => item.store === state.filters.store).map((item) => item.scope)]);
  state.filters.scope = replaceOptions(nodes.scope, scopes, state.filters.scope, scopeLabel, { preserveSelection: true });
  const charts = unique([...state.options.filter(({ target }) => target.store === state.filters.store && target.scope === state.filters.scope).map(({ target }) => target.chart), ...capabilities.filter((item) => item.store === state.filters.store && item.scope === state.filters.scope).map((item) => item.chart)]);
  state.filters.chart = replaceOptions(nodes.chart, charts, state.filters.chart, chartLabel, { preserveSelection: true });
  const markets = marketsByScale([...state.options.filter(({ target }) => target.store === state.filters.store && target.scope === state.filters.scope && target.chart === state.filters.chart).map(({ target }) => target.market), ...capabilities.filter((item) => item.store === state.filters.store && item.scope === state.filters.scope && item.chart === state.filters.chart).flatMap((item) => item.markets)]);
  state.filters.market = replaceOptions(nodes.market, markets, state.filters.market, marketLabel, { preserveSelection: true });
  nodes.window.value = state.filters.window;
  const next = new URLSearchParams(state.filters);
  history.replaceState(null, "", `${location.pathname}?${next}`);
}

function movers(current, baseline) {
  const startRanks = new Map(baseline.entries.map((entry) => [entry.appId, entry.rank]));
  const endRanks = new Map(current.entries.map((entry) => [entry.appId, entry.rank]));
  const risers = [];
  const fallers = [];
  const newEntries = [];
  const topTen = [];
  for (const entry of current.entries) {
    const startRank = startRanks.get(entry.appId);
    if (startRank === undefined) {
      newEntries.push({ ...entry, previousRank: null, move: null });
      if (entry.rank <= 10) topTen.push({ ...entry, previousRank: null, move: null });
      continue;
    }
    const move = startRank - entry.rank;
    if (move > 0) risers.push({ ...entry, previousRank: startRank, move });
    if (move < 0) fallers.push({ ...entry, previousRank: startRank, move });
    if (startRank > 10 && entry.rank <= 10) topTen.push({ ...entry, previousRank: startRank, move });
  }
  risers.sort((a, b) => b.move - a.move);
  fallers.sort((a, b) => a.move - b.move);
  newEntries.sort((a, b) => a.rank - b.rank);
  topTen.sort((a, b) => a.rank - b.rank);
  return { risers, fallers, newEntries, topTen, moved: [...risers, ...fallers].length, endRanks };
}

function renderList(container, items, target, tone) {
  container.replaceChildren();
  for (const item of items.slice(0, 10)) {
    const metadata = metadataFor(state.dataset.catalog, target, item.appId);
    const row = document.createElement("li");
    const link = element("a", "mover-app");
    link.href = appDetailUrl(target, item.appId);
    if (metadata?.iconUrl) {
      const icon = document.createElement("img"); icon.src = metadata.iconUrl; icon.alt = ""; icon.width = 34; icon.height = 34; icon.loading = "lazy"; icon.referrerPolicy = "no-referrer";
      icon.addEventListener("error", () => icon.remove(), { once: true }); link.append(icon);
    }
    const identity = element("span", "mover-app__identity"); identity.append(element("strong", "", metadata?.name ?? item.appId), element("small", "", metadata?.developer ?? item.appId));
    const rank = element("span", "mover-app__rank", `#${item.rank}`);
    const move = element("span", "rank-change", item.move === null ? "NEW" : item.move > 0 ? `↑ ${item.move}` : `↓ ${Math.abs(item.move)}`);
    move.dataset.tone = item.move === null ? "new" : tone;
    link.append(identity, rank, move); row.append(link); container.append(row);
  }
}

async function render() {
  syncFilters();
  const selected = selectedTarget();
  text(nodes.markets, String(unique(state.options.filter(({ target }) => target.store === state.filters.store).map(({ target }) => target.market)).length));
  text(nodes.stores, String(unique(state.options.map(({ target }) => target.store)).length));
  if (!selected) {
    nodes.grid.hidden = true;
    nodes.empty.hidden = false;
    text(nodes.moved, "—"); text(nodes.entrants, "—");
    text(nodes.status, `No chart data is available for ${marketLabel(state.filters.market)}.`);
    setPanelState(nodes.empty, "No data for this market", `${chartLabel(state.filters.chart)} is not available for ${marketLabel(state.filters.market)}. Choose another market to continue.`, "idle");
    return;
  }
  const endOutcome = outcomeForDate(selected.history, "latest", false);
  if (!endOutcome) {
    nodes.grid.hidden = true;
    nodes.empty.hidden = false;
    text(nodes.moved, "—"); text(nodes.entrants, "—");
    setPanelState(nodes.empty, "No complete chart is available", "Try another market or chart.", "idle");
    return;
  }
  const endDate = endOutcome.snapshotPath.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  const observationDate = endDate ? `${endDate[1]}-${endDate[2]}-${endDate[3]}` : endOutcome.finishedAt.slice(0, 10);
  const requestedStart = utcDateMinus(observationDate, Number(state.filters.window));
  const startOutcome = outcomeAtOrBefore(selected.history, requestedStart);
  if (!startOutcome) {
    nodes.grid.hidden = true;
    nodes.empty.hidden = false;
    text(nodes.moved, "—"); text(nodes.entrants, "—");
    text(nodes.status, `${formatDate(observationDate)} · No complete chart on or before ${formatDate(requestedStart)}`);
    setPanelState(nodes.empty, "Not enough history yet", `This chart needs at least ${state.filters.window} days of history before movement can be compared.`, "idle");
    return;
  }
  try {
    const [current, baseline] = await Promise.all([loadSnapshot(endOutcome.snapshotPath), loadSnapshot(startOutcome.snapshotPath)]);
    const result = movers(current, baseline);
    text(nodes.moved, String(result.moved)); text(nodes.entrants, String(result.newEntries.length));
    text(nodes.status, `${formatDate(baseline.marketObservationDate ?? baseline.observationDate)} → ${formatDate(current.marketObservationDate ?? current.observationDate)} · Complete charts`);
    renderList(nodes.risers, result.risers, selected.target, "up");
    renderList(nodes.fallers, result.fallers, selected.target, "down");
    renderList(nodes.newEntries, result.newEntries, selected.target, "new");
    renderList(nodes.topTen, result.topTen, selected.target, "up");
    nodes.empty.hidden = true; nodes.grid.hidden = false;
  } catch (error) {
    nodes.grid.hidden = true;
    nodes.empty.hidden = false;
    text(nodes.moved, "—"); text(nodes.entrants, "—");
    setPanelState(nodes.empty, "Could not load trend data", error instanceof Error ? error.message : String(error), "error");
  }
}

for (const [node, key] of [[nodes.store, "store"], [nodes.market, "market"], [nodes.scope, "scope"], [nodes.chart, "chart"], [nodes.window, "window"]]) {
  node.addEventListener("change", () => { state.filters[key] = node.value; void render(); });
}
bindChrome(() => void render());

try {
  state.dataset = await loadDataset();
  state.histories = buildHistories(state.dataset.runs);
  state.options = targetOptions(state.histories);
  await render();
} catch (error) {
  setPanelState(nodes.empty, "Could not load trend data", error instanceof Error ? error.message : String(error), "error");
}
