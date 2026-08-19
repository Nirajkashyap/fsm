# CLAUDE.md — API Server (`apps/fsm-core-ts-hono-deno/`)

Scoped guidance for the Hono + Deno REST API. Repo-wide conventions and session
protocol live in the root `CLAUDE.md` / `AGENTS.md`.

## Commands

```bash
deno run --allow-all --env-file=./../../.env --watch deno.ts   # dev server (port from env, default 9999)
deno test                                                        # run tests
```

> `deno.json`'s `start`/`cli` tasks point at `main.ts` / `src/cli/index.ts` —
> `main.ts` doesn't exist in this tree, so `deno task start` fails. Run
> `deno.ts` directly (shown above) until that task is fixed.

## Structure

- `app.ts` — Hono router composition, DB pool wiring
- `deno.ts` — Deno entry point; configures LogTape before `app.ts` loads (must
  happen first — `app.ts` emits logs at module load time)
- `node.ts` — Node entry point (HTTP/2, separate from the Deno path)
- `seconddeno.ts` — second server instance on `PORT + 1`, used to test
  advisory-lock / `lock_workflow_instance` behavior under concurrent access
- `env.ts` — Zod-validated environment config (`DB_TYPE`, `PORT`, `LOG_LEVEL*`,
  `OTEL_*`, etc.)
- `logger.ts` — composition-root LogTape configuration for this process
  (`configureApiLogger()`), via `@pgfsm/logging`
- `lib/create-app.ts` — app factory with middleware (logging, request IDs, CORS,
  OTel tracing)
- `lib/configure-open-api.ts` — OpenAPI/Scalar docs setup (available at `/docs`)
- `lib/constants.ts`, `lib/types.ts` — shared app-level constants/types
- `middlewares/logtape-logger.ts` — HTTP access logging via `@logtape/hono`
- `middlewares/otel-trace.ts` — OpenTelemetry span per request (enabled via
  `OTEL_DENO`)
- `middlewares/pino-logger.ts` — legacy Pino logger; commented out in
  `create-app.ts`, superseded by `logtape-logger.ts`
- `middlewares/supabase.ts` — Supabase client middleware
- `routes/fsm/` — core FSM operations: list, create, send
- `src/cli/index.ts` — CLI entry for the API's own control commands
- `stoker-src/` — OpenAPI helper utilities

## Key Dependencies

- **Hono** with `@hono/zod-openapi` — REST framework + type-safe routes
- **Zod** — runtime validation
- **LogTape** (`@logtape/logtape`, `@logtape/hono`, `@logtape/otel`) via
  `@pgfsm/logging` — structured logging (see
  `packages/fsm-logging-ts/CLAUDE.md`)
- **OpenTelemetry** (`@opentelemetry/api`) — request tracing, opt-in via
  `OTEL_DENO`

## Environment Variables (`DB_TYPE` is key)

- `"postgres"` — direct PostgreSQL connection
- `"supabase"` — Supabase JS client
- `"supabase_and_postgres"` — both clients available

See `env.ts` for the full Zod schema (`PORT`, `LOG_LEVEL` + per-category
overrides, `OTEL_*`, `CORS_ORIGIN`, etc.).
