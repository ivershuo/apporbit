import { readFile } from "node:fs/promises";
import path from "node:path";

import { AdapterRegistry } from "./adapters/index.js";
import { loadTargets } from "./config.js";
import {
  CapabilitiesManifestSchema,
  ChartSchema,
  PublicationModeSchema,
  ScopeSchema,
  StoreSchema,
  TargetSchema,
  type Target
} from "./domain.js";
import type { RunTargetOutcome } from "./domain.js";
import { runCollection } from "./pipeline.js";
import { schemaDocuments } from "./schema-documents.js";
import { DataStore } from "./storage.js";

type Arguments = Record<string, string | boolean>;

function parseArguments(values: string[]): Arguments {
  const parsed: Arguments = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index]!;
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[name] = next;
      index += 1;
    } else {
      parsed[name] = true;
    }
  }
  return parsed;
}

function stringArgument(args: Arguments, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`--${name} requires a value`);
  return value;
}

function filterTargets(targets: Target[], args: Arguments): Target[] {
  const storeValue = stringArgument(args, "store");
  const marketValue = stringArgument(args, "market")?.toUpperCase();
  const markets = marketValue === undefined
    ? undefined
    : new Set(marketValue.split(",").map((value) => value.trim()).filter(Boolean));
  if (markets?.size === 0 || [...(markets ?? [])].some((market) => !/^[A-Z]{2}$/.test(market))) {
    throw new Error("--market must contain one or more comma-separated two-letter market codes");
  }
  const scopeValue = stringArgument(args, "scope");
  const chartValue = stringArgument(args, "chart");
  const modeValue = stringArgument(args, "publication-mode");
  const expectedCountValue = stringArgument(args, "expected-count");
  const limitValue = stringArgument(args, "limit");
  const store = storeValue ? StoreSchema.parse(storeValue) : undefined;
  const scope = scopeValue ? ScopeSchema.parse(scopeValue) : undefined;
  const chart = chartValue ? ChartSchema.parse(chartValue) : undefined;
  const mode = modeValue ? PublicationModeSchema.parse(modeValue) : undefined;
  const expectedCount = expectedCountValue ? Number(expectedCountValue) : undefined;
  const limit = limitValue ? Number(limitValue) : undefined;
  if (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount < 1)) {
    throw new Error("--expected-count must be a positive integer");
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  const filtered = targets
    .filter((target) => store === undefined || target.store === store)
    .filter((target) => markets === undefined || markets.has(target.market))
    .filter((target) => scope === undefined || target.scope === scope)
    .filter((target) => chart === undefined || target.chart === chart)
    .map((target) =>
      TargetSchema.parse({
        ...target,
        ...(mode === undefined ? {} : { publicationMode: mode }),
        ...(expectedCount === undefined ? {} : { expectedCount })
      })
    );
  return limit === undefined ? filtered : filtered.slice(0, limit);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function schemaCheck(cwd: string): Promise<void> {
  await loadTargets(path.join(cwd, "config/targets.json"));
  CapabilitiesManifestSchema.parse(
    await readJson(path.join(cwd, "config/capabilities.json"))
  );

  for (const [fileName, expected] of Object.entries(schemaDocuments)) {
    const actual = await readJson(path.join(cwd, "schemas", fileName));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`schemas/${fileName} is stale; regenerate it from the Zod schema`);
    }
  }
  console.log("Configuration and public JSON Schemas are in sync.");
}

async function collect(cwd: string, args: Arguments): Promise<void> {
  const configPath = path.resolve(cwd, stringArgument(args, "config") ?? "config/targets.json");
  const capabilitiesPath = path.resolve(
    cwd,
    stringArgument(args, "capabilities") ?? "config/capabilities.json"
  );
  const outputRoot = path.resolve(cwd, stringArgument(args, "output") ?? ".local-data/v1");
  const targets = filterTargets(await loadTargets(configPath), args);
  if (targets.length === 0) throw new Error("target filters matched no configured targets");

  const capabilities = CapabilitiesManifestSchema.parse(await readJson(capabilitiesPath));
  const store = new DataStore(outputRoot);
  await store.writeMutableJson("capabilities.json", capabilities);
  for (const [fileName, schema] of Object.entries(schemaDocuments)) {
    await store.writeMutableJson(`schemas/${fileName}`, schema);
  }

  console.log(`Collecting ${targets.length} targets into ${outputRoot}`);
  
  const result = await runCollection({
    outputRoot,
    targets,
    registry: new AdapterRegistry(),
    onTargetComplete: reportTargetOutcome
  });
  const counts = Object.groupBy(result.manifest.targets, (outcome) => outcome.status);
  const failedTargets = result.manifest.targets
    .filter((outcome) => outcome.status === "failed")
    .map((outcome) => ({
      target: targetLabel(outcome),
      attempts: outcome.attempts,
      error: outcome.error,
      flags: outcome.flags
    }));
  const partialTargets = result.manifest.targets
    .filter((outcome) => outcome.status === "partial")
    .map((outcome) => ({
      target: targetLabel(outcome),
      attempts: outcome.attempts,
      snapshotPath: outcome.snapshotPath,
      flags: outcome.flags
    }));
  console.log(
    JSON.stringify(
      {
        runId: result.manifest.runId,
        manifestPath: result.manifestPath,
        startedAt: result.manifest.startedAt,
        finishedAt: result.manifest.finishedAt,
        durationSeconds: durationSeconds(result.manifest.startedAt, result.manifest.finishedAt),
        outcomes: Object.fromEntries(
          Object.entries(counts).map(([status, items]) => [status, items?.length ?? 0])
        ),
        failedTargets,
        partialTargets
      },
      null,
      2
    )
  );
  if (args["fail-on-any-error"] === true && result.manifest.targets.some((item) => item.status === "failed")) {
    process.exitCode = 1;
  }
}

function targetLabel(outcome: RunTargetOutcome): string {
  const { target } = outcome;
  return `${target.store}/${target.market}/${target.scope}/${target.chart}`;
}

function durationSeconds(startedAt: string, finishedAt: string): number {
  return Math.max(0, (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000);
}

function reportTargetOutcome(outcome: RunTargetOutcome): void {
  const duration = durationSeconds(outcome.startedAt, outcome.finishedAt).toFixed(1);
  const details = [
    `target=${targetLabel(outcome)}`,
    `status=${outcome.status}`,
    `attempts=${outcome.attempts}`,
    `duration=${duration}s`,
    `snapshot=${outcome.snapshotPath ?? "none"}`
  ];
  if (outcome.flags.length > 0) details.push(`flags=${outcome.flags.join(",")}`);

  const line = `[collect] ${details.join(" ")}`;
  if (outcome.status === "failed") {
    console.error(line);
    console.error(`  error.kind=${outcome.error?.kind ?? "unknown"}`);
    console.error(`  error.message=${outcome.error?.message ?? "unknown"}`);
    return;
  }
  if (outcome.status === "partial") {
    console.warn(line);
    return;
  }
  console.log(line);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArguments(rest);
  const cwd = process.cwd();
  if (command === "collect") {
    await collect(cwd, args);
    return;
  }
  if (command === "schema-check") {
    await schemaCheck(cwd);
    return;
  }
  throw new Error("usage: pnpm collect -- [options] | pnpm schema:check");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
