# CLAUDE.md — Proto Codegen (`packages/fsm-proto-codegen/`)

Scoped guidance for `@pgfsm/proto-codegen`. Repo-wide conventions and session
protocol live in the root `CLAUDE.md` / `AGENTS.md`. Full docs (why this exists,
the plugin table, per-language gotchas) are in this package's `README.md` — read
it before touching `buf.gen.yaml` or regenerating.

## Commands

```bash
cd packages/fsm-proto-codegen
deno task generate                   # = buf generate
```

Requires the `buf` CLI on `PATH` (not proto-pinned — see README).

## What it does

Runs every `.proto` file under `packages/fsm-core-async-op-worker/src/proto/`
(the Activity Gateway's client-facing `activity_gateway.proto` and worker-facing
`sidecar_gateway.proto`) through Buf's plugin pipeline to produce stubs for all
four polyglot actor languages (TypeScript, Python, Rust, Go), committed under
`gen/`. Owns codegen _config_ only — the `.proto` sources and their shared
`buf.yaml` module config live with the gateway package that owns the contracts,
not here.

Deno-only — no `package.json`/`node_modules`. `buf.gen.yaml`'s TypeScript
plugins (`protoc-gen-es`, `protoc-gen-connect-es`) run via
`deno run npm:<pkg>@<pinned-version>/` directly, so their pinned versions
resolve through Deno's npm-specifier support with no separate install step.
Nothing in this package is imported by app code.
