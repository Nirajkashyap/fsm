# worker-sdk/go

Go reference worker for the Activity Gateway — follows the same shape as
`../typescript` and `../python`/`../rust`, with the same unavoidable difference
`../rust`'s README explains: **Go has no dynamic-loading mechanism** for `.go`
source files at runtime (Go plugins exist but require exact toolchain/build-flag
matching between plugin and host and aren't practical here — see
[SPEC-001](../../../../../docs/specs/spec-001-compiled-lang-actor-workers.md)'s
Problem section). So this SDK is **registry-based**: `ActorWorker` takes an
explicit `[]ActorRegistration` — real, compiled-in Go functions paired with
their FSM identity — built by hand in `registry.go`, instead of discovered from
a folder at startup.

## Pieces

- `protocol.go` — wire envelope + length-prefixed JSON framing (ported from
  `../../sidecar/protocol.ts`; must match its wire shapes exactly).
- `sdk.go` — `ActorWorker`: registers a compile-time actor registry with the
  gateway, then serves invoke requests. Plain blocking `net.Conn` + a goroutine
  for heartbeats (stdlib only, no external dependencies). A `defer`/`recover()`
  around every handler call reports a panicking actor as an `INTERNAL` invoke
  error rather than crashing the worker (verified with a real panicking handler
  — the process survives and keeps serving).
- `validate_async_operation.go` — `ValidateAsyncOperationFromFoldersGo()`: walks
  `<folderPath>/<fsmName>/<version>/go/actors/<actorName>/<actorName>.go` (this
  repo's real FSM actor convention) and inlines
  `packages/fsm-compiler-ts/src/checkers/check_fn.go`'s own check (`go/ast` walk
  for a `FuncDecl` matching the actor name, regardless of export case)
  in-process. This part _is_ full parity with the TS/Python versions — folder
  discovery needs no dynamic loading, just parsing.
- `registry.go` — `knownHandlers`: the compile-time table mapping `FsmName` to
  an actual linked-in function. Kept out of `main.go` so adding an actor (a new
  import + map entry) doesn't churn the CLI/orchestration code.
- `main.go` — the reference binary. `--folder-path` is required (no default —
  pass `apps/fsm-core-example/fsm` explicitly to scan this repo's fixtures),
  calls the validator, and matches each verified result against `knownHandlers`.

### `checkReportsTable` → `CheckReportsTable`

This repo's one real Go actor,
`apps/fsm-core-example/fsm/creditCheck/v01/go/actors/CheckReportsTable/CheckReportsTable.go`,
originally declared an **unexported** (lowercase) function — matching the same
convention `check_fn.go`'s own validation expects (it doesn't care about export
status). Go enforces exports at the _compiler_ level for cross-package access,
unlike Rust's `pub`, which was already the established convention for Rust
actors (`checkBureauRust.rs`) and could be `#[path]`-included directly. There is
no Go equivalent of Rust's `#[path]` — packages are strictly directory-based —
so the actor was renamed to `CheckReportsTable` (folder, file, and function) and
given its own scoped `go.mod`, referenced from this package's `go.mod` via a
local `replace` directive
(`fsm-core-example/creditcheck/v01/go/actors/checkreportstable`) since it isn't
part of this module. Only the one FSM invoke using this actor in the
`"go"`-language variant (`gavUnionDBActor`) had its `src` updated to match, in
`machine.ts`/`fsm.json`/`xstate-fsm.json`/`machine-with-provider.ts` — the two
other invokes sharing the old `checkReportsTable` name are `typescript`-language
and untouched.

`registry.go` wires it into `knownHandlers["CheckReportsTable"]`; running this
binary against the real fixtures discovers, links, registers, and serves it
end-to-end.

## Running

`--folder-path` is required:

```bash
go run . --folder-path /abs/path/to/fsm-core-example/fsm --worker-id go-1
# or, with a subset:
go run . --folder-path /abs/path/to/fsm --skip-dirs taskMachineConfig
```

Requires a running gateway (`deno task gateway` from the package root) — the
default `--gateway-socket` matches the gateway's default sidecar socket.
