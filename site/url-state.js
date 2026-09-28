const chartDefaults = Object.freeze({
  store: "apple",
  market: "US",
  scope: "apps",
  chart: "top-free"
});

export function chartQueryParams(selection, { includeStore = false } = {}) {
  const query = new URLSearchParams();
  for (const [key, defaultValue] of Object.entries(chartDefaults)) {
    if (selection[key] && (selection[key] !== defaultValue || (includeStore && key === "store"))) query.set(key, selection[key]);
  }
  return query;
}

export function appDetailQueryParams(selection, appId) {
  const query = chartQueryParams(selection, { includeStore: Boolean(appId) });
  if (appId) query.set("id", appId);
  return query;
}
