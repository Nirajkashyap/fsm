# CLAUDE.md — Logging (`packages/fsm-logging-ts/`)

Scoped guidance for `@pgfsm/logging`. Repo-wide conventions and session protocol
live in the root `CLAUDE.md` / `AGENTS.md`. Full docs (rendering helpers, sink
internals, decision tables) are in this package's `README.md` — read it before
changing logging behavior.

## What it is

The single owner of logging config for the repo — wraps LogTape with one
process-wide configurator, a shared `CATEGORY` vocabulary (`api`, `worker`,
`db`, `compiler`, `fsmlet`), and a console sink that auto-renders
tables/objects.

## The golden rule

`configureLogging()` runs exactly once per process, at the entry point — calling
LogTape's `configure()` twice throws.

- **Apps/CLIs configure**: each composition root (API `deno.ts`/`logger.ts`,
  each worker CLI, the compiler CLI) resolves levels from its own validated env
  and calls `configureLogging()` once. See
  `apps/fsm-core-ts-hono-deno/CLAUDE.md`,
  `packages/fsm-sync-worker-ts/CLAUDE.md`, and
  `packages/fsm-async-worker-ts/CLAUDE.md` for the entry points that do this.
- **Libraries never configure**: they only `getLogger([CATEGORY.x, ...])` — e.g.
  `packages/fsm-core-db-ts/` only imports `CATEGORY`, never `configureLogging`.
- **Env is read at the composition root**, not here — this package takes
  explicit levels (dependency injection), never reads env itself.
