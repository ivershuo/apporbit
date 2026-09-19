import { COLLECTOR_VERSION } from "./version.js";

export function collectorUserAgent(): string {
  const repositoryUrl = process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
    : "https://github.com";
  const contactUrl = process.env.APPORBIT_CONTACT_URL ?? repositoryUrl;
  return `AppOrbit/${COLLECTOR_VERSION} (+${contactUrl})`;
}
