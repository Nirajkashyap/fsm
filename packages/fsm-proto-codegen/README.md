# @pgfsm/proto-codegen

Buf-driven `.proto` → multi-language stub generation for this repo's four
polyglot actor languages (TypeScript, Python, Rust, Go). Owns codegen _config_
only — it does not own any `.proto` source file itself.

## Why this exists

`packages/fsm-core-async-op-worker/src/proto/pgfsm/activitygateway/v1/activity_gateway.proto`
(the Activity Gateway's client-facing gRPC contract) had no generated stubs at
all: TypeScript used `@grpc/proto-loader` at runtime (schema reflection, no
codegen), and there was no Python/Rust/Go client or server code for it. Rather
than hand-writing or hand-porting stubs per language the way the old
`fsm-core-async-op-worker/src/worker-sdk/` once was, this package runs one
`.proto` file through [Buf](https://buf.build)'s plugin pipeline for all four
languages from a single `buf generate` command.

Wiring the generated stubs into the actual gateway/worker code (replacing
`@grpc/proto-loader` etc.) is deliberately **not** part of this package — see
[#86](https://github.com/pgfsm/fsm/issues/86). This package only proves the
codegen pipeline works and produces correct, runnable output.

## Layout

- `packages/fsm-core-async-op-worker/src/proto/buf.yaml` — the proto _module_
  config (lint/breaking-change rules). Lives next to the `.proto` files it
  governs, not in this package — Buf modules are rooted where their source
  lives, and the gateway package still owns those contracts.
- `buf.gen.yaml` (this package) — the codegen _plugin_ config: which plugins
  run, in which language, writing where. Points at the module above via
  `inputs: - directory: ../fsm-core-async-op-worker/src/proto` instead of
  requiring a `buf.yaml` in this package.
- `gen/{typescript,python,rust,go}/` — generated output, committed (same
  convention as `apps/fsm-core-example/worker-sdk-generated/`) so consumers
  don't need Buf installed just to build against it.

## Regenerating

```sh
cd packages/fsm-proto-codegen
deno task generate                   # = buf generate
```

Requires the `buf` CLI (`brew install bufbuild/buf/buf`, or see
[buf.build/docs/installation](https://buf.build/docs/installation)); not pinned
via this repo's `.prototools` since `proto` (moonrepo) has no buf plugin. No
`npm install` step: the two TypeScript plugins run via
`deno run npm:<pkg>@<pinned-version>/` directly from `buf.gen.yaml` (see below)
— there's no `package.json` or `node_modules/` in this package.

## Plugins, per language

Everything below is a **remote** BSR plugin (`buf.build/<owner>/<plugin>`, no
local install needed) _except_ TypeScript's two — see why in the "Local, not
remote" comment in `buf.gen.yaml`.

| Language   | Plugins                                                                            | Runtime deps a consumer needs                                                              |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TypeScript | `protoc-gen-es` 1.10.1, `protoc-gen-connect-es` 1.7.0 (local, via `deno run npm:`) | `@bufbuild/protobuf@^1`                                                                    |
| Python     | `buf.build/protocolbuffers/{python,pyi}`, `buf.build/grpc/python`                  | `grpcio`, `protobuf`                                                                       |
| Rust       | `buf.build/community/neoeinstein-{prost,tonic}`                                    | `prost@^0.14`, `tonic@^0.14`, `tonic-prost@^0.14` (must all be the same major — see below) |
| Go         | `buf.build/protocolbuffers/go`, `buf.build/grpc/go`                                | `google.golang.org/protobuf`, `google.golang.org/grpc`                                     |

### TypeScript: why local, not remote plugins

BSR's remote `connect-es` plugin (tried under both `buf.build/bufbuild/es` and
`buf.build/connectrpc/es`) is stuck on old releases (`v0.13.0`, `v1.6.1`) that
predate protobuf-es v2's output shape. Pairing either with the remote
`bufbuild/es` plugin (which resolves to v2.13.0, the current release) produces a
`_connect.js` that imports message names (`Empty`, `InvokeRequest`, ...) as
values — but the v2 message file only exports them as **types** (`*Schema`
consts carry the runtime value instead). TypeScript hides this, since type-only
imports get erased at compile time, but running the generated JS directly (Deno,
Node) throws `SyntaxError: ... does not
provide an export named 'Empty'`. Caught
by actually running the generated output, not just type-checking it.

`protoc-gen-es` and `protoc-gen-connect-es` haven't published a mutually
compatible v2 pair yet, so both are pinned in `buf.gen.yaml` to the last version
pair that _is_ compatible (v1.10.1 / v1.7.0), each invoked as
`local: ["deno", "run", ..., "npm:<pkg>@<version>/"]` — Buf's `local:` field
accepts an argv array, not just a PATH-resolved binary name, so the plugin runs
straight off Deno's npm-specifier resolution with no separate install step and
exactly the pinned version, rather than whatever BSR resolves "latest" to. Same
pattern as bufbuild's own
[Deno example](https://github.com/bufbuild/protobuf-es/blob/main/deno/example/buf.gen.yaml).

### Rust: prost/tonic/tonic-prost must share a major version

`tonic` 0.14 moved its prost-backed codec into a separate `tonic-prost` crate; a
consumer's `Cargo.toml` needs `prost`, `tonic`, and `tonic-prost` all on `^0.14`
(or all on some other later matching triple) — mixing e.g. `prost 0.13` with
`tonic-prost 0.14` fails to compile with a "two different versions of crate
`prost`" trait-mismatch error, since `tonic-prost` pulls its own transitive
`prost`. Consuming code should also only
`include!("pgfsm.activitygateway.v1.rs")` (or `pgfsm.sidecargateway.v1.rs`) for
a language's package module — the generated message file already contains its
own `include!("pgfsm.activitygateway.v1.tonic.rs")` at the bottom, so including
both files separately double-defines the client/server modules.

### Go: `module=` output option

`buf.gen.yaml`'s Go plugins pass `opt: module=.../gen/go` instead of the more
common `paths=source_relative`. With `source_relative`, output mirrors each
`.proto` file's own path relative to the module root — for
`pgfsm/activitygateway/v1/activity_gateway.proto`, that would land at
`gen/go/pgfsm/activitygateway/v1/`, carrying the `pgfsm/` segment from the proto
package's directory structure into the Go import path even though neither
`go_package` option asks for it. `module=` instead derives the output path from
each file's own `go_package` option relative to that module prefix, landing
Activity Gateway's stubs at `gen/go/activitygateway/v1/` and the sidecar's at
`gen/go/sidecargateway/v1/` — idiomatic Go layout, one directory per Go package,
independent of how the `.proto` files themselves are nested.

## Verifying a regen

Each language was confirmed to actually build/run against its generated output,
not just parse:

- **Go**: `go build` in an isolated module requiring
  `google.golang.org/protobuf` + `google.golang.org/grpc`.
- **Python**: `grpcio`/`protobuf` installed, then the `_pb2`/`_pb2_grpc` modules
  imported and a message actually instantiated.
- **Rust**: `cargo build` against `prost`/`tonic`/`tonic-prost` `^0.14`.
- **TypeScript**: run (not just type-checked) under Deno against
  `@bufbuild/protobuf@^1`, instantiating a message and reading the service
  descriptor's `typeName`.
