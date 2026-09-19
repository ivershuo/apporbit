import {
  appDetailUrl,
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
  observationDateFromPath,
  outcomeForDate,
  previousValidOutcome,
  renderRankChart,
  ratingStars,
  replaceOptions,
  scopeLabel,
  setPanelState,
  snapshotDetails,
  storeLabel,
  targetOptions,
  text,
  unique
} from "./shared.js";

const state = {
  dataset: null,
  histories: new Map(),
  options: [],
  filters: { store: "apple", market: "US", scope: "apps", chart: "top-free", date: "latest" },
  lastRender: null
};

const nodes = {
  storeTabs: [...document.querySelectorAll("[data-store]")],
  market: document.querySelector("#market-filter"),
  scope: document.querySelector("#scope-filter"),
  chart: document.querySelector("#chart-filter"),
  date: document.querySelector("#date-filter"),
  captureStatus: document.querySelector("#capture-status"),
  rankingTitle: document.querySelector("#ranking-title"),
  rankingContext: document.querySelector("#ranking-context"),
  rankingStatus: document.querySelector("#ranking-status"),
  rankingMetadata: document.querySelector("#ranking-metadata"),
  rankingEmpty: document.querySelector("#ranking-empty"),
  tableWrap: document.querySelector("#ranking-table-wrap"),
  body: document.querySelector("#ranking-body"),
  details: document.querySelector("#snapshot-details"),
  detailsList: document.querySelector("#snapshot-details-list"),
  insightDate: document.querySelector("#insight-date"),
  newCount: document.querySelector("#new-count"),
  riserCount: document.querySelector("#riser-count"),
  fallerCount: document.querySelector("#faller-count"),
  marketCount: document.querySelector("#market-count"),
  baselineNote: document.querySelector("#baseline-note"),
  trendTitle: document.querySelector("#trend-title"),
  trendChart: document.querySelector("#trend-chart"),
  dataRoot: document.querySelector("#data-root-label")
};
nodes.priceHeader = document.querySelector('[data-column="price"]');
nodes.installsHeader = document.querySelector('[data-column="installs"]');
nodes.monetizationHeader = document.querySelector('[data-column="monetization"]');

function readQuery() {
  const query = new URLSearchParams(location.search);
  for (const key of Object.keys(state.filters)) {
    if (query.has(key)) state.filters[key] = query.get(key);
  }
}

function writeQuery() {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filters)) {
    if (value && !(key === "date" && value === "latest")) query.set(key, value);
  }
  history.replaceState(null, "", `${location.pathname}${query.size ? `?${query}` : ""}${location.hash}`);
}

function syncFilters() {
  const capabilities = state.dataset.capabilities.capabilities.filter((item) => item.status !== "unsupported");
  const stores = unique([...state.options.map((item) => item.target.store), ...capabilities.map((item) => item.store)]);
  if (!stores.includes(state.filters.store)) state.filters.store = stores[0] ?? "apple";
  for (const button of nodes.storeTabs) button.setAttribute("aria-pressed", String(button.dataset.store === state.filters.store));

  const scopes = unique([
    ...state.options.filter(({ target }) => target.store === state.filters.store).map(({ target }) => target.scope),
    ...capabilities.filter((item) => item.store === state.filters.store).map((item) => item.scope)
  ]);
  state.filters.scope = replaceOptions(nodes.scope, scopes, state.filters.scope, scopeLabel, { preserveSelection: true });
  const charts = unique([
    ...state.options.filter(({ target }) => target.store === state.filters.store && target.scope === state.filters.scope).map(({ target }) => target.chart),
    ...capabilities.filter((item) => item.store === state.filters.store && item.scope === state.filters.scope).map((item) => item.chart)
  ]);
  state.filters.chart = replaceOptions(nodes.chart, charts, state.filters.chart, chartLabel, { preserveSelection: true });
  const markets = unique([
    ...state.options.filter(({ target }) => target.store === state.filters.store && target.scope === state.filters.scope && target.chart === state.filters.chart).map(({ target }) => target.market),
    ...capabilities.filter((item) => item.store === state.filters.store && item.scope === state.filters.scope && item.chart === state.filters.chart).flatMap((item) => item.markets)
  ]);
  state.filters.market = replaceOptions(nodes.market, markets, state.filters.market, marketLabel, { preserveSelection: true });

  const selected = selectedTarget();
  const dates = unique(selected?.history.map((item) => observationDateFromPath(item.snapshotPath)) ?? []).reverse();
  const dateValues = ["latest", ...dates];
  state.filters.date = replaceOptions(nodes.date, dateValues, state.filters.date, (value) => value === "latest" ? "Latest available" : formatDate(value));
}

