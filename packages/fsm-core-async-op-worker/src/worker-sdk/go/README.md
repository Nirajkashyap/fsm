# worker-sdk/go

Go reference worker for the Activity Gateway — follows the same shape as
`../typescript`, `../python`, and `../rust`, with the same unavoidable
difference `../rust`'s README explains: **Go has no dynamic-loading mechanism**
for `.go` source files at runtime. So this SDK is **registry-based**:
`ActorWorker` takes an explicit `[]ActorRegistration` — real, compiled-in Go
functions paired with their FSM identity.

That registry is no longer hand-maintained. `fsm-compiler-ts` generates it
(`writeAggregateGoRegistry`) as its own standalone Go module,
`apps/fsm-core-example/go-actors-registry-generated/`, and this package's own
`go.mod` imports it — see [#84](https://github.com/pgfsm/fsm/issues/84).

## Pieces

- `protocol.go` — wire envelope + length-prefixed JSON framing (ported from
  `../../sidecar/protocol.ts`; must match its wire shapes exactly).
- `sdk.go` — `ActorWorker`: registers a compile-time actor registry with the
  gateway, then serves invoke requests. Plain blocking `net.Conn` + a goroutine
  for heartbeats (stdlib only, no external dependencies). A `defer`/`recover()`
  around every handler call reports a panicking actor as an `INTERNAL` invoke
  error rather than crashing the worker.
- `main.go` — the reference binary. Imports
  `fsm-core-example/go-actors-registry-generated` (see `go.mod`) and adapts its
  `[]generatedregistry.ActorRegistration` into `sdk.ActorRegistration`. No
  folder scan, no hand-written handler table — the generated module's linked-in
  actor functions are what make this build in the first place: it wouldn't
  compile if an actor's function didn't exist or had the wrong signature.
- `go.mod` — two things worth knowing:
  - A `require`/`replace` for `fsm-core-example/go-actors-registry-generated`
    itself — stable, never changes.
  - A **generated section**
    (`// --- BEGIN/END fsm-compiler-ts generated actor
    requires ---`) with
    one `require`+`replace` **per Go actor**, rewritten by `fsm-compiler-ts`'s
    `generate-async-logic` on every run. This looks redundant with the aggregate
    module's own `require`/`replace` for the same actors, but it isn't: **Go's
    `replace` directives are only honored in the module actually being built,
    not in a dependency's own `go.mod`** — they don't propagate transitively. So
    even though `go-actors-registry-generated` is what logically imports each
    actor module, this package (as the thing actually being built) needs its own
    entry for every actor the aggregate transitively needs, or the build can't
    resolve them. Don't hand-edit between the markers; they're overwritten every
    regeneration.

## Running

```bash
go run . --worker-id go-1
```

Requires a running gateway (`deno task gateway` from the package root) — the
default `--gateway-socket` matches the gateway's default sidecar socket.

## Adding a new working actor

1. Write the actor in
   `apps/fsm-core-example/fsm/<fsmName>/<version>/go/actors/<actorName>/<actorName>.go`
   with a real `func(input any) (any, error)` body — **exported** (capitalized
   name), since Go enforces exports at compile time for cross-package access.
2. Regenerate:
   `deno run --allow-all packages/fsm-compiler-ts/src/cli/index.ts
   -c generate-async-logic -f <abs path to apps/fsm-core-example/fsm>`
   — this rewrites `go-actors-registry-generated/` (module + registry) and this
   package's `go.mod` generated section.
3. `go build ./...` — the new actor is linked in and registered automatically.

Regeneration unconditionally overwrites every actor file it touches with a fresh
TODO stub, even one with real hand-written logic — write the actor's real
implementation, run `generate-async-logic` once to produce the file and wire it
into the registry, then don't run it again for that actor (or be ready to
re-apply your changes afterward).
