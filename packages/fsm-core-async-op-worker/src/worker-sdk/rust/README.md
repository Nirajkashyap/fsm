# worker-sdk/rust

Rust reference worker for the Activity Gateway — follows the same shape as
`../typescript` and `../python`, with one unavoidable difference: **Rust has no
dynamic-loading mechanism.** `import()` (TS) and `importlib` (Python) can load a
function out of a source file at runtime; Rust cannot load a function out of a
`.rs` file at runtime at all. So this SDK is **registry-based**: `ActorWorker`
takes an explicit `Vec<ActorRegistration>` — real, compiled-in Rust functions
paired with their FSM identity.

That registry is no longer hand-maintained. `fsm-compiler-ts` generates it
(`writeAggregateActorsRegistry`), `#[path]`-included directly into this binary
from a fixed location — see [#84](https://github.com/pgfsm/fsm/issues/84).

## Pieces

- `src/protocol.rs` — wire envelope + length-prefixed JSON framing (ported from
  `../../sidecar/protocol.ts`; must match its wire shapes exactly).
- `src/sdk.rs` — `ActorWorker`: registers a compile-time actor registry with the
  gateway, then serves invoke requests. Plain blocking `UnixStream` + a
  heartbeat thread (no async runtime) — same reasoning as `worker-sdk/python`.
  Actor panics are caught via `catch_unwind` and reported as `INTERNAL` invoke
  errors rather than crashing the worker.
- `src/main.rs` — the reference binary.
  `#[path = "../../../../../../apps/fsm-core-example/rust-actors-registry.generated.rs"]
  mod generated_registry;`
  pulls in the compiler-generated registry directly; `main()` adapts its
  `Vec<generated_registry::ActorRegistration>` (plain `fn` pointers +
  `&'static str` fields) into `sdk::ActorRegistration` (boxed `dyn Fn` + owned
  `String`s) and hands it to `ActorWorker`. No folder scan, no hand-written
  match table — the generated file's `#[path]`-included actor modules (functions
  only) are what actually get linked in, so "verification" happens at compile
  time: this binary wouldn't build if an actor's function didn't exist or had
  the wrong signature.

## Running

```bash
cargo run --release -- --worker-id rust-1
```

Requires a running gateway (`deno task gateway` from the package root) — the
default `--gateway-socket` matches the gateway's default sidecar socket.

## Adding a new working actor

1. Write the actor in
   `apps/fsm-core-example/fsm/<fsmName>/<version>/rust/actors/<actorName>/<actorName>.rs`
   with a real `fn(serde_json::Value) -> serde_json::Value` body (or add it to
   the FSM's `fsm.json`/`machine.ts` and regenerate the TODO stub).
2. Regenerate:
   `deno run --allow-all packages/fsm-compiler-ts/src/cli/index.ts
   -c generate-async-logic -f <abs path to apps/fsm-core-example/fsm>`
   — this rewrites `apps/fsm-core-example/rust-actors-registry.generated.rs`
   (and every other language's registry) to include it.
3. `cargo build` — the new actor is linked in and registered automatically; no
   manual registry edit.

Regeneration unconditionally overwrites every actor file it touches with a fresh
TODO stub, even one with real hand-written logic — write the actor's real
implementation, run `generate-async-logic` once to produce the file and wire it
into the registry, then don't run it again for that actor (or be ready to
re-apply your changes afterward).
