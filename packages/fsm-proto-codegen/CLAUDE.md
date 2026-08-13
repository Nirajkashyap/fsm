# CLAUDE.md — Proto Codegen (`packages/fsm-proto-codegen/`)

Scoped guidance for `@pgfsm/proto-codegen-plugins`. Repo-wide conventions and
session protocol live in the root `CLAUDE.md` / `AGENTS.md`. Full docs (why this
exists, the plugin table, per-language gotchas) are in this package's
`README.md` — read it before touching `buf.gen.yaml` or regenerating.

## Commands

```bash
cd packages/fsm-proto-codegen
npm install                          # once, or after a plugin version bump
deno task generate                   # buf generate, with node_modules/.bin on PATH
```

Requires the `buf` CLI on `PATH` (not proto-pinned — see README).

## What it does

Owns both the `.proto` contract sources (one directory per defining service
under `proto/<service>/`, each its own independent Buf module — see README's
Layout section) and the codegen config that runs every one of them through Buf's
plugin pipeline to produce stubs for all four polyglot actor languages
(TypeScript, Python, Rust, Go), committed under `gen/`. Today that's
`proto/fsm-core-async-op-worker/` — the Activity Gateway's client-facing
`activity_gateway.proto` and worker-facing `sidecar_gateway.proto`.

`package.json` / `node_modules/` here are not app dependencies — just the
`protoc-gen-es` / `protoc-gen-connect-es` binaries `buf generate` needs on
`PATH` for TypeScript output. Nothing in this package is imported by app code.
