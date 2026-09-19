import {
  bindChrome,
  buildHistories,
  changePresentation,
  chartLabel,
  compareSnapshots,
  dailyRankPoints,
  element,
  formatDate,
  formatStoreDate,
  formatTime,
  loadDataset,
  loadSnapshot,
  marketLabel,
  metadataFor,
  outcomeForDate,
  previousValidOutcome,
  renderRankChart,
  ratingStars,
  replaceOptions,
  scopeLabel,
  snapshotDetails,
  storeLabel,
  targetOptions,
  text,
  unique,
  utcDateMinus
} from "./shared.js";
import { marketsByScale } from "./market-order.js";

const query = new URLSearchParams(location.search);
const state = {
  appId: query.get("id") ?? "",
  store: query.get("store") ?? "apple",
  market: query.get("market") ?? "US",
  scope: query.get("scope") ?? "apps",
  chart: query.get("chart") ?? "top-free",
  category: query.get("category") ?? "all-apps",
  range: "90",
  dataset: null,
  histories: new Map(),
  options: []
};

const nodes = Object.fromEntries([
  "breadcrumb-name", "app-icon-wrap", "app-name", "app-developer", "app-summary", "app-tags", "app-metadata-line", "app-store-link",
  "app-metadata-list", "app-description", "app-description-copy",
  "current-rank", "current-rank-note", "highest-rank", "countries-ranked", "countries-note", "top-ten-days", "first-seen",
  "detail-store", "detail-market", "detail-chart", "app-rank-chart", "history-context", "history-empty", "history-table-wrap",
  "history-body", "markets-body", "biggest-jump", "biggest-jump-note", "best-observed", "best-observed-note", "app-provenance-list"
].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#${id}`)]));
nodes.rangeButtons = [...document.querySelectorAll("[data-range]")];

function compactCount(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(amount)} ${units[unit]}`;
}

function priceLabel(metadata, target) {
  if (metadata?.priceText) return metadata.priceText;
  if (metadata?.free === true || target.chart === "top-free") return "Free";
  if (!Number.isFinite(metadata?.price)) return "—";
  if (metadata.currency) {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: metadata.currency }).format(metadata.price);
    } catch {}
  }
  return String(metadata.price);
}

function firstParagraph(value) {
  return value?.split(/\n\s*\n|\r?\n/, 1)[0]?.trim() || "";
}

function metadataFact(label, value, href) {
  if (value === undefined || value === null || value === "") return;
  const item = document.createElement("div");
  item.append(element("dt", "", label));
  const description = document.createElement("dd");
  if (href) {
    const link = element("a", "", String(value));
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    description.append(link);
  } else {
    if (value instanceof Node) description.append(value);
    else description.textContent = String(value);
  }
  item.append(description);
  nodes.app_metadata_list.append(item);
}

function renderMetadata(metadata, target) {
  nodes.app_metadata_list.replaceChildren();
  metadataFact("Store ID", state.appId);
  metadataFact("Bundle ID", metadata?.bundleId);
  metadataFact("Developer ID", metadata?.developerId);
  metadataFact("Developer website", metadata?.developerWebsite ? "Open website ↗" : null, metadata?.developerWebsite);
  metadataFact("Categories", metadata?.storeCategories?.join(", "));
  metadataFact("Genre ID", metadata?.primaryGenreId);
  metadataFact("Price", priceLabel(metadata, target));
  if (Number.isFinite(metadata?.rating)) {
    const rating = element("span", "rating-value");
    rating.append(ratingStars(metadata.rating), document.createTextNode(` ${metadata.rating.toFixed(1)}`));
    metadataFact("Rating", rating);
  }
  metadataFact("Ratings", Number.isFinite(metadata?.ratingsCount) ? metadata.ratingsCount.toLocaleString("en") : null);
  metadataFact("Reviews", Number.isFinite(metadata?.reviewsCount) ? metadata.reviewsCount.toLocaleString("en") : null);
  metadataFact("Installs", metadata?.installRange);
  metadataFact("Minimum installs", Number.isFinite(metadata?.minInstalls) ? metadata.minInstalls.toLocaleString("en") : null);
  metadataFact("Maximum installs", Number.isFinite(metadata?.maxInstalls) ? metadata.maxInstalls.toLocaleString("en") : null);
  metadataFact("In-app purchases", metadata?.offersIAP === undefined ? null : metadata.offersIAP ? "Yes" : "No");
  metadataFact("IAP range", metadata?.iapRange);
  metadataFact("Contains ads", metadata?.adSupported === undefined ? null : metadata.adSupported ? "Yes" : "No");
  metadataFact("Released", metadata?.released ? formatStoreDate(metadata.released) : null);
  metadataFact("Updated", metadata?.updatedAt ? formatStoreDate(metadata.updatedAt) : null);
  metadataFact("Version", metadata?.version);
  metadataFact("Minimum OS", metadata?.minimumOsVersion);
  metadataFact("Content rating", metadata?.contentRating);
  metadataFact("Download size", Number.isFinite(metadata?.fileSizeBytes) ? formatBytes(metadata.fileSizeBytes) : null);
  metadataFact("Languages", metadata?.languages?.join(", "));

  const description = metadata?.description;
  nodes.app_description.hidden = !description;
  text(nodes.app_description_copy, description ?? "");
}

function selectedTarget() {
  return state.options.find(({ target }) =>
    target.store === state.store && target.market === state.market && target.scope === state.scope && target.chart === state.chart
  ) ?? null;
}

function writeQuery() {
  const next = new URLSearchParams({ store: state.store, market: state.market, scope: state.scope, chart: state.chart, category: state.category, id: state.appId });
  history.replaceState(null, "", `${location.pathname}?${next}`);
}

function syncFilters() {
  const stores = unique(state.options.filter(({ target }) => target.store === state.store).map(({ target }) => target.store));
  state.store = replaceOptions(nodes.detail_store, stores.length ? stores : [state.store], state.store, storeLabel);
  const capabilities = state.dataset.capabilities.capabilities.filter((item) => item.status !== "unsupported" && item.store === state.store && item.scope === state.scope);
  const charts = unique([...state.options.filter(({ target }) => target.store === state.store && target.scope === state.scope).map(({ target }) => target.chart), ...capabilities.map((item) => item.chart)]);
  state.chart = replaceOptions(nodes.detail_chart, charts, state.chart, chartLabel, { preserveSelection: true });
  const markets = marketsByScale([...state.options.filter(({ target }) => target.store === state.store && target.scope === state.scope && target.chart === state.chart).map(({ target }) => target.market), ...capabilities.filter((item) => item.chart === state.chart).flatMap((item) => item.markets)]);
  state.market = replaceOptions(nodes.detail_market, markets, state.market, marketLabel, { preserveSelection: true });
  writeQuery();
}

function renderIdentity(target) {
  const metadata = metadataFor(state.dataset.catalog, target, state.appId);
  text(nodes.app_name, metadata?.name ?? state.appId ?? "Unknown app");
  text(nodes.breadcrumb_name, metadata?.name ?? state.appId ?? "App");
  text(nodes.app_developer, metadata?.developer ?? "Developer not available");
  text(nodes.app_summary, metadata?.summary || firstParagraph(metadata?.description) || `${storeLabel(target.store)} · ${marketLabel(target.market)}`);
  document.title = `${metadata?.name ?? state.appId} · AppOrbit`;
  nodes.app_icon_wrap.replaceChildren();
  if (metadata?.iconUrl) {
    const icon = document.createElement("img");
    icon.src = metadata.iconUrl;
    icon.alt = `${metadata.name} icon`;
    icon.width = 112;
    icon.height = 112;
    icon.referrerPolicy = "no-referrer";
    icon.addEventListener("error", () => icon.remove(), { once: true });
    nodes.app_icon_wrap.append(icon);
  } else {
    nodes.app_icon_wrap.append(element("span", "app-icon-placeholder", storeLabel(target.store).slice(0, 1)));
  }
  nodes.app_tags.replaceChildren();
  const tags = unique([...(metadata?.storeCategories ?? []), scopeLabel(target.scope), chartLabel(target.chart)]);
  for (const tag of tags.slice(0, 5)) nodes.app_tags.append(element("span", "tag", tag));
  const metadataFacts = [];
  if (Number.isFinite(metadata?.ratingsCount)) metadataFacts.push(`${compactCount(metadata.ratingsCount)} ratings`);
  if (metadata?.installRange) metadataFacts.push(`${metadata.installRange} installs`);
  if (metadata?.released) metadataFacts.push(`Released ${formatStoreDate(metadata.released)}`);
  if (metadata?.updatedAt) metadataFacts.push(`Updated ${formatStoreDate(metadata.updatedAt)}`);
  if (metadata?.version) metadataFacts.push(`Version ${metadata.version}`);
  const price = priceLabel(metadata, target);
  if (price !== "—") metadataFacts.push(price === "Free" ? "Free" : `Price ${price}`);
  text(nodes.app_metadata_line, metadataFacts.length ? metadataFacts.join(" · ") : "Extended store metadata is not available for this app.");
  if (Number.isFinite(metadata?.rating)) {
    nodes.app_metadata_line.prepend(ratingStars(metadata.rating), document.createTextNode(` ${metadata.rating.toFixed(1)} · `));
  }
  renderMetadata(metadata, target);
  if (metadata?.storeUrl) {
    nodes.app_store_link.href = metadata.storeUrl;
    nodes.app_store_link.textContent = `Open in ${storeLabel(target.store)} ↗`;
    nodes.app_store_link.hidden = false;
  } else {
    nodes.app_store_link.hidden = true;
  }
  return metadata;
}

function filterRange(points) {
  if (state.range === "all" || points.length === 0) return points;
  const end = points.at(-1).date;
  const start = utcDateMinus(end, Number(state.range) - 1);
  return points.filter((point) => point.date >= start);
}

function renderHistory(points) {
  nodes.history_body.replaceChildren();
  const recent = [...points].reverse().slice(0, 12);
  if (!recent.length) {
    nodes.history_table_wrap.hidden = true;
    nodes.history_empty.hidden = false;
    nodes.history_empty.textContent = "No complete ranking history is available for this selection.";
    return;
  }
  nodes.history_empty.hidden = true;
  nodes.history_table_wrap.hidden = false;
  for (const [index, point] of recent.entries()) {
    const chronologicalIndex = points.length - index - 1;
    const prior = points[chronologicalIndex - 1];
    const row = document.createElement("tr");
    const delta = prior?.rank && point.rank ? prior.rank - point.rank : null;
    const change = delta === null ? "—" : delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${Math.abs(delta)}` : "—";
    for (const [label, value] of [["Date", formatDate(point.date)], ["Rank", point.rank ? `#${point.rank}` : "Not ranked"], ["Change", change], ["Status", point.snapshotValid ? "Complete" : "Unavailable"]]) {
      const cell = element("td", "", value);
      cell.dataset.label = label;
      row.append(cell);
    }
    nodes.history_body.append(row);
  }
}

