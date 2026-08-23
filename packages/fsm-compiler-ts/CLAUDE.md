# CLAUDE.md — FSM Compiler (`packages/fsm-compiler-ts/`)

Scoped guidance for the JSON → database object compiler. Repo-wide conventions
and session protocol live in the root `CLAUDE.md` / `AGENTS.md`.

## Commands

```bash
deno task dev             # watch mode — src/cli/index.ts
deno task cli             # one-shot run — src/cli/index.ts
deno task test            # deno test --allow-all test/
deno task build:npm       # scripts/build-npm.ts (dnt npm build)
```

`src/types/index.ts` is this package's one types entry point. It holds every
hand-written type definition (`WorkflowType`, `ActorReference`,
`RegisteredActor`, `FsmDraftStateNode`, etc.) — not colocated with the functions
that use them — and also re-exports, by name (not a blanket `export type *`),
only the schema-derived types this package actually imports somewhere
(`FsmMachineJson`, `ActionObject`, `AtomicStateNode`, `CompoundStateNode`,
`FinalStateNode`, `HistoryStateNode`, `ParallelStateNode` as of this writing —
grep the package for the full current list). Those types actually live in
`packages/database-src/generated/fsm-machine-schema.types.ts` (regenerated from
`packages/database-src/`, not here — see that package's `CLAUDE.md` for
`generate:fsm-types`). When a file needs a schema type not yet in that list, add
it there rather than importing `database-src` directly — every other source file
imports both kinds of types from `./types/index.ts` (or `../types/index.ts` from
`src/cli/` and `src/scaffold-templates/`). Only genuinely file-private helper
types (unexported, single-use, e.g. `util.ts`'s `DenoCommandCtor`) stay where
they're defined.

Deno version is managed by `.prototools`: `proto install deno --pin local`.

## What it does

Compiles `fsm.json` definitions into the PostgreSQL objects that drive
instances. See `apps/fsm-core-example/CLAUDE.md` for the source FSM definition
format this compiler consumes. `README.md` is the npm/npx-consumer-facing
document (published to `dist/` — see below); keep source-only detail here
instead of there.

## npm publish (`deno task build:npm`)

`scripts/build-npm.ts` builds the npm package via `@deno/dnt`, not `deno pack`
(used for this repo's other npm-published packages). `deno pack` does not
synthesize a `package.json` `bin` field — per the Deno docs' "Limitations"
section (https://docs.deno.com/runtime/reference/cli/pack/), it's
library-publishing only, so a CLI packed that way would be unreachable from
`npx`. dnt transpiles + Node-shims the source into `dist/`, registering both the
library export and the shebanged `fsm-compiler` CLI bin.
`.github/workflows/npm-publish.yml` builds this package's `compiler` matrix
entry through the dnt path for that reason.

`postBuild()` only copies `README.md` into `dist/` when `--copy-readme` is
passed (`deno task build:npm <version> --copy-readme`, as CI does) — a plain
local `deno task build:npm` skips it.

dnt's Deno shim doesn't implement `Deno.Command` (unchecked in
[shim-deno's PROGRESS.md](https://github.com/denoland/node_shims/blob/main/packages/shim-deno/PROGRESS.md)),
so anything that shells out to a language runtime — actor validation
(`validate-async-operation`) and the best-effort `deno fmt` pass on generated TS
stubs — is unavailable in the npm/npx build. See `src/util.ts`'s `DenoCommand`
export and its callers in `src/validate-async-operation-logic.ts` and
`src/operation-logic-scaffold.ts`.

`src/types/index.ts`'s cross-package `import type`/`export type` reaching into
`../../../database-src/generated/` (see above) is type-only, so it never appears
in the emitted JS — but dnt's build still resolves and copies the source
`.ts`/emits a `.d.ts` for it into `dist/{esm,script}/database-src/generated/`,
self-contained inside the published package. Verified working as of this note;
if the build ever fails type-checking that file, that's the first place to look.
