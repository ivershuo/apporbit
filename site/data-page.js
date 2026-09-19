import { bindChrome, buildHistories, chartLabel, element, formatTime, loadDataset, marketLabel, scopeLabel, storeLabel, targetOptions, text } from "./shared.js";

const nodes = {
  runs: document.querySelector("#run-count"),
  targets: document.querySelector("#target-count"),
  capabilities: document.querySelector("#capability-count"),
  root: document.querySelector("#data-root"),
  catalog: document.querySelector("#catalog-count"),
  apps: document.querySelector("#app-count"),
  developers: document.querySelector("#developer-count"),
  latestMetadata: document.querySelector("#latest-metadata"),
  metadataCoverageChart: document.querySelector("#metadata-coverage-chart"),
  categoriesChart: document.querySelector("#categories-chart"),
  developersChart: document.querySelector("#developers-chart"),
  marketCatalogChart: document.querySelector("#market-catalog-chart"),
  capabilityBody: document.querySelector("#capabilities-body"),
  runsBody: document.querySelector("#runs-body")
};

let currentDataset = null;

function statusCounts(run) {
  return run.targets.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), {});
}

function appendRow(body, values, labels, classNames = []) {
  const row = document.createElement("tr");
  values.forEach((value, index) => {
    const cell = element("td", classNames[index] ?? "", value);
    cell.dataset.label = labels[index];
    row.append(cell);
  });
  body.append(row);
  return row;
}

function percent(count, total) {
  return total ? `${Math.round((count / total) * 100)}%` : "—";
}

function distinctAppKey(item) {
  return `${item.store}:${item.appId}`;
}

