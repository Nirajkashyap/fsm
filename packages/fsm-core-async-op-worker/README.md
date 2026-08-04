# @pgfsm/async-op-worker-gateway

Local Activity Gateway for polyglot (TypeScript, Python, Rust, Go) promise
actors — implements Option B of
[ADR-003](../../docs/adr/adr-003-fsm-async-operation-polyglot-actor-execution-model.md)'s
2026-07-26 revision (`docs/specs/spec-001-compiled-lang-actor-workers.md`, the
original design doc, was consolidated into that ADR).

Base ported from the `polygot-lang-ipc-worker` prototype (local repo, validated
gateway + sidecar shape end-to-end with Python and TypeScript worker SDKs). What
changed in the port:

- Client-facing contract (`proto/activity-gateway.proto`) carries the activity
  contract from ADR-003 (`parent_fsm_name`, `parent_fsm_version`, `fsm_type`,
  `fsm_name`, `fsm_version`, `input_json`, `instance_id`, `correlation_id`)
  instead of the prototype's generic `function_name`/`payload_json`.
- Sidecar routing key is
  `parentFsmName@parentFsmVersion@fsmType@fsmName@fsmVersion@fsmLanguage`
  (`sidecar/protocol.ts`'s `actorKey()`) instead of a free-form function name —
  a bare name/version pair isn't unique across FSM types/versions, so the key
  mirrors each actor's full identity, including `fsmLanguage` (needed because
  the other five fields alone aren't guaranteed unique across languages — two
  workers of different languages could otherwise register the same tuple and
  silently overwrite each other's route).
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
- `src/worker-sdk/{typescript,python,rust,go}/` — four worker SDKs, one per
  language. All four now discover actors from **`fsm-compiler-ts`-generated
  registries**, not a runtime folder scan (see
  [#84](https://github.com/pgfsm/fsm/issues/84)):
  - `fsm-compiler-ts`
    (`packages/fsm-compiler-ts/src/operation-logic-scaffold.ts`) emits, per
    FSM-version, a registry carrying each promise actor's full activity identity
    (`parentFsmName`/`parentFsmVersion`/`fsmType`/`fsmName`/
    `fsmVersion`/`fsmLanguage`) plus its handler, and one **aggregate** registry
    per language at the app root (e.g.
    `apps/fsm-core-example/typescript-actors-registry.generated.ts`) combining
    every FSM — what a worker process actually imports, since it serves its
    language's actors across the whole app, not just one FSM.
  - **TypeScript/Python**: `sdk.ts`/`sdk.py`'s `ActorWorker` takes that registry
    directly; `cli.ts`/`cli.py` statically import (TS) or fixed-path-load
    (Python — see `python/cli.py`'s doc comment for why it can't use a plain
    static import here) the generated aggregate file and pass it straight in. No
    dynamic `import()`/`importlib` at actor-lookup time.
  - **Rust/Go**: no dynamic-loading mechanism exists for compiled languages at
    all, so these were always registry-based (`ActorWorker`/`NewActorWorker`
    take an explicit `Vec<ActorRegistration>`/`[]ActorRegistration`) — what
    changed is where that registry comes from: `main.rs` `#[path]`-includes the
    generated aggregate directly; `main.go` imports it as a real Go module
    (`fsm-core-example/go-actors-registry-generated`, wired via `go.mod`'s
    `require`+`replace` — Go actors each need their own module, since Go has no
    `#[path]`-style escape hatch from its package/module boundaries; see
    `worker-sdk/go/README.md` for why `go.mod` also needs a compiler-maintained
    per-actor section on top of that).
  - Each `cli.{ts,py}`/`main.{rs,go}` only takes gateway/worker-identity flags
    now (`--gateway-socket`/`--worker-id`/`--heartbeat-ms`) — no
    `--folder-path`/`--skip-dirs`. `validate-async-operation.{ts,py,rs,go}` (the
    old in-process folder-scan validators) are gone; validation is
    `fsm-compiler-ts`'s job at generation time.

## What this base does not include yet

- **No integration with `asyncOperationWorkerlet.ts`.** The `"rust"`/`"go"`
  branches of `startPromiseWorkerForLang` still hit the `"not yet implemented"`
  log line. Wiring them to `ActivityGatewayClient` is follow-up implementation
  work.
- **No process supervision.** Starting/restarting the gateway and worker
  processes is still manual/external to this package.
