# @pgfsm/async-op-worker-gateway

Local Activity Gateway for compiled-language (Rust, later Go) promise actors —
implements Option B of
[SPEC-001](../../docs/specs/spec-001-compiled-lang-actor-workers.md) (revised
2026-07-26).

Base ported from the `polygot-lang-ipc-worker` prototype (local repo, validated
gateway + sidecar shape end-to-end with Python and TypeScript worker SDKs). What
changed in the port:

- Client-facing contract (`proto/activity-gateway.proto`) carries the activity
  contract from KB-001 §3.2 (`parent_fsm_name`, `parent_fsm_version`,
  `fsm_type`, `fsm_name`, `fsm_version`, `input_json`, `instance_id`,
  `correlation_id`) instead of the prototype's generic
  `function_name`/`payload_json`.
- Sidecar routing key is
  `parentFsmName@parentFsmVersion@fsmType@fsmName@fsmVersion`
  (`sidecar/protocol.ts`'s `actorKey()`) instead of a free-form function name —
  a bare name/version pair isn't unique across FSM types/versions, so the key
  mirrors `ActorPluginValidationResult`'s full identity.
- Errors carry a `code`/`retriable` pair (`ActivityInvokeError`) so the
  orchestrator can distinguish retriable failures (worker unavailable, timeout)
  from actor-level errors.
- Logging goes through this repo's `@logtape/logtape` logger instead of
  `console.log`.

## Pieces

- `src/sidecar/protocol.ts` — wire envelope + length-prefixed JSON framing over
  the Unix socket (unchanged framing scheme from the prototype — chosen so an
  actor's own stdout logging can never corrupt the RPC channel).
- `src/sidecar/gateway.ts` — `SidecarGateway`: accepts worker connections,
  tracks registered actors per worker, routes `invoke` calls to the right worker
  connection. Holds zero DB connections.
- `src/proto/activity-gateway.proto` + `src/gatewayServer.ts` — the
  client-facing gRPC service (`Invoke`, `ListRegisteredActors`) that wraps
  `SidecarGateway`.
- `src/gatewayClient.ts` — thin gRPC client for the gateway's `Invoke` RPC.
- `src/cli/async-operation-worker-gateway.ts` — standalone entry point
  (`deno task gateway`) to run the gateway as its own process.
- `src/cli/async-operation-worker-gateway-ctl.ts` — thin debug/test CLI client
  (`deno task gateway-ctl <list|invoke>`) that connects to a running gateway and
  calls `ListRegisteredActors` or `Invoke` once via `ActivityGatewayClient`,
  prints the result, and exits.
- `src/worker-sdk/typescript/validate-async-operation.ts` —
  `validateAsyncOperationFromFoldersTypescript()`: a typescript-only trim of
  `packages/fsm-compiler-ts/src/validate-async-operation-logic.ts`'s
  `validateAsyncOperationFromFolders` (no `runtimeLanguages` argument, only the
  `typescript` branch survives) that walks
  `<folderPath>/<fsmName>/<version>/typescript/actors/<actorName>/<actorName>.ts`
  — this repo's real FSM actor convention, e.g.
  `apps/fsm-core-example/fsm/creditCheck/v01/typescript/actors/checkBureau/checkBureau.ts`
  — and verifies each actor exports a _named_ function `<actorName>(input)` (not
  `default`) in-process, inlining
  `packages/fsm-compiler-ts/src/checkers/check_fn.ts`'s own check (dynamic
  `import()` + `typeof mod[fnName] === "function"`) rather than shelling out to
  it via `Deno.Command` like the real compiler's multi-language validator does —
  unnecessary here since this file only ever checks typescript, in a process
  that's already Deno. Returns `ActorPluginValidationResult[]`.
- `src/worker-sdk/typescript/sdk.ts` + `cli.ts` — reference worker SDK: `cli.ts`
  calls the validator above, filters to `isVerified` results, and passes that
  array straight into `new ActorWorker(options, verifiedActors)`, which
  dynamically imports each `fsmModulePath`/`method` pair itself and
  registers/serves them with the gateway (`deno task worker-ts-scan` /
  `worker-ts-start`).
- `src/worker-sdk/python/` — Python counterpart of the typescript worker SDK
  above, following the same shape: `validate_async_operation.py`'s
  `validate_async_operation_from_folders_python()` walks
  `<folderPath>/<fsmName>/<version>/python/actors/<actorName>/<actorName>.py`
  (e.g.
  `apps/fsm-core-example/fsm/creditCheck/v01/python/actors/checkBureau/checkBureau.py`)
  and inlines `check_fn.py`'s own AST check (`ast.walk` for a
  `FunctionDef`/`AsyncFunctionDef` matching the actor name) in-process instead
  of shelling out to it; `sdk.py`'s `ActorWorker` takes the verified results and
  dynamically loads each module/function itself, same `actor_key()` identity and
  register → heartbeat → serve lifecycle as the TypeScript version, but
  implemented with plain blocking sockets + a heartbeat thread (`protocol.py`,
  no async framework) since that's the natural Python shape for the same wire
  protocol — no external dependencies required. Run via
  `python3 cli.py <scan|start> --folder-path ...` from `src/worker-sdk/python/`.
- `src/worker-sdk/rust/` and `src/worker-sdk/go/` — Rust and Go worker SDKs.
  Unlike the two above, these are **registry-based, not folder-scanning**:
  compiled languages have no runtime mechanism to load a function out of a
  source file the way `import()`/`importlib` do (exactly the gap SPEC-001's
  Problem section describes), so `ActorWorker` takes an explicit compile-time
  registry (`Vec<ActorRegistration>` / `[]ActorRegistration`) instead of a
  verified-results array. Each still has its own
  `validate_async_operation_from_folders_rust()` /
  `ValidateAsyncOperationFromFoldersGo()` for folder-discovery parity with the
  other two (that part needs no dynamic loading, only inlining
  `check_fn.rs`/`check_fn.go`'s own checks), but a verified result is matched
  against a small hand-written handler table in each `main` before it can
  actually be invoked. Rust's table currently links the real `checkBureau` actor
  (its stub signature was changed from `(context, event)` to a single argument,
  since Rust — unlike TS/Python — won't even _compile_ a mismatched call site);
  Go's is empty because its one real actor, `checkReportsTable`, is unexported
  and Go enforces exports at compile time with no `#[path]`-style escape hatch —
  see each SDK's own README for the full explanation. Run via
  `cargo run --release --` (from `src/worker-sdk/rust/`) or `go run .` (from
  `src/worker-sdk/go/`).

## What this base does not include yet

- **No integration with `asyncOperationWorkerlet.ts`.** The `"rust"`/`"go"`
  branches of `startPromiseWorkerForLang` still hit the `"not yet implemented"`
  log line. Wiring them to `ActivityGatewayClient` is follow-up implementation
  work per SPEC-001's acceptance criteria, not part of this scaffold.
- **No real, exported Go actor to link.** `checkReportsTable` can't be wired in
  without either renaming it (breaking `check_fn.go`'s validation elsewhere) or
  adding a second, properly-exported actor — see `worker-sdk/go/README.md`.
- **No process supervision.** Starting/restarting the gateway and worker
  processes, and wiring `check_fn.rs`'s validation to confirm a worker actually
  registers the actor, are both still open per the spec's acceptance criteria.
