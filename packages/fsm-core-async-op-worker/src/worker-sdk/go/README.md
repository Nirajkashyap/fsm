# worker-sdk/go

Go reference worker for the Activity Gateway — follows the same shape as
`../typescript` and `../python`/`../rust`, with the same unavoidable difference
`../rust`'s README explains: **Go has no dynamic-loading mechanism** for `.go`
source files at runtime (Go plugins exist but require exact toolchain/build-flag
matching between plugin and host and aren't practical here — see
[SPEC-001](../../../../../docs/specs/spec-001-compiled-lang-actor-workers.md)'s
Problem section). So this SDK is **registry-based**: `ActorWorker` takes an
explicit `[]ActorRegistration` — real, compiled-in Go functions paired with
their FSM identity — built by hand in `main.go`, instead of discovered from a
folder at startup.

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
- `main.go` — the reference binary. `--folder-path` is required (no default —
  pass `apps/fsm-core-example/fsm` explicitly to scan this repo's fixtures),
  calls the validator, and matches each verified result against `knownHandlers`
  — a small compile-time table mapping `FsmName` to an actual linked-in
  function.

### Why `knownHandlers` is currently empty

This repo's one real Go actor,
`apps/fsm-core-example/fsm/creditCheck/v01/go/actors/checkReportsTable/checkReportsTable.go`,
declares an **unexported** (lowercase) function — matching the same convention
`check_fn.go`'s own validation expects (it doesn't care about export status). Go
enforces exports at the _compiler_ level for cross-package access, unlike Rust's
`pub`, which was already the established convention for Rust actors
(`checkBureau.rs`) and could be `#[path]`-included directly. There is no Go
equivalent of Rust's `#[path]` — packages are strictly directory-based — so
`checkReportsTable` cannot be imported/linked into this binary without renaming
it to be exported, which would break `check_fn.go`'s validation of that same
file elsewhere in the repo. Running this binary with
`--folder-path apps/fsm-core-example/fsm` therefore reports it as
verified-but-unlinked and exits (no working registrations):

```
Discovered 1 actor(s) under .../apps/fsm-core-example/fsm
  ~ creditCheck@v01@promise@checkReportsTable@v01 (...): verified but no compiled-in handler registered (see knownHandlers in main.go)
No actors with a compiled-in handler found, refusing to start worker
```

The registration/invoke/heartbeat mechanics themselves are still fully verified
— tested against a temporary fixture with a properly-exported handler wired into
`knownHandlers`, registering and invoking successfully. If a real, exported Go
actor is added to this repo in the future, wiring it in is exactly the
`known_handler()` step described in `../rust/README.md`.

## Running

`--folder-path` is required:

```bash
go run . --folder-path /abs/path/to/fsm-core-example/fsm --worker-id go-1
# or, with a subset:
go run . --folder-path /abs/path/to/fsm --skip-dirs taskMachineConfig
```

Requires a running gateway (`deno task gateway` from the package root) — the
default `--gateway-socket` matches the gateway's default sidecar socket.
