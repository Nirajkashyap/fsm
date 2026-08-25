import { compile } from "json-schema-to-typescript";

const schemaPath = new URL("../fsm.machine.schema.v3.json", import.meta.url);
const outPath = new URL(
  "../generated/fsm-machine-schema.types.ts",
  import.meta.url,
);

const schema = JSON.parse(await Deno.readTextFile(schemaPath));

const ts = await compile(schema, "FsmMachineJson", {
  additionalProperties: false,
  bannerComment:
    "/**\n * AUTO-GENERATED — do not edit by hand.\n * Source: packages/database-src/fsm.machine.schema.v3.json\n * Regenerate with: deno task generate:fsm-types (run from packages/database-src)\n */",
});

await Deno.mkdir(
  new URL("../generated", import.meta.url),
  { recursive: true },
);
await Deno.writeTextFile(outPath, ts);

console.log(`Wrote ${outPath.pathname}`);