function selectedTarget() {
  return state.options.find(({ target }) =>
    target.store === state.filters.store &&
    target.market === state.filters.market &&
    target.scope === state.filters.scope &&
    target.chart === state.filters.chart
  ) ?? null;
}

function clearSummary(message) {
  text(nodes.newCount, "—");
  text(nodes.riserCount, "—");
  text(nodes.fallerCount, "—");
  text(nodes.marketCount, "—");
  text(nodes.baselineNote, message);
  text(nodes.trendTitle, "Ranking Trend");
  setPanelState(nodes.trendChart, "No trend available", message, "idle");
}

function compactCount(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function ratingCell(metadata) {
  const cell = document.createElement("td");
  cell.className = "rating-cell";
  cell.dataset.label = "Rating";
  if (!Number.isFinite(metadata?.rating)) {
    cell.textContent = "—";
    return cell;
  }
  const value = element("strong", "rating-value");
  value.append(ratingStars(metadata.rating), document.createTextNode(` ${metadata.rating.toFixed(1)}`));
  cell.append(value);
  if (Number.isFinite(metadata.ratingsCount)) {
    cell.append(element("small", "rating-count", `${compactCount(metadata.ratingsCount)} ratings`));
  }
  return cell;
}

function priceCell(metadata, target) {
  const cell = element("td", "price-cell");
  cell.dataset.label = "Price";
  cell.textContent = metadata?.priceText ?? (metadata?.free === true || target.chart === "top-free" ? "Free" : Number.isFinite(metadata?.price) ? String(metadata.price) : "—");
  return cell;
}

function monetizationCell(metadata) {
  const cell = document.createElement("td");
  cell.className = "metadata-cell";
  cell.dataset.label = "Monetization";
  const values = [];
  if (metadata?.offersIAP === true) values.push("IAP");
  else if (metadata?.offersIAP === false) values.push("No IAP");
  if (metadata?.adSupported === true) values.push("Ads");
  else if (metadata?.adSupported === false) values.push("No ads");
  cell.textContent = values.join(" · ") || "—";
  if (metadata?.iapRange) cell.title = `In-app purchases: ${metadata.iapRange}`;
  return cell;
}

function appendMobileFact(list, label, value) {
  if (value === undefined || value === null || value === "" || value === "—") return;
  const row = document.createElement("div");
  row.append(element("dt", "", label));
  const definition = document.createElement("dd");
  if (value instanceof Node) definition.append(value);
  else definition.textContent = String(value);
  row.append(definition);
  list.append(row);
}

function mobileDetailsCell(metadata, target, visibleColumns, storeCell) {
  const cell = element("td", "mobile-detail-cell");
  cell.dataset.label = "More details";
  const details = document.createElement("details");
  const summary = element("summary", "", "More details");
  const list = document.createElement("dl");
  appendMobileFact(list, "Developer", metadata?.developer);
  appendMobileFact(list, "Categories", metadata?.storeCategories?.join(", ") || target.normalizedCategory);
  if (Number.isFinite(metadata?.rating)) {
    const rating = element("span", "mobile-rating");
    rating.append(ratingStars(metadata.rating), document.createTextNode(` ${metadata.rating.toFixed(1)}`));
    appendMobileFact(list, "Rating", rating);
  }
  if (Number.isFinite(metadata?.ratingsCount)) appendMobileFact(list, "Ratings", compactCount(metadata.ratingsCount));
  if (visibleColumns.price) appendMobileFact(list, "Price", priceCell(metadata, target).textContent);
  if (visibleColumns.installs) appendMobileFact(list, "Installs", metadata?.installRange);
  if (visibleColumns.monetization) {
    const monetization = monetizationCell(metadata).textContent;
    appendMobileFact(list, "Monetization", metadata?.iapRange ? `${monetization} · ${metadata.iapRange}` : monetization);
  }
  appendMobileFact(list, "Content rating", metadata?.contentRating);
  appendMobileFact(list, "Version", metadata?.version);
  appendMobileFact(list, "Minimum OS", metadata?.minimumOsVersion);
  appendMobileFact(list, "Released", metadata?.released ? formatStoreDate(metadata.released) : null);
  appendMobileFact(list, "Updated", metadata?.updatedAt ? formatStoreDate(metadata.updatedAt) : null);
  const storeLink = storeCell.firstElementChild?.cloneNode(true);
  if (storeLink) appendMobileFact(list, "Store", storeLink);
  if (!list.childElementCount) appendMobileFact(list, "Details", "No additional store details are available.");
  details.append(summary, list);
  cell.append(details);
  return cell;
}

function latestMetadataTime(target, compared) {
  return compared
    .map((item) => metadataFor(state.dataset.catalog, target, item.appId)?.observedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

function appendRankingRow(item, target, hasBaseline, visibleColumns) {
  const metadata = metadataFor(state.dataset.catalog, target, item.appId);
  const row = document.createElement("tr");
  const rank = element("td", "rank-cell", String(item.rank));
  rank.dataset.label = "Rank";

  const app = document.createElement("td");
  app.dataset.label = "App";
  const wrap = element("div", "app-row");
  if (metadata?.iconUrl) {
    const icon = document.createElement("img");
    icon.className = "app-icon";
    icon.src = metadata.iconUrl;
    icon.alt = "";
    icon.width = 36;
    icon.height = 36;
    icon.loading = "lazy";
    icon.referrerPolicy = "no-referrer";
    icon.addEventListener("error", () => icon.remove(), { once: true });
    wrap.append(icon);
  }
  const identity = element("span", "app-row__identity");
  const link = element("a", "app-row__name", metadata?.name ?? item.appId);
  link.href = appDetailUrl(target, item.appId);
  identity.append(link, element("small", "app-row__developer", metadata?.developer ?? "—"));
  wrap.append(identity);
  app.append(wrap);

  const categories = element("td", "category-cell", metadata?.storeCategories?.join(", ") || target.normalizedCategory || "—");
  categories.dataset.label = "Categories";
  const rating = ratingCell(metadata);
  const price = priceCell(metadata, target);
  const installs = element("td", "numeric-cell", metadata?.installRange ?? "—");
  installs.dataset.label = "Installs";
  const monetization = monetizationCell(metadata);
  const contentRating = element("td", "metadata-cell", metadata?.contentRating ?? "—");
  contentRating.dataset.label = "Content rating";
  const version = element("td", "metadata-cell", metadata?.version ?? "—");
  version.classList.add("version-cell");
  version.title = metadata?.version ?? "";
  version.dataset.label = "Version";
  const minimumOs = element("td", "metadata-cell", metadata?.minimumOsVersion ?? "—");
  minimumOs.dataset.label = "Minimum OS";
  const released = element("td", "date-cell", metadata?.released ? formatStoreDate(metadata.released) : "—");
  released.dataset.label = "Released";
  const updated = element("td", "date-cell", metadata?.updatedAt ? formatStoreDate(metadata.updatedAt) : "—");
  updated.dataset.label = "Updated";
  const change = document.createElement("td");
  change.dataset.label = "Change";
  const presentation = changePresentation(item, hasBaseline);
  const changeText = element("span", "rank-change", presentation.label);
  changeText.dataset.tone = presentation.tone;
  changeText.title = presentation.title;
  change.append(changeText);
  const store = document.createElement("td");
  store.dataset.label = "Store";
  if (metadata?.storeUrl) {
    const storeLink = element("a", "table-link", "Open ↗");
    storeLink.href = metadata.storeUrl;
    storeLink.target = "_blank";
    storeLink.rel = "noreferrer";
    store.append(storeLink);
  } else {
    store.textContent = "—";
  }
  row.append(rank, app, change);
  if (visibleColumns.price) row.append(price);
  row.append(categories, rating);
  if (visibleColumns.installs) row.append(installs);
  if (visibleColumns.monetization) row.append(monetization);
  row.append(contentRating, version, minimumOs, released, updated, store);
  row.append(mobileDetailsCell(metadata, target, visibleColumns, store));
  nodes.body.append(row);
}

function renderDetails(snapshot, previous) {
  nodes.detailsList.replaceChildren();
  for (const value of snapshotDetails(snapshot, previous)) {
    const item = document.createElement("div");
    item.append(element("dt", "", value.split(" ")[0]), element("dd", "", value.slice(value.indexOf(" ") + 1)));
    nodes.detailsList.append(item);
  }
  const source = document.createElement("div");
  const link = element("a", "", "Open source ↗");
  link.href = snapshot.source.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  source.append(element("dt", "", "source-url"), element("dd", ""));
  source.querySelector("dd").append(link);
  nodes.detailsList.append(source);
  nodes.details.hidden = false;
  if (new URLSearchParams(location.search).get("debug") === "1") nodes.details.open = true;
}

async function renderTrend(target, appId) {
  const selected = selectedTarget();
  const valid = selected.history.filter((item) => item.status === "valid");
  const snapshots = await Promise.all(valid.map((item) => loadSnapshot(item.snapshotPath)));
  const points = dailyRankPoints(snapshots.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)), appId);
  const metadata = metadataFor(state.dataset.catalog, target, appId);
  text(nodes.trendTitle, `${metadata?.name ?? appId} Ranking Trend`);
  renderRankChart(nodes.trendChart, points, { compact: true });
}

async function render() {
  syncFilters();
  writeQuery();
  const selected = selectedTarget();
  if (!selected) {
    nodes.tableWrap.hidden = true;
    nodes.rankingEmpty.hidden = false;
    nodes.details.hidden = true;
    text(nodes.rankingContext, `${storeLabel(state.filters.store)} · ${marketLabel(state.filters.market)} · ${scopeLabel(state.filters.scope)}`);
    text(nodes.rankingTitle, `${chartLabel(state.filters.chart)}`);
    text(nodes.rankingStatus, "NO DATA");
    text(nodes.rankingMetadata, "Metadata observed: —");
    delete nodes.rankingStatus.dataset.status;
    text(nodes.captureStatus, `No chart data is available for ${marketLabel(state.filters.market)}.`);
    clearSummary(`No chart data is available for ${marketLabel(state.filters.market)}.`);
    setPanelState(nodes.rankingEmpty, "No data for this market", `${chartLabel(state.filters.chart)} is not available for ${marketLabel(state.filters.market)}. Choose another market to continue.`, "idle");
    return;
  }
  const outcome = outcomeForDate(selected.history, state.filters.date);
  if (!outcome) {
    nodes.tableWrap.hidden = true;
    nodes.rankingEmpty.hidden = false;
    nodes.details.hidden = true;
    text(nodes.rankingStatus, "NO DATA");
    text(nodes.rankingMetadata, "Metadata observed: —");
    delete nodes.rankingStatus.dataset.status;
    text(nodes.captureStatus, "No complete chart is available for this market date.");
    clearSummary("No complete chart is available for this date.");
    setPanelState(nodes.rankingEmpty, "No chart for this date", "Choose another market date to continue.", "idle");
    return;
  }

  setPanelState(nodes.rankingEmpty, "Loading rankings", "Fetching the selected chart.", "loading");
  nodes.rankingEmpty.hidden = false;
  nodes.tableWrap.hidden = true;
  try {
    const previousOutcome = previousValidOutcome(selected.history, outcome);
    const [snapshot, previous] = await Promise.all([
      loadSnapshot(outcome.snapshotPath),
      previousOutcome ? loadSnapshot(previousOutcome.snapshotPath) : Promise.resolve(null)
    ]);
    const compared = compareSnapshots(snapshot, previous);
    const visibleColumns = {
      price: snapshot.chart !== "top-free",
      installs: compared.some((item) => {
        const metadata = metadataFor(state.dataset.catalog, selected.target, item.appId);
        return Boolean(metadata?.installRange) || Number.isFinite(metadata?.minInstalls) || Number.isFinite(metadata?.maxInstalls);
      }),
      monetization: compared.some((item) => {
        const metadata = metadataFor(state.dataset.catalog, selected.target, item.appId);
        return metadata?.offersIAP !== undefined || metadata?.adSupported !== undefined || Boolean(metadata?.iapRange);
      })
    };
    nodes.priceHeader.hidden = !visibleColumns.price;
    nodes.installsHeader.hidden = !visibleColumns.installs;
    nodes.monetizationHeader.hidden = !visibleColumns.monetization;
    state.lastRender = { snapshot, previous, selected };
    text(nodes.rankingContext, `${storeLabel(snapshot.store)} · ${marketLabel(snapshot.market)} · ${scopeLabel(snapshot.scope)}`);
    text(nodes.rankingTitle, `${chartLabel(snapshot.chart)} · ${snapshot.actualCount} apps`);
    text(nodes.rankingStatus, snapshot.status === "valid" ? "COMPLETE" : snapshot.status.toUpperCase());
    nodes.rankingStatus.dataset.status = snapshot.status;
    text(nodes.captureStatus, `${formatTime(snapshot.capturedAt)} · ${snapshot.complete ? "Complete chart" : `Partial ${snapshot.actualCount}/${snapshot.expectedCount}`}`);
    text(nodes.insightDate, formatDate(snapshot.marketObservationDate ?? snapshot.observationDate));
    const latestMetadata = latestMetadataTime(selected.target, compared);
    text(nodes.rankingMetadata, latestMetadata ? `Metadata observed through ${formatTime(latestMetadata)}` : "Metadata observed: unavailable");
    text(nodes.dataRoot, state.dataset.dataRootLabel);

    nodes.body.replaceChildren();
    for (const item of compared) appendRankingRow(item, selected.target, Boolean(previous), visibleColumns);
    nodes.rankingEmpty.hidden = true;
    nodes.tableWrap.hidden = false;
    renderDetails(snapshot, previous);

    text(nodes.newCount, previous ? String(compared.filter((item) => item.isNew).length) : "—");
    text(nodes.riserCount, previous ? String(compared.filter((item) => item.change > 0).length) : "—");
    text(nodes.fallerCount, previous ? String(compared.filter((item) => item.change < 0).length) : "—");
    const markets = unique(state.options.filter(({ target, history }) =>
      target.store === state.filters.store && target.scope === state.filters.scope && target.chart === state.filters.chart && outcomeForDate(history)
    ).map(({ target }) => target.market));
    text(nodes.marketCount, String(markets.length));
    text(nodes.baselineNote, previous
      ? `Compared with the previous complete chart from ${formatTime(previous.capturedAt)}.`
      : "No previous complete chart is available, so rank changes are not shown."
    );
    if (snapshot.entries[0]) await renderTrend(selected.target, snapshot.entries[0].appId);
  } catch (error) {
    nodes.tableWrap.hidden = true;
    nodes.rankingEmpty.hidden = false;
    clearSummary("The selected chart could not be loaded.");
    setPanelState(nodes.rankingEmpty, "Could not load this chart", error instanceof Error ? error.message : String(error), "error");
  }
}

function bind() {
  for (const button of nodes.storeTabs) {
    button.addEventListener("click", () => {
      state.filters.store = button.dataset.store;
      state.filters.date = "latest";
      void render();
    });
  }
  for (const [node, key] of [[nodes.market, "market"], [nodes.scope, "scope"], [nodes.chart, "chart"], [nodes.date, "date"]]) {
    node.addEventListener("change", () => {
      state.filters[key] = node.value;
      if (key !== "date") state.filters.date = "latest";
      void render();
    });
  }
  bindChrome(() => void render());
}

async function start() {
  readQuery();
  bind();
  try {
    state.dataset = await loadDataset();
    state.histories = buildHistories(state.dataset.runs);
    state.options = targetOptions(state.histories);
    await render();
  } catch (error) {
    setPanelState(nodes.rankingEmpty, "Could not load chart data", error instanceof Error ? error.message : String(error), "error");
  }
}

void start();
