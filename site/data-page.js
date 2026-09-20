import { bindChrome, chartLabel, element, formatTime, loadDataset, loadStats, marketLabel, scopeLabel, storeLabel, text } from "./shared.js";
import { compareMarketsByScale } from "./market-order.js";

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

function renderCatalog(stats) {
  text(nodes.catalog, stats.records.toLocaleString("en"));
  text(nodes.apps, stats.apps.toLocaleString("en"));
  text(nodes.developers, stats.developers.toLocaleString("en"));
  text(nodes.latestMetadata, stats.latestObserved ? formatTime(stats.latestObserved) : "—");

  nodes.metadataCoverageChart.replaceChildren();
  for (const item of stats.dimensions) {
    nodes.metadataCoverageChart.append(chartRow(item.name, item.count, stats.records, `${item.count.toLocaleString("en")} · ${percent(item.count, stats.records)}`));
  }

  nodes.categoriesChart.replaceChildren();
  for (const item of stats.categories) {
    nodes.categoriesChart.append(chartRow(item.name, item.count, stats.categories[0]?.count ?? 0, item.count.toLocaleString("en")));
  }

  nodes.developersChart.replaceChildren();
  for (const item of stats.topDevelopers) {
    nodes.developersChart.append(chartRow(item.name, item.count, stats.topDevelopers[0]?.count ?? 0, item.count.toLocaleString("en")));
  }

  const marketRows = [...stats.markets]
    .sort((left, right) => compareMarketsByScale(left.market, right.market));
  const maximumMarketCount = Math.max(0, ...marketRows.flatMap((item) => [item.apple, item.googlePlay]));
  nodes.marketCatalogChart.replaceChildren();
  for (const item of marketRows) {
    nodes.marketCatalogChart.append(marketChartColumn(item.market, item, maximumMarketCount));
  }
}

function render(dataset, stats) {
  const targetCount = new Set(dataset.runs.flatMap((run) =>
    run.targets.map((outcome) => outcome.targetKey)
  )).size;
  const coveredMarkets = new Set(dataset.capabilities.capabilities.flatMap((item) => item.markets));
  text(nodes.runs, String(dataset.runs.length));
  text(nodes.targets, String(targetCount));
  text(nodes.capabilities, String(dataset.capabilities.capabilities.length));
  text(nodes.root, String(coveredMarkets.size));
  renderCatalog(stats.catalog);

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
  if (currentDataset) render(currentDataset.dataset, currentDataset.stats);
});

try {
  const [dataset, stats] = await Promise.all([loadDataset(), loadStats()]);
  currentDataset = { dataset, stats };
  render(dataset, stats);
} catch (error) {
  text(nodes.root, error instanceof Error ? error.message : String(error));
}
