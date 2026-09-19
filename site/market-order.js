// Product priority based on the relative scale of AppOrbit's supported app markets.
// Markets not listed here remain supported and sort alphabetically after known markets.
export const MARKET_SCALE_ORDER = Object.freeze([
  "US",
  "CN",
  "JP",
  "KR",
  "GB",
  "DE",
  "BR",
  "IN",
  "ID",
  "VN"
]);

const marketScaleRank = new Map(MARKET_SCALE_ORDER.map((market, index) => [market, index]));

export function compareMarketsByScale(left, right) {
  const leftCode = String(left).toUpperCase();
  const rightCode = String(right).toUpperCase();
  const leftRank = marketScaleRank.get(leftCode) ?? Number.MAX_SAFE_INTEGER;
  const rightRank = marketScaleRank.get(rightCode) ?? Number.MAX_SAFE_INTEGER;
  return leftRank - rightRank || leftCode.localeCompare(rightCode);
}

export function marketsByScale(values) {
  return [...new Set(values.filter(Boolean))].sort(compareMarketsByScale);
}