function renderProvenance(snapshot, previous, metadata) {
  nodes.app_provenance_list.replaceChildren();
  const facts = [
    `store-app-id ${snapshot.store}:${state.appId}`,
    `app-details-observed ${metadata?.observedAt ?? "unavailable"}`,
    `app-details-market ${metadata?.market ?? "unavailable"}`,
    ...snapshotDetails(snapshot, previous)
  ];
  for (const fact of facts) {
    const split = fact.indexOf(" ");
    const item = document.createElement("div");
    item.append(element("dt", "", fact.slice(0, split)), element("dd", "", fact.slice(split + 1)));
    nodes.app_provenance_list.append(item);
  }
}

async function renderMarkets(target) {
  const candidates = state.options.filter(({ target: item }) => item.store === target.store && item.scope === target.scope && item.chart === target.chart);
  const rows = [];
  for (const candidate of candidates) {
    const currentOutcome = outcomeForDate(candidate.history, "latest", false);
    if (!currentOutcome) continue;
    const previousOutcome = previousValidOutcome(candidate.history, currentOutcome);
    const [current, previous] = await Promise.all([loadSnapshot(currentOutcome.snapshotPath), previousOutcome ? loadSnapshot(previousOutcome.snapshotPath) : Promise.resolve(null)]);
    const entry = current.entries.find((item) => item.appId === state.appId);
    if (!entry) continue;
    const compared = compareSnapshots({ entries: [entry] }, previous).at(0);
    rows.push({ market: candidate.target.market, rank: entry.rank, change: changePresentation(compared, Boolean(previous)) });
  }
  rows.sort((left, right) => left.rank - right.rank);
  nodes.markets_body.replaceChildren();
  for (const item of rows) {
    const row = document.createElement("tr");
    const market = element("td", "", marketLabel(item.market)); market.dataset.label = "Market";
    const rank = element("td", "", `#${item.rank}`); rank.dataset.label = "Rank";
    const change = document.createElement("td"); change.dataset.label = "Change";
    const badge = element("span", "rank-change", item.change.label); badge.dataset.tone = item.change.tone; change.append(badge);
    row.append(market, rank, change); nodes.markets_body.append(row);
  }
  text(nodes.countries_ranked, String(rows.length));
  text(nodes.countries_note, `${rows.length} markets on the latest complete charts`);
  return rows;
}

