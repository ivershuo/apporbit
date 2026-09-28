import { appendFile } from "node:fs/promises";

import { migrateProbes } from "../src/probe-migration.js";

const [source, output, sourceCommit] = process.argv.slice(2);
if (!source || !output || !sourceCommit || process.argv.length !== 5) {
  throw new Error("usage: pnpm data:migrate -- <source-v1> <new-output-v1> <source-commit>");
}
const report = await migrateProbes(source, output, sourceCommit);
console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Probe migration\n\nSource commit: ${sourceCommit}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`);
}
