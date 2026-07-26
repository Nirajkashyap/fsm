# SPEC-001: Polyglot Actor Workers for Compiled Languages via Local IPC

| Field   | Value                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Status  | Draft (revised)                                                                                                                |
| Date    | 2026-07-22 (revised 2026-07-26)                                                                                                |
| Authors | Niraj, Claude                                                                                                                  |
| Issue   | #55                                                                                                                            |
| Affects | `apps/fsm-core-worker-ts`, `packages/fsm-core-async-op-worker`, `packages/fsm-compiler-ts`, `apps/fsm-core-example`, `docs/kb` |

> **Revision note (2026-07-26)**: the original decision (Option C) shipped via
> PR #56. Before any Rust/Go actor landed against it, a standalone prototype
> (`polygot-lang-ipc-worker`, local repo, not yet in this monorepo) was built
> exploring the gateway shape independently and validated it end-to-end: a gRPC
> gateway + Unix-socket sidecar protocol with persistent, self-registering
> per-language worker processes (Python and TypeScript SDKs both working against
> the same wire contract). That prototype directly de-risks the concern that got
> Option B reverted on 2026-06-23 ("too complex for now") — the complexity was
> speculative then and is now a working reference. The decision below is revised
> from Option C to **Option B** on that basis. See the updated
> [Decision](#decision) section. This revision was made directly against the
> merged spec file, outside the normal spec-only-PR review flow (see
> `docs/specs/README.md`) — a follow-up design PR should still review this
> before implementation work is cut.

---

## Problem

`asyncOperationWorkerlet.ts`'s `startPromiseWorkerForLang` (line ~92) dispatches
a claimed promise-actor invocation by `fsmLanguage`:

- `"typescript"` — in-process, dynamic `import()`, polls PGMQ itself
  (`startFSMPromiseWorker`).
- `"python"` — spawns `fsmpromiseworker.py` as a subprocess, but that subprocess
  _also_ opens its own `psycopg2` connection and runs its own independent poll →
  invoke → archive loop.
- `"go"` / `"rust"` — logs
  `"Promise worker for lang={lang} not yet
  implemented"` and returns. **No
  worker runs at all.**

The go/rust gap isn't a small wiring fix:
`validateAsyncOperationFromFoldersV2`'s checkers for these languages
(`check_fn.go`, `check_fn.rs`) only do a **static syntax check** (AST scan for
Go, substring match for Rust) — there is no existing mechanism to dynamically
invoke a compiled Go or Rust function the way `import()` does for TS or
`importlib` does for Python. An actual invocation path has to be designed, not
patched in.

No specific actor is blocked on this today — this is proactive design work to
close a known, documented gap (the `"not yet implemented"` log line has existed
since the go/rust branches were stubbed) before it becomes a blocker.

## Constraints

From `docs/kb/kb-001-distributed-multilang-fsm.md` (standing architectural
guidance for this exact problem space):

- **Orchestrator vs. activity split**: only the orchestrator tier touches the
  DB/queue; activity workers (actors) should ideally hold **zero** DB
  connections (KB-001 §2, §3.2).
- **Connection minimization**: DB connections must not scale with the number of
  polyglot actor processes (KB-001 §1.4, §3.3). Today's Python path (one
  `psycopg2` connection per active queue) is explicitly KB-001's "option A...
  simplest, but defeats the goal" — an accepted stopgap, not the target state.