async function render() {
  syncFilters();
  const selected = selectedTarget();
  if (!state.appId) {
    text(nodes.app_name, "No app selected");
    text(nodes.app_summary, "Open an app from Charts or Trending to see its history.");
    return;
  }
  if (!selected) {
    const requestedTarget = { store: state.store, market: state.market, scope: state.scope, chart: state.chart, normalizedCategory: state.category };
    renderIdentity(requestedTarget);
    text(nodes.current_rank, "—");
    text(nodes.current_rank_note, `No ${chartLabel(state.chart)} data is available for ${marketLabel(state.market)}.`);
    text(nodes.highest_rank, "—");
    text(nodes.top_ten_days, "—");
    text(nodes.first_seen, "—");
    text(nodes.best_observed, "—");
    text(nodes.best_observed_note, "No data for this market");
    text(nodes.biggest_jump, "—");
    text(nodes.biggest_jump_note, "No data for this market");
    renderRankChart(nodes.app_rank_chart, []);
    renderHistory([]);
    await renderMarkets(requestedTarget);
    return;
  }
  const metadata = renderIdentity(selected.target);
  const validOutcomes = selected.history.filter((item) => item.status === "valid");
  const snapshots = await Promise.all(validOutcomes.map((item) => loadSnapshot(item.snapshotPath)));
  snapshots.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  const points = dailyRankPoints(snapshots, state.appId);
  const currentOutcome = outcomeForDate(selected.history, "latest", false);
  if (!currentOutcome) {
    text(nodes.current_rank, "—");
    renderRankChart(nodes.app_rank_chart, []);
    renderHistory([]);
    return;
  }
  const previousOutcome = previousValidOutcome(selected.history, currentOutcome);
  const [current, previous] = await Promise.all([loadSnapshot(currentOutcome.snapshotPath), previousOutcome ? loadSnapshot(previousOutcome.snapshotPath) : Promise.resolve(null)]);
  const currentEntry = current.entries.find((item) => item.appId === state.appId);
  const compared = currentEntry ? compareSnapshots({ entries: [currentEntry] }, previous).at(0) : null;
  const change = compared ? changePresentation(compared, Boolean(previous)) : null;
  text(nodes.current_rank, currentEntry ? `#${currentEntry.rank}` : "Not ranked");
  text(nodes.current_rank_note, currentEntry ? `${marketLabel(selected.target.market)} · ${change.label} · ${formatTime(current.capturedAt)}` : `Not present on the latest complete chart for ${marketLabel(selected.target.market)}`);

  const observedRanks = points.filter((point) => point.rank).map((point) => point.rank);
  const best = observedRanks.length ? Math.min(...observedRanks) : null;
  text(nodes.highest_rank, best ? `#${best}` : "—");
  text(nodes.best_observed, best ? `#${best}` : "—");
  const bestPoint = best ? points.find((point) => point.rank === best) : null;
  text(nodes.best_observed_note, bestPoint ? `${formatDate(bestPoint.date)} · ${marketLabel(selected.target.market)}` : "More history is needed");
  text(nodes.top_ten_days, String(points.filter((point) => point.rank && point.rank <= 10).length));
  const metadataDates = Object.values(state.dataset.catalog).filter((item) => item.store === state.store && item.appId === state.appId).map((item) => item.observedAt).sort();
  const firstSeen = metadataDates[0] ?? snapshots.find((snapshot) => snapshot.entries.some((entry) => entry.appId === state.appId))?.capturedAt;
  text(nodes.first_seen, firstSeen ? formatDate(firstSeen.slice(0, 10)) : "—");

  renderRankChart(nodes.app_rank_chart, filterRange(points));
  renderHistory(points);
  text(nodes.history_context, `${storeLabel(state.store)} · ${marketLabel(state.market)} · ${chartLabel(state.chart)}`);
  const jumps = points.slice(1).map((point, index) => ({ point, from: points[index], delta: points[index].rank && point.rank ? points[index].rank - point.rank : null })).filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta);
  const biggest = jumps[0];
  text(nodes.biggest_jump, biggest ? `↑ ${biggest.delta} ranks` : "—");
  text(nodes.biggest_jump_note, biggest ? `${formatDate(biggest.from.date)} → ${formatDate(biggest.point.date)}` : "At least two market chart dates are needed");
  await renderMarkets(selected.target);
  renderProvenance(current, previous, metadata);
}

function bind() {
  nodes.detail_market.addEventListener("change", () => { state.market = nodes.detail_market.value; void render(); });
  nodes.detail_chart.addEventListener("change", () => { state.chart = nodes.detail_chart.value; void render(); });
  for (const button of nodes.rangeButtons) button.addEventListener("click", () => {
    state.range = button.dataset.range;
    for (const item of nodes.rangeButtons) item.setAttribute("aria-pressed", String(item === button));
    void render();
  });
  bindChrome(() => void render());
}

async function start() {
  bind();
  try {
    state.dataset = await loadDataset();
    state.histories = buildHistories(state.dataset.runs);
    state.options = targetOptions(state.histories);
    await render();
  } catch (error) {
    text(nodes.app_name, "Could not load app data");
    text(nodes.app_summary, error instanceof Error ? error.message : String(error));
  }
}

void start();
