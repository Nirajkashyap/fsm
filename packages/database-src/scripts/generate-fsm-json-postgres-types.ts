/**
 * Generates Postgres ENUM type definitions from fsm.machine.schema.v3.json's
 * enum-valued fields, so fsm_core.fsm_type/fsm_language/etc. stay in sync with
 * the schema instead of being hand-copied.
 *
 * Deliberately NOT walked automatically — each target below is picked by
 * hand, not derived mechanically from the schema tree, because:
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
const outPath = new URL(
  "../supabase/schemas/10_ext_helper/fsm_core_enums.generated.sql",
  import.meta.url,
);

const schema: unknown = JSON.parse(await Deno.readTextFile(schemaPath));

const statements = ENUM_TARGETS.map(({ path, typeName }) => {
  const values = resolvePath(schema, path);
  const literals = values.map(toSqlLiteral).join(", ");
  return `-- from $.${
    path.join(".")
  }\nCREATE TYPE fsm_core.${typeName} AS ENUM (${literals});`;
});

const banner = `-- AUTO-GENERATED — do not edit by hand.
-- Source: packages/database-src/fsm.machine.schema.v3.json
-- Regenerate with: deno task generate:pg-types (run from packages/database-src)
--
-- Deliberately excluded (see generate-fsm-json-postgres-types.ts for why):
--   $defs.baseStateNode.properties.type — already fsm_core.fsm_state_type
--     (supabase/schemas/11_ext_base/20241219134646_fsm_table.sql)
--   $defs.actionObject's if/then conditional enum — not a real field
--     constraint, actionObject.type is free text
`;

const sql = banner + "\n" + statements.join("\n\n") + "\n";

await Deno.writeTextFile(outPath, sql);

console.log(`Wrote ${outPath.pathname}`);
