import { z } from "zod";

import { RunManifestSchema, SnapshotSchema } from "./domain.js";

function document(id: string, schema: z.ZodType): object {
  return {
    $id: id,
    ...z.toJSONSchema(schema, { target: "draft-7", io: "output" })
  };
}

export const schemaDocuments = {
  "snapshot-v1.schema.json": document(
    "urn:apporbit:schema:snapshot:v1",
    SnapshotSchema
  ),
  "run-v1.schema.json": document(
    "urn:apporbit:schema:run:v1",
    RunManifestSchema
  )
} as const;
