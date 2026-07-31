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
```

> There's no bare `supabase:restart:with:diff` script — always specify `patch` /
> `minor` / `major` (see `package.json` for the full script list, including
> `pgxnBuildAndPublish` for the pgxn extension release flow).

PostgreSQL is the source of truth for the schema — see
`packages/fsm-core-db-ts/CLAUDE.md` for the naming rules TypeScript wrappers
must follow, and `docs/reference/pg-ts-function-mapping.md` for the full PG→TS
mapping table.
