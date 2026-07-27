# worker-sdk/rust

Rust reference worker for the Activity Gateway — follows the same shape as
`../typescript` and `../python`, with one unavoidable difference: **Rust has no
dynamic-loading mechanism.** `import()` (TS) and `importlib` (Python) can load a
function out of a source file at runtime; Rust cannot load a function out of a
`.rs` file at runtime at all (this is exactly the gap
[SPEC-001](../../../../../docs/specs/spec-001-compiled-lang-actor-workers.md)'s
Problem section describes). So this SDK is **registry-based**: `ActorWorker`
takes an explicit `Vec<ActorRegistration>` — real, compiled-in Rust functions
paired with their FSM identity — built by hand in `main.rs`, instead of
discovered from a folder at startup.

## Pieces

- `src/protocol.rs` — wire envelope + length-prefixed JSON framing (ported from
  `../../sidecar/protocol.ts`; must match its wire shapes exactly).
- `src/sdk.rs` — `ActorWorker`: registers a compile-time actor registry with the
  gateway, then serves invoke requests. Plain blocking `UnixStream` + a
  heartbeat thread (no async runtime) — same reasoning as `worker-sdk/python`.
  Actor panics are caught via `catch_unwind` and reported as `INTERNAL` invoke
  errors rather than crashing the worker (verified with a real panicking handler
  — the process survives and keeps serving).
- `src/validate_async_operation.rs` —
  `validate_async_operation_from_folders_rust()`: walks
  `<folderPath>/<fsmName>/<version>/rust/actors/<actorName>/<actorName>.rs`
  (this repo's real FSM actor convention) and inlines
  `packages/fsm-compiler-ts/src/checkers/check_fn.rs`'s own check (substring
  match for `pub fn <name>(` / `pub async fn <name>(`) in-process. This part
  _is_ full parity with the TS/Python versions — folder discovery needs no
  dynamic loading, only text matching.
- `src/registry.rs` — `known_handler()`: the compile-time table mapping
  `fsm_name` to an actual linked-in function. Currently wires up the real
  `checkBureauRust` actor
  (`apps/fsm-core-example/fsm/creditCheck/v01/rust/actors/checkBureauRust/checkBureauRust.rs`),
  included directly via `#[path]` (no copy) since it isn't its own crate — its
  signature was changed from the shared `(context, event)` two-argument scaffold
  stub to a single `serde_json::Value` argument, since (unlike TS/Python, where
  the mismatch merely raises at call time) Rust would fail to _compile_ a
  one-argument call site against a two-required-argument function. Kept out of
  `main.rs` so adding an actor (a new `#[path]` mod + match arm) doesn't churn
  the CLI/orchestration code.
- `src/static_registrations.rs` — `static_registrations()`: the alternative to
  the folder-scan-then-match flow above — a hardcoded
  `Vec<(parent_fsm_name, parent_fsm_version, fsm_type, fsm_name, fsm_version)>`
  resolved directly against `registry::known_handler()`, no filesystem access at
  all. Selected via `--registry-source static` (see below). Simpler and honest
  that the registry is the real source of truth for a compiled language, at the
  cost of hand-keeping the FSM identity metadata in sync instead of deriving it
  from the real actor folder, and no visibility into actors that exist on disk
  but aren't wired into `known_handler()` yet.
- `src/main.rs` — the reference binary. `--registry-source folder` (the default)
  requires `--folder-path` (pass `apps/fsm-core-example/fsm` explicitly to scan
  this repo's fixtures) and uses `validate_async_operation.rs` + `registry.rs`
  as described above; `--registry-source static` uses `static_registrations.rs`
  instead and ignores `--folder-path`/`--skip-dirs` entirely.

## Running

`--registry-source folder` (the default) requires `--folder-path`:

```bash
cargo run --release -- --folder-path /abs/path/to/fsm-core-example/fsm --worker-id rust-1
# or, with a subset:
cargo run --release -- --folder-path /abs/path/to/fsm --skip-dirs taskMachineConfig
```

`--registry-source static` skips the folder scan — no `--folder-path` needed:

```bash
cargo run --release -- --registry-source static --worker-id rust-1
```

Requires a running gateway (`deno task gateway` from the package root) — the
default `--gateway-socket` matches the gateway's default sidecar socket.

## Adding a new working actor

1. Write a real `fn(serde_json::Value) -> serde_json::Value` implementation
   somewhere reachable from this crate (a `#[path]` mod like `checkBureauRust`,
   or — once there's more than one — a proper local crate dependency).
2. Add a match arm to `known_handler()` in `registry.rs` keyed by the actor's
   `fsm_name`.
3. If you also want it available under `--registry-source static`, add its
   identity tuple to `STATIC_ACTOR_IDENTITIES` in `static_registrations.rs`.

There's no way to skip step 2 for a compiled language — that's the actual
tradeoff of this architecture, not a gap in this SDK.