- **Polyglot via queue, not via transport rebuild**: KB-001 §3.3 recommends an
  Activity Gateway (option B) or neutral broker (option C) for the general case.
  A full gateway (gRPC/HTTP service, its own deployment, wire contract, SDK) was
  prototyped 2026-06-14 and **reverted 2026-06-23 as "too complex for now"**
  (KB-001 §5, "Reverted work"). ~~Reintroducing that scope is explicitly out of
  bounds for this spec.~~ **Superseded by the 2026-07-26 revision**: a working
  reference prototype (`polygot-lang-ipc-worker`) now exists validating the
  gateway shape end-to-end, which removes the main risk ("unproven, speculative
  complexity") that motivated the 2026-06-23 revert. The gateway option is back
  in bounds — see [Decision](#decision).
- **Kubelet analogy already established**: `asyncOperationWorkerlet.ts`'s own
  doc comment and ADR-002 (Stage 3, FSM-instance side) both use the Kubernetes
  kubelet/scheduler framing. This spec keeps that framing rather than
  introducing a new mental model.

Additional constraints surfaced during interrogation:

- **No confirmed container runtime** in the deploy target. The design must not
  require Docker/Podman; a plain compiled-binary subprocess is the default.
- **No live Go/Rust actor exists yet** — acceptance is proven with a reference
  fixture, not a production migration.
- **WASM-in-Deno ruled out explicitly**: compiling actors to WASM and running
  them in-process (like TS's `import()`) was considered and rejected — real
  actor business logic needs full OS access (outbound network calls, file I/O,
  native libs), which WASM sandboxing would block. Not revisited in this spec.

## Options considered

### Option A — Direct-connection worker per language (extend today's Python model to Rust)

A Rust subprocess owns its own DB connection, polls PGMQ directly, calls the
actor function in-process, and archives the result — mirroring
`fsmpromiseworker.py` exactly.

- **Pros**: zero new design; precedent already exists and works in production
  for Python.
- **Cons**: adds one DB connection per active queue, directly violating KB-001's
  connection-minimization goal; duplicates the full poll/archive/error handling
  logic per language with no shared harness — every future compiled language
  repeats all of it from scratch.

### Option B — Revive the full Activity Gateway (gRPC/HTTP service) (chosen)

Rebuild the reverted 2026-06-14 prototype: a standalone gateway service that
routes function invocations between the TS orchestrator and long-lived,
self-registering per-language worker processes over gRPC (client-facing) and a
Unix-socket sidecar protocol (worker-facing). Neither the gateway nor the
workers open a DB connection — `asyncOperationWorkerlet.ts` keeps 100% of the
PGMQ poll/claim/archive logic and becomes a gRPC _client_ of the gateway for
compiled-language actors, the same relationship `client-sample/` has to the
gateway in the reference prototype.

- **Pros**: general solution for _any_ number of languages/processes, not just
  Rust — a new language only needs a worker SDK speaking the existing
  register/invoke protocol, no protocol renegotiation; closest to KB-001's
  fully-realized recommendation; workers are long-lived and self-register their
  functions once at startup rather than being spawned per active queue, so
  warm-start cost is paid once per worker process, not once per queue; a working
  reference implementation (`polygot-lang-ipc-worker`) already exists, covering
  the gateway, the sidecar wire protocol, and both a Python and a TypeScript
  worker SDK — most of the risk that sank the 2026-06-14 attempt is now retired.
- **Cons**: adds a new local network service (the gateway) to deploy, supervise,
  and monitor, plus one long-lived worker process per language to keep alive
  (restart on crash, re-scan on function changes) — real operational surface
  beyond today's ephemeral per-queue subprocess model; this is the scope that
  was reverted once already, and the case for reintroducing it rests on the
  prototype being sound, not on a live production need driving it yet.

### Option C — Orchestrator-held poll + warm per-queue subprocess + Unix domain socket IPC (original decision, superseded 2026-07-26)

The TS orchestrator (`asyncOperationWorkerlet.ts`) keeps 100% of PGMQ
poll/claim/archive logic — nothing moves out of it. For `"rust"` (and later
`"go"`), `startPromiseWorkerForLang` launches one warm subprocess per active
queue (`Deno.Command`, no container), tracked in `activeWorkers` and killed via
the existing `AbortController`/signal pattern — the same lifecycle shape
Python's subprocess already uses today. Instead of the subprocess polling PGMQ
itself, the orchestrator sends it one request at a time over a **Unix domain
socket** and awaits the response; the subprocess never opens a DB connection.

A single generic "poll + dispatch-over-socket" harness is written once in TS and
reused for every compiled language; each language only needs a small shim that
accepts one connection, reads one framed request, calls the named function,
writes one framed response, and loops.

- **Pros**: zero DB connections in the polyglot worker (satisfies KB-001's
  actual goal without the gateway's deployment surface); one harness reused
  across languages instead of a bespoke poller per language; no container
  runtime dependency; socket transport avoids the risk of an actor's own
  `println!`/log output corrupting a shared-stdio protocol (a real risk with
  stdin/stdout framing, since the actor's own dependencies may write to stdout
  unpredictably); rollback is trivial (revert to the no-op branch, zero blast
  radius on TS/Python).
- **Cons**: one request in flight per process at a time (matches today's
  single-consumer-per-queue model everywhere else, so not currently a real
  limitation); introduces a new small protocol/contract to maintain as more
  languages are added; adds one indirection hop for debugging (TS ↔ socket ↔
  compiled process) versus in-process TS.

### Option D — Do nothing (smaller hammer): leave go/rust unimplemented until an actor needs it

- **Pros**: zero effort now; avoids speculative complexity for a need with no
  current live driver.
- **Cons**: the gap is already documented and known; deferring means the first
  real Go/Rust actor request becomes blocked on this design work landing on the
  critical path, instead of already being solved infrastructure.

## Decision

**Option B** (revised 2026-07-26; originally Option C, shipped via PR #56).
Decision drivers, in order:

1. **The prototype retires the risk that sank the 2026-06-14 attempt.**
   `polygot-lang-ipc-worker` proves the gateway + sidecar shape works end to end
   — a Deno gRPC gateway, a length-prefixed JSON-frame sidecar protocol, and
   both Python and TypeScript worker SDKs registering functions and serving
   invocations. The 2026-06-23 revert reason was "too complex for now," i.e. an
   estimate of unproven complexity; that estimate no longer holds against a
   working reference.
2. **Zero DB connections, on both the gateway and the workers** — same property
   Option C was chosen for, still satisfied: `asyncOperationWorkerlet.ts` is
   unchanged in its ownership of PGMQ poll/claim/archive; it becomes a gRPC
   client of the gateway, and the gateway itself never touches Postgres, only
   routes invocations to registered workers over the sidecar socket.
3. **General over special-cased.** Option C's design was Rust-specific with Go
   "following later against the same contract" — but every new compiled language
   still needed its own warm-subprocess-per-queue wiring inside
   `startPromiseWorkerForLang`. Option B needs that wiring exactly once (a gRPC
   client call), and a new language is purely a worker-SDK exercise (already
   proven twice, for Python and TypeScript, in the prototype).
4. **Reuse over rebuild, applied to a bigger and now-available base.** Rather
   than reusing `activeWorkers`/`AbortController` subprocess plumbing, this
   reuses the entire `polygot-lang-ipc-worker` prototype (gateway, sidecar
   protocol, worker SDKs) as the base for the new
   `@pgfsm/async-op-worker-gateway` package
   (`packages/fsm-core-async-op-worker`), called from `apps/fsm-core-worker-ts`
   as a workspace dependency.

**First reference implementation targets Rust**, following the prototype's
established worker-SDK pattern (as Python and TypeScript SDKs already do). Go
follows later against the same register/invoke contract — no protocol
renegotiation needed, per the prototype's existing multi-language proof.

## Consequences & migration

- **No data/schema migration required.** Go/Rust have zero workers today — this
  is net-new capability. TS and Python branches of `startPromiseWorkerForLang`
  are untouched.
- **New operational surface** (this is the real cost of the revision): the
  Activity Gateway is a new long-running local process that must be started,
  supervised, and monitored alongside `asyncOperationWorkerlet.ts`; each
  compiled language additionally needs one long-lived worker process (started
  via its worker SDK's CLI) that self-registers its functions at startup and
  must be kept alive/restarted independently of queue activity. This is more
  moving parts than Option C's ephemeral per-queue subprocess model.
- **What gets harder**: one more service (the gateway) and one more long-lived
  process per language to keep running; a new wire protocol
  (register/invoke/heartbeat/cancel/unregister over the sidecar socket, plus the
  client-facing gRPC contract) to keep stable as languages are added; debugging
  a Rust actor invocation now involves two hops (orchestrator → gRPC gateway →
  sidecar socket → worker) instead of one.
- **Rollback story**: the new code path is fully gated on
  `fsmLanguage ===
  "rust"` (soon `"go"`) inside `startPromiseWorkerForLang`.
  Reverting means restoring the no-op/log-warning branch and not starting the
  gateway/worker processes — no impact on TS or Python actors, no schema or data
  migration to undo.
- **Explicitly deferred, not solved by this spec**: per-actor dependency
  isolation (e.g. two Rust actors needing incompatible native library versions)
  — this would need containers or per-actor build isolation, which is out of
  scope given the "no confirmed container runtime" constraint. Containerizing
  the gateway or a language's worker process is a compatible future upgrade, not
  a redesign.

## Acceptance criteria

- [ ] The gateway's client-facing contract and worker-facing sidecar protocol
      are documented, based on `polygot-lang-ipc-worker`'s `proto/ipc.proto`
      (`Invoke`, `ListFunctions`) and sidecar envelope
      (`register | register_ack | invoke | invoke_result | invoke_error |
      heartbeat | cancel | unregister`)
      — adapted so the `invoke` payload carries the activity contract shape
      already defined in KB-001 §3.2
      (`{actor, version, input, instance_id, correlation_id}` →
      `{output | error}`) rather than the prototype's generic
      `function_name`/`payload_json`.
- [ ] `@pgfsm/async-op-worker-gateway` (new package,
      `packages/fsm-core-async-op-worker`) hosts the gateway + sidecar router,
      adapted from the prototype's `server/` and `server/src/sidecar/`.
- [ ] `startPromiseWorkerForLang`'s `"rust"` branch becomes a gRPC client of the
      local gateway instead of spawning a per-queue subprocess; the gateway is
      started once (not per queue) and workers register once at startup.
- [ ] The TS orchestrator retains sole ownership of `readMessage` (PGMQ poll)
      and `archiveEventFromFsmPromiseTypeWorker` (archive) — neither the gateway
      nor the Rust worker process ever opens a DB connection, verified by
      inspection/log audit of the reference implementation.
- [ ] A reference Rust worker (SDK + a sample function) exists (fixture under
      `apps/fsm-core-example/` or a test-only fixture) proving the full path
      end-to-end: worker registers with the gateway → dispatch → claim →
      orchestrator calls the gateway over gRPC → gateway routes to the Rust
      worker over the sidecar socket → response returned → archived.
- [ ] `validateAsyncOperationFromFoldersV2`'s Rust checker (`check_fn.rs`)
      either continues to pass unmodified, or is extended — decided and
      documented in the implementation issue — if the gateway contract requires
      confirming more than "a function with this name exists" (e.g. that a
      worker process actually registers it at startup).
- [ ] Failure modes are handled and covered by the reference implementation:
      worker crash/disconnect mid-invoke (pending invoke rejects with a clear
      error, matching the prototype's `unregisterWorker` cleanup — orchestrator
      does not hang indefinitely), gateway unavailable at startup (surfaced as a
      warning; queue not marked active, matching today's `pgmqQueueExists` guard
      behavior), and clean shutdown drains without leaving orphaned sockets or
      zombie worker processes.
- [ ] Go is explicitly out of scope for the first implementation, but the
      gateway/sidecar contract is already validated as polyglot-ready (the
      prototype proves it with Python and TypeScript worker SDKs) before
      merging, so a Go worker SDK can follow later without a protocol
      renegotiation.

## Implementation

<!-- Filled in after acceptance: links to implementation issues and PRs. -->