function groupedDistinctCounts(records, valuesForRecord) {
  const groups = new Map();
  for (const item of records) {
    for (const value of valuesForRecord(item)) {
      if (!value) continue;
      if (!groups.has(value)) groups.set(value, new Set());
      groups.get(value).add(distinctAppKey(item));
    }
  }
  return [...groups.entries()]
    .map(([name, apps]) => ({ name, count: apps.size }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function chartRow(label, value, maximum, valueLabel = String(value)) {
  const row = element("div", "chart-row");
  const name = element("span", "chart-row__label", label);
  name.title = label;
  const track = element("span", "chart-row__track");
  track.setAttribute("aria-hidden", "true");
  const bar = element("span", "chart-row__bar");
  bar.style.setProperty("--chart-value", `${maximum > 0 ? (value / maximum) * 100 : 0}%`);
  track.append(bar);
  row.append(name, track, element("strong", "chart-row__value", valueLabel));
  return row;
}

function marketChartColumn(market, counts, maximum) {
  const column = element("div", "market-column");
  const bars = element("div", "market-bars");
  bars.setAttribute("aria-hidden", "true");
  for (const [store, value] of [["apple", counts.apple], ["google-play", counts.googlePlay]]) {
    const bar = element("span", "market-bar");
    bar.dataset.series = store;
    bar.style.setProperty("--chart-value", `${maximum > 0 ? (value / maximum) * 100 : 0}%`);
    bar.title = `${store === "apple" ? "App Store" : "Google Play"}: ${value.toLocaleString("en")}`;
    bars.append(bar);
  }
  const values = element("small", "market-column__values", `A ${counts.apple.toLocaleString("en")} · G ${counts.googlePlay.toLocaleString("en")}`);
  const total = counts.apple + counts.googlePlay;
  column.setAttribute("aria-label", `${market}: App Store ${counts.apple}, Google Play ${counts.googlePlay}, total ${total}`);
  column.append(bars, element("strong", "market-column__label", marketLabel(market, { compact: true })), values);
  return column;
}

function renderCatalog(records) {
  const uniqueApps = new Set(records.map(distinctAppKey));
  const developers = new Set(records.map((item) => item.developer).filter(Boolean));
  const latestObserved = records.map((item) => item.observedAt).filter(Boolean).sort().at(-1);
  text(nodes.catalog, records.length.toLocaleString("en"));
  text(nodes.apps, uniqueApps.size.toLocaleString("en"));
  text(nodes.developers, developers.size.toLocaleString("en"));
  text(nodes.latestMetadata, latestObserved ? formatTime(latestObserved) : "—");

  const dimensions = [
    ["Ratings", (item) => Number.isFinite(item.rating) || Number.isFinite(item.ratingsCount)],
    ["Installs", (item) => Boolean(item.installRange) || Number.isFinite(item.minInstalls) || Number.isFinite(item.maxInstalls)],
    ["App pricing", (item) => item.free !== undefined || Boolean(item.priceText) || Number.isFinite(item.price)],
    ["Monetization", (item) => item.offersIAP !== undefined || item.adSupported !== undefined || Boolean(item.iapRange)],
    ["Lifecycle", (item) => Boolean(item.released) || Boolean(item.updatedAt) || Boolean(item.version)],
    ["Compatibility", (item) => Boolean(item.minimumOsVersion) || Boolean(item.contentRating) || Number.isFinite(item.fileSizeBytes)]
  ];
  nodes.metadataCoverageChart.replaceChildren();
  for (const [name, predicate] of dimensions) {
    const count = records.filter(predicate).length;
    nodes.metadataCoverageChart.append(chartRow(name, count, records.length, `${count.toLocaleString("en")} · ${percent(count, records.length)}`));
  }

  const categories = groupedDistinctCounts(records, (record) => record.storeCategories ?? []).slice(0, 10);
  nodes.categoriesChart.replaceChildren();
  for (const item of categories) {
    nodes.categoriesChart.append(chartRow(item.name, item.count, categories[0]?.count ?? 0, item.count.toLocaleString("en")));
  }

  const topDevelopers = groupedDistinctCounts(records, (record) => record.developer ? [record.developer] : []).slice(0, 10);
  nodes.developersChart.replaceChildren();
  for (const item of topDevelopers) {
    nodes.developersChart.append(chartRow(item.name, item.count, topDevelopers[0]?.count ?? 0, item.count.toLocaleString("en")));
  }

  const markets = new Map();
  for (const item of records) {
    if (!markets.has(item.market)) markets.set(item.market, { apple: 0, googlePlay: 0 });
    const counts = markets.get(item.market);
    if (item.store === "apple") counts.apple += 1;
    if (item.store === "google-play") counts.googlePlay += 1;
  }
  const marketRows = [...markets.entries()].sort(([left], [right]) => left.localeCompare(right));
  const maximumMarketCount = Math.max(0, ...marketRows.flatMap(([, counts]) => [counts.apple, counts.googlePlay]));
  nodes.marketCatalogChart.replaceChildren();
  for (const [market, counts] of marketRows) {
    nodes.marketCatalogChart.append(marketChartColumn(market, counts, maximumMarketCount));
  }
}

function render(dataset) {
  const options = targetOptions(buildHistories(dataset.runs));
  const coveredMarkets = new Set(dataset.capabilities.capabilities.flatMap((item) => item.markets));
  text(nodes.runs, String(dataset.runs.length));
  text(nodes.targets, String(options.length));
  text(nodes.capabilities, String(dataset.capabilities.capabilities.length));
  text(nodes.root, String(coveredMarkets.size));
  renderCatalog(Object.values(dataset.catalog));

  nodes.capabilityBody.replaceChildren();
  for (const capability of dataset.capabilities.capabilities) {
    const available = capability.status !== "unsupported";
    const row = appendRow(
      nodes.capabilityBody,
      [storeLabel(capability.store), scopeLabel(capability.scope), chartLabel(capability.chart), capability.markets.length ? capability.markets.map((market) => marketLabel(market, { compact: true })).join(", ") : "—", available ? "Available" : "Unavailable", available ? `${capability.markets.length} markets covered` : "This chart is not currently available"],
      ["Store", "Category", "Chart", "Markets", "Availability", "Notes"]
    );
    row.children[4].className = "availability-cell";
    row.children[4].dataset.status = capability.status;
  }

  nodes.runsBody.replaceChildren();
  for (const run of dataset.runs.slice(0, 12)) {
    const counts = statusCounts(run);
    appendRow(
      nodes.runsBody,
      [run.runId, formatTime(run.startedAt), String(counts.valid ?? 0), String(counts.partial ?? 0), String(counts.failed ?? 0)],
      ["Update", "Started", "Complete", "Partial", "Unavailable"],
      ["mono"]
    );
  }
}

bindChrome(() => {
  if (currentDataset) render(currentDataset);
});

try {
  currentDataset = await loadDataset();
  render(currentDataset);
} catch (error) {
  text(nodes.root, error instanceof Error ? error.message : String(error));
}
