/**
 * Generates two Postgres artifacts from fsm.machine.schema.v3.json, so
 * neither has to be hand-copied out of sync with the schema:
 *
 * 1. ENUM type definitions for the schema's enum-valued fields
 *    (fsm_core.fsm_type/fsm_language/etc.).
 * 2. fsm_core.fsm_json_schema() — a SQL function returning the entire schema
 *    as JSON, with the file's contents embedded as the literal. Previously
 *    hand-copied directly into
 *    10_ext_helper/20241218134635_fsm_module_config.sql, where it drifted
 *    (still had the pre-rename fsmType enum values after they'd already
 *    changed in the real schema).
 *
 * ENUM_TARGETS below is deliberately NOT walked automatically — each target
 * is picked by hand, not derived mechanically from the schema tree, because:
 *
 * - $defs.baseStateNode.properties.type (atomic/compound/parallel/final/history)
 *   is skipped: it already exists as fsm_core.fsm_state_type (see
 *   supabase/schemas/11_ext_base/20241219134646_fsm_table.sql), live and
 *   wired into fsm_core.fsm_states.type and load_fsm_from_json_v2. Emitting
 *   a second CREATE TYPE for it here would collide when supabase applies the
 *   schema.
 * - $defs.actionObject's `if.properties.type.enum` (xstate.raise/xstate.cancel)
 *   is not a real field constraint — actionObject.type itself is a free-text
 *   string; that enum only gates an if/then conditional-required-fields
 *   branch, so generating a Postgres type from it would misrepresent the
 *   field's actual value domain.
 */
type EnumTarget = {
  /** JSON-pointer-style path into the schema, e.g. ["$defs", "invokeObject", "properties", "fsmType"]. */
  path: string[];
  /** Resulting type name, created as fsm_core.<typeName>. */
  typeName: string;
};

const ENUM_TARGETS: EnumTarget[] = [
  {
    path: ["$defs", "invokeObject", "properties", "fsmType"],
    typeName: "fsm_type",
  },
  {
    path: ["$defs", "invokeObject", "properties", "fsmLanguage"],
    typeName: "fsm_language",
  },
  {
    path: ["$defs", "historyStateNode", "allOf", "1", "properties", "history"],
    typeName: "fsm_history_type",
  },
  {
    path: ["properties", "type"],
    typeName: "fsm_root_type",
  },
];

function resolvePath(schema: unknown, path: string[]): string[] {
  // deno-lint-ignore no-explicit-any
  let node: any = schema;
  for (const key of path) {
    if (node == null || typeof node !== "object") {
      throw new Error(`Schema path ${path.join(".")} not found at "${key}"`);
    }
    node = node[key];
  }
  if (!node || typeof node !== "object" || !Array.isArray(node.enum)) {
    throw new Error(
      `Schema path ${path.join(".")} does not resolve to an enum field`,
    );
  }
  return node.enum as string[];
}

function toSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const schemaPath = new URL("../fsm.machine.schema.v3.json", import.meta.url);
const enumsOutPath = new URL(
  "../supabase/schemas/10_ext_helper/fsm_core_enums.generated.sql",
  import.meta.url,
);
const jsonSchemaFnOutPath = new URL(
  "../supabase/schemas/10_ext_helper/fsm_core_json_schema.generated.sql",
  import.meta.url,
);

const schemaText = await Deno.readTextFile(schemaPath);
const schema: unknown = JSON.parse(schemaText);

const statements = ENUM_TARGETS.map(({ path, typeName }) => {
  const values = resolvePath(schema, path);
  const literals = values.map(toSqlLiteral).join(", ");
  return `-- from $.${
    path.join(".")
  }\nCREATE TYPE fsm_core.${typeName} AS ENUM (${literals});`;
});

const enumsBanner = `-- AUTO-GENERATED — do not edit by hand.
-- Source: packages/database-src/fsm.machine.schema.v3.json
-- Regenerate with: deno task generate:pg-types (run from packages/database-src)
--
-- Deliberately excluded (see generate-fsm-json-postgres-types.ts for why):
--   $defs.baseStateNode.properties.type — already fsm_core.fsm_state_type
--     (supabase/schemas/11_ext_base/20241219134646_fsm_table.sql)
--   $defs.actionObject's if/then conditional enum — not a real field
--     constraint, actionObject.type is free text
`;

const enumsSql = enumsBanner + "\n" + statements.join("\n\n") + "\n";

await Deno.writeTextFile(enumsOutPath, enumsSql);
console.log(`Wrote ${enumsOutPath.pathname}`);

// Re-serialized (JSON.parse -> JSON.stringify) rather than the raw file
// text, so formatting is deterministic regardless of the source file's own
// whitespace, matching the enum statements' derived-not-copied approach
// above.
const jsonSchemaFnSql = `-- AUTO-GENERATED — do not edit by hand.
-- Source: packages/database-src/fsm.machine.schema.v3.json
-- Regenerate with: deno task generate:pg-types (run from packages/database-src)

CREATE OR REPLACE FUNCTION fsm_core.fsm_json_schema()
  RETURNS JSON LANGUAGE sql IMMUTABLE AS
  $$ SELECT ${toSqlLiteral(JSON.stringify(schema))}::json $$;
`;

await Deno.writeTextFile(jsonSchemaFnOutPath, jsonSchemaFnSql);
console.log(`Wrote ${jsonSchemaFnOutPath.pathname}`);
