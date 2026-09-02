# CLAUDE.md — Database (`packages/database-src/`)

Scoped guidance for PostgreSQL migrations + Supabase config. Repo-wide
conventions and session protocol live in the root `CLAUDE.md` / `AGENTS.md`.

## Commands

```bash
npm run supabase:start              # start local Supabase
npm run supabase:db:reset           # reset and re-run all migrations
npm run supabase:gen:types          # regenerate TypeScript types

# restart, diff schema, and regenerate types — pick the version bump:
npm run supabase:restart:with:diff:withUpgradeScript:patch
npm run supabase:restart:with:diff:withUpgradeScript:minor
npm run supabase:restart:with:diff:withUpgradeScript:major

# regenerate fsm-compiler-ts's FsmMachineJson type from fsm.machine.schema.v3.json
npm run generate:fsm-types          # (or: deno task generate:fsm-types)

# regenerate the Postgres ENUM types derived from fsm.machine.schema.v3.json
npm run generate:pg-types           # (or: deno task generate:pg-types)
```

> There's no bare `supabase:restart:with:diff` script — always specify `patch` /
> `minor` / `major` (see `package.json` for the full script list, including
> `pgxnBuildAndPublish` for the pgxn extension release flow).

All `supabase:*` scripts accept a `SUPABASE_WORKDIR` env var (default `.`) that
they forward to the Supabase CLI's `--workdir` flag — this is what lets the same
scripts drive either of the two Supabase projects below without duplicating
script definitions.

```bash
# same commands, run against full-ext/supabase/ instead of supabase/
SUPABASE_WORKDIR=full-ext npm run supabase:start:env
SUPABASE_WORKDIR=full-ext npm run supabase:restart:with:diff:withUpgradeScript:patch
```

## Two local Supabase projects

- `supabase/` — the main project (`SUPABASE_WORKDIR` unset/`.`), backing the API
  and everything else in this repo.
- `full-ext/supabase/` — a second, parallel project for driving
  `database-src-extension` (the pgrx build) against a full local stack.

The Supabase CLI only ever reads `<workdir>/supabase/config.toml` — the
subfolder must be literally named `supabase` and the file literally
`config.toml`; there's no flag to point it at an arbitrarily named file. That's
why `full-ext/` nests its own `supabase/` folder rather than living flat as
`full-ext.config.toml` or similar. The two configs intentionally share the same
`project_id` and ports, so they're mutually exclusive, not concurrent — `stop`
one (with the matching `SUPABASE_WORKDIR`) before `start`ing the other.

## PGXN release build (`pgxn-build-and-publish.ts`)

```bash
npm run pgxnBuildAndPublish -- --version 2.0.2                 # stage + zip, keep pgxn-dist for inspection
npm run pgxnBuildAndPublish -- --version 2.0.2 --clean          # stage + zip, then remove pgxn-dist
npm run pgxnBuildAndPublish -- --version 2.0.2 -u USER -p PASS  # also upload to PGXN
```

`--version` (`-v`) is required and drives the whole build, independent of
`package.json`'s own version. It errors if `supabase/migrations/` has no
migration file for that exact version, then stages the full chain up to and
including it into `pgxn-dist/`. If `full-ext/supabase/migrations/` has a file
for that same version, it overrides the `supabase/migrations/` copy of that one
file — full-ext's is the pgrx-validated SQL, authoritative for a release (see
[Two local Supabase projects](#two-local-supabase-projects) above for why that
directory exists).

`pgxn-dist/` is gitignored — it's build staging, not tracked output. `--clean`
(`-c`, default off) removes it after the zip is built; leave it off to inspect
what actually shipped.

`generate:fsm-types` (`scripts/generate-fsm-json-types.ts`) reads
`fsm.machine.schema.v3.json` and writes `generated/fsm-machine-schema.types.ts`
— `fsm-compiler-ts` imports it from there via a cross-package relative path (see
its `CLAUDE.md`). Run it after any change to the schema's
`asyncOperationType`/invoke shape. The npm script just delegates to the deno
task (`deno task generate:fsm-types`); both work identically since `deno` is
proto-pinned at the repo root and resolves here via upward file resolution.

`generated/database.types.ts` (Supabase-generated, via `supabase:gen:types` /
`supabase:restart:with:diff:...`) lives in the same directory —
`packages/fsm-core-db-ts/src/database.types.ts` imports the `Database`/`Json`
types from it via a relative path and re-exports them as
`@pgfsm/db/database.types` for every other package.

`generate:pg-types` (`scripts/generate-fsm-json-postgres-types.ts`) reads the
same schema and writes two generated files:

- `supabase/schemas/10_ext_helper/fsm_core_enums.generated.sql` —
  `CREATE TYPE ... AS ENUM (...)` statements, one per enum-valued schema field,
  **except** two deliberately skipped (documented in the script itself): the
  state-node `type` enum, which already exists as `fsm_core.fsm_state_type`
  (`supabase/schemas/11_ext_base/20241219134646_fsm_table.sql`), and
  `actionObject`'s `if`/`then` conditional enum, which isn't a real field
  constraint. The enum-to-type-name mapping is a small hand-picked list in the
  script, not derived automatically — good Postgres type names don't fall out of
  JSON-schema paths mechanically. These generated types aren't wired into any
  existing function signature yet (those still take `text`); that's a separate,
  larger follow-up.
- `supabase/schemas/10_ext_helper/fsm_core_json_schema.generated.sql` —
  `fsm_core.fsm_json_schema()`, a SQL function returning the entire schema as
  JSON, with the file's contents embedded as the literal (re-serialized via
  `JSON.parse`/`JSON.stringify`, not the raw file bytes). Replaces a hand-copied
  version that used to live directly in
  `10_ext_helper/20241218134635_fsm_module_config.sql` and had drifted out of
  sync with the real schema.

PostgreSQL is the source of truth for the schema — see
`packages/fsm-core-db-ts/CLAUDE.md` for the naming rules TypeScript wrappers
must follow, and `docs/reference/pg-ts-function-mapping.md` for the full PG→TS
mapping table.
