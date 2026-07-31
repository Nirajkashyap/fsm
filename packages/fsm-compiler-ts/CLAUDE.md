# CLAUDE.md — FSM Compiler (`packages/fsm-compiler-ts/`)

Scoped guidance for the JSON → database object compiler. Repo-wide conventions
and session protocol live in the root `CLAUDE.md` / `AGENTS.md`.

## Commands

```bash
deno task dev             # watch mode — src/cli/index.ts
deno task cli             # one-shot run — src/cli/index.ts
deno task test            # deno test --allow-all test/
deno task generate:fsm-types  # scripts/generate-fsm-json-types.ts
deno task build:npm       # scripts/build-npm.ts (dnt npm build)
```

## What it does

Compiles `fsm.json` definitions into the PostgreSQL objects that drive
instances. See `apps/fsm-core-example/CLAUDE.md` for the source FSM definition
format this compiler consumes.
