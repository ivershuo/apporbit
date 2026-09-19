import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { schemaDocuments } from "../src/schema-documents.js";

const directory = path.resolve(process.cwd(), "schemas");
await mkdir(directory, { recursive: true });

for (const [fileName, schema] of Object.entries(schemaDocuments)) {
  await writeFile(path.join(directory, fileName), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}
