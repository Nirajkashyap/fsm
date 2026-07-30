# ADR-003: Polyglot Actor Execution Model — Activity-Tier Architecture & Compiled-Language IPC

| Field      | Value                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Status     | Architecture: Current. Compiled-language IPC decision: **Decided, not yet implemented** (issue #55)                     |
| Date       | 2026-06-13 (architecture), 2026-07-22 (compiled-language IPC decision)                                                  |
| Deciders   | Niraj (architecture); Niraj, Claude (IPC decision)                                                                      |
| Affects    | `apps/fsm-core-worker-ts`, `packages/fsm-compiler-ts`, `apps/fsm-core-example`                                          |
| Supersedes | `docs/kb/kb-001-distributed-multilang-fsm.md`, `docs/specs/spec-001-compiled-lang-actor-workers.md`                     |
| Related    | [ADR-002](adr-002-worker-execution-model.md) — orchestrator tier (this ADR is its activity-tier counterpart); Issue #55 |

---

## Context

We want a distributed FSM platform where:

1. A single `fsm.json` can have **actors/actions/guards implemented in different
   languages** (TS, Python, Rust, Go…).
2. **Many instances of the same FSM** run concurrently; each instance has its
   own durable queue and is driven forward independently.
3. A worker **starts when an instance is created**, **out-of-band from the API**
   (the HTTP tier never blocks on or owns worker lifecycle).
4. **Database connections (pg Pool objects) are minimized**, even as instance
   count and the number of polyglot actor processes grow.

The core distinction — borrowed from **Temporal** (workflow vs activity) and
**AWS Step Functions** (state machine vs activity worker):

| Concern                       | What it does                                                                                               | Needs DB?                                                                                                                                                                                                                                           | Language         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Orchestrator** (FSM driver) | Read instance queue → resolve state → evaluate transitions/guards → run _pure_ actions → persist macrostep | **Yes** (the only DB-touching tier)                                                                                                                                                                                                                 | Fixed (TS today) |
| **Activity worker** (actor)   | Execute one unit of business logic for an `invoke`d actor: take input, do work, return output              | **No** (ideally) — but see [Activity Tier Detail](#activity-tier-detail-asyncoperationscheduler--asyncoperationworkerlet): the node agent supervising the actor always holds DB connections; only the actor execution itself is meant to be zero-DB | **Any**          |

**Decoupling the two along a queue boundary is what makes the system both
polyglot and connection-frugal.** ADR-002 covers how this split is implemented
for the orchestrator (FSM instance) tier — `fsmscheduler` + `fsmlet`, a
Kubernetes-style scheduler/kubelet pair. This ADR covers the same split applied
to the **activity tier**, and the specific decision on how compiled-language
(Rust/Go) actors execute within it.

---

## Architecture (as of 2026-07-22)

The activity tier mirrors ADR-002's Stage 3 orchestrator-tier model — a
Kubernetes-style scheduler + node-agent split, applied a second time:

```
         POST /fsm/instances / fsmctl        (API: thin, no worker lifecycle)
                │
                ▼
enqueue_fsm_dispatch_v2()                    (PG function, control plane)
  • INSERT fsm_dispatch_queue (status='pending')
  • pg_notify('fsm_scheduler_work', instance_id)
                │
                ▼
        fsmscheduler → fsmlet fleet          (orchestrator tier — see ADR-002 Stage 3)
                │  on xstate.invoke(actor)
                ▼
create_promise_queue_and_send_event_from_fsm_instance_id_v2()
  • INSERT async_operation_instance_and_async_operation_workerlet (status='pending')
  • pg_notify('async_operation_scheduler_work')
                │
                ▼
┌─────────────────────────────────────────────────────┐
│ asyncOperationScheduler — control plane,             │
│ kube-scheduler equiv. for the ACTIVITY tier          │
│ LISTEN async_operation_scheduler_work                │
│ → async_operation_schedule_next_pending(): SELECT    │
│     FOR UPDATE SKIP LOCKED, score by supported-op    │
│     match + free capacity, UPDATE, pg_notify         │
│     ('async_op_workerlet_work_<id>')  ← push-assign  │
└─────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────┐
│ asyncOperationWorkerlet fleet — node agents, kubelet │
│ equiv. for the ACTIVITY tier                         │
│ LISTEN async_op_workerlet_work_<id>                  │
│ claimScheduledForAsyncOperationWorkerlet()           │
│ → startPromiseWorkerForLang(): one warm worker per   │
│     active queue, dispatched by fsmLanguage:         │
│       TS      → in-process, shares workerlet's Pool  │
│       Python   → subprocess, OWN psycopg2 connection │
│       Rust/Go  → local IPC (see Decision below)      │
│ heartbeat every 5s → async_operation_workerlet       │
└─────────────────────────────────────────────────────┘
                │  result archived by the TS orchestrator
                ▼
back onto the instance's fsm queue → fsmlet resumes the FSM instance
```

### Activity tier detail: `asyncOperationScheduler` + `asyncOperationWorkerlet`

- `asyncOperationScheduler.ts` doc comment: "Async-operation scheduler —
  control-plane routing process (kube-scheduler equivalent) for async-operation
  workerlets." It LISTENs on `async_operation_scheduler_work`, calls
  `async_operation_schedule_next_pending()` (claim + filter/score + assign +
  notify in one PG transaction, scanning
  `async_operation_instance_and_async_operation_workerlet` and
  `async_operation_workerlet`), and push-assigns to one named workerlet via
  `async_op_workerlet_work_<id>`.
- `asyncOperationWorkerlet.ts` doc comment: "Async-operation workerlet — node
  agent (analogous to fsmlet)." It registers in `async_operation_workerlet`,
  LISTENs on its own channel, claims assigned work via
  `claimScheduledForAsyncOperationWorkerlet`, and runs **one long-running worker
  per active actor queue**, tracked in the same `Semaphore` + `activeWorkers`
  shape as `fsmlet`.

So the "activity worker" in the Context table above is really **two things
bundled together**, with different DB-connection stories:

1. **The workerlet itself (control-plane facing)** — registration, heartbeat,
   claim, its dedicated LISTEN connection. This **always** holds DB connections,
   by design, exactly like a fsmlet does. This part of the activity tier was
   never going to be zero-DB once it became a kubelet — "Needs DB? No (ideally)"
   only ever applied to the next layer down.
2. **The per-actor-language execution the workerlet supervises**
   (`startPromiseWorkerForLang`) — this is where "zero DB connections in the
   polyglot worker" is actually won or lost, and until this ADR's decision below
   it was not won for every language.

No gateway or broker process exists in the current code — an Activity Gateway
was prototyped 2026-06-14 and reverted 2026-06-23 as "too complex for now"; the
system's actual answer to decoupling the activity tier turned out to be
_another_ scheduler/kubelet pair, not a gateway/broker.

### Connection accounting

- `fsmscheduler` (1 dedicated LISTEN connection, control plane)
- `asyncOperationScheduler` (1 dedicated LISTEN connection, control plane)
- Each `fsmlet` (1 pool + 1 dedicated LISTEN connection for
  `fsm_fsmlet_work_<id>`/`fsm_worker_stop`)
- Each `asyncOperationWorkerlet` (1 pool + 1 dedicated LISTEN connection for
  `async_op_workerlet_work_<id>`)
- Each active **Python** promise-worker subprocess (1 `psycopg2` connection,
  scales with active queues — an accepted stopgap, not the target state)

Two schedulers + a LISTEN connection per fsmlet/workerlet node is a real, if
small, addition to the connection budget — worth remembering when sizing the
pooler below.

### Put a connection pooler in front of Postgres — non-negotiable at scale

Regardless of the above, run **PgBouncer** (or **Supabase Supavisor**) in
**transaction pooling** mode. Logical pools in every worker then multiplex onto
a tiny set of physical backend connections.

- Keep each worker `Pool` **small** (e.g. `max: 2–5`). The FSM model is
  queue-bound, not connection-bound — workers spend most time waiting on pgmq,
  not holding a connection.
- Net physical connections = `pooler backend size` (a fixed, tuned number),
  **not** `Σ worker pools`.
- Caveat: transaction-mode pooling disallows session-level features (some
  prepared statements, `LISTEN/NOTIFY`, advisory **session** locks). The
  codebase uses `pgListenerForWorkerStopEvent` (`LISTEN` on `fsm_worker_stop`) —
  **`LISTEN` needs a session connection**, so give the LISTEN consumer a
  _direct_ connection (bypass the transaction pooler) and route everything else
  through the pooler.

### Distributed-systems practices that apply here

- **At-least-once, design for idempotency.** pgmq + visibility timeout =
  at-least-once. Every actor and every macrostep must tolerate redelivery (use
  `correlation_id` / msg dedup; the macrostep already keys off DB state, which
  helps).
- **The queue is the contract.** Decouple tiers by message schema, not by shared
  code/imports. Version the message payload.
- **Push-assign, with a defense-in-depth lease underneath.** Both
  `fsmscheduler`/`asyncOperationScheduler` push-assign to a _named_
  fsmlet/workerlet via a per-node `pg_notify` channel, to get a cluster-wide,
  capacity-aware placement view that a leaderless pull model can't provide
  (module-match routing, "don't route to a node at capacity").
  `lock_fsm_instance` is kept as a second, atomic lease underneath the
  push-assignment — so the system gets both properties, at the cost of the
  scheduler becoming a control-plane component whose availability now matters.
- **Backpressure = bounded fleet.** Concurrency is capped by fleet size ×
  per-worker concurrency, itself capped by pool/pooler capacity — the scheduler
  checks `active_workers` vs `max_concurrency` before assigning, rather than a
  worker self-limiting after already dequeuing.
- **Fault isolation per tier:** an actor crash must not kill the orchestrator;
  an orchestrator crash must release leases (`cleanup()`/visibility timeout,
  plus a dead fsmlet's stale `fsm_daemon_node` heartbeat rows are ignored by the
  scheduler after 30s).
- **Observability:** propagate `instance_id` + `correlation_id` through every
  queue hop for end-to-end tracing across languages.
- **Separate scaling axes:** API, orchestrator fleet, and each language's
  activity fleet scale independently. None should force-scale another.
- **Keep PG the source of truth** (matches CLAUDE.md): state/locks/queues stay
  in PG; compute fleets are stateless and disposable.

### Prior art

- **Temporal** — workflow (orchestrator) vs activity (polyglot worker); bounded
  worker fleets polling task queues; per-worker multiplexing of many executions.
  Still the right mental model for the orchestrator/activity **split itself**,
  and for "polyglot via a queue boundary, not `import()`".
- **AWS Step Functions** — state machine vs "activity workers" (any language)
  that poll for tasks and return results.
- **Cadence / Netflix Conductor** — same orchestrator/worker split with polyglot
  SDKs.
- **Kubernetes** (`kube-apiserver` / `kube-scheduler` / `kubelet`) — the model
  actually chosen for _dispatch_ (ADR-002 Stage 3, applied here to the activity
  tier too). A real divergence from Temporal worth naming: Temporal's workers
  **pull** from a shared task queue and lease work themselves (no central
  placement decision); this system's schedulers **push-assign** to a specific,
  named node after a capacity/module-match scoring pass.

The chosen design, for both tiers, is closer to **Kubernetes' scheduler/kubelet
split** than to Temporal's worker-fleet model, with **Postgres doing double duty
as etcd (state) and the task-queue substrate** instead of a dedicated scheduler
server or message broker.

---

## Decision: Compiled-Language Actors via Local IPC

### Problem

`asyncOperationWorkerlet.ts`'s `startPromiseWorkerForLang` (line ~92) dispatches
a claimed promise-actor invocation by `fsmLanguage`:

- `"typescript"` — in-process, dynamic `import()`, polls PGMQ itself
  (`startFSMPromiseWorker`).
- `"python"` — spawns `fsmpromiseworker.py` as a subprocess, but that subprocess
  _also_ opens its own `psycopg2` connection and runs its own independent poll →
  invoke → archive loop.
- `"go"` / `"rust"` — logs
  `"Promise worker for lang={lang} not yet implemented"` and returns. **No
  worker runs at all.**

The go/rust gap isn't a small wiring fix:
`validateAsyncOperationFromFoldersV2`'s checkers for these languages
(`check_fn.go`, `check_fn.rs`) only do a **static syntax check** (AST scan for
Go, substring match for Rust) — there is no existing mechanism to dynamically
invoke a compiled Go or Rust function the way `import()` does for TS or
`importlib` does for Python. An actual invocation path has to be designed, not
patched in.

No specific actor is blocked on this today — this was proactive design work to
close a known, documented gap (the `"not yet implemented"` log line has existed
since the go/rust branches were stubbed) before it becomes a blocker.

### Constraints

- **Orchestrator vs. activity split**: only the orchestrator tier touches the
  DB/queue; activity workers (actors) should ideally hold **zero** DB
  connections (see Context and Connection Accounting above).
- **Connection minimization**: DB connections must not scale with the number of
  polyglot actor processes. Today's Python path (one `psycopg2` connection per
  active queue) is an accepted stopgap, not the target state.
- **Polyglot via queue, not via transport rebuild**: a full gateway (gRPC/HTTP
  service, its own deployment, wire contract, SDK) was prototyped 2026-06-14 and
  **reverted 2026-06-23 as "too complex for now"**. Reintroducing that scope is
  explicitly out of bounds for this decision — it must stay smaller than that
  reverted prototype.
- **Kubelet analogy already established**: `asyncOperationWorkerlet.ts`'s own
  doc comment and ADR-002 (Stage 3) both use the Kubernetes kubelet/scheduler
  framing. This decision keeps that framing rather than introducing a new mental
  model.
- **No confirmed container runtime** in the deploy target. The design must not
  require Docker/Podman; a plain compiled-binary subprocess is the default.
- **No live Go/Rust actor exists yet** — acceptance is proven with a reference
  fixture, not a production migration.
- **WASM-in-Deno ruled out explicitly**: compiling actors to WASM and running
  them in-process (like TS's `import()`) was considered and rejected — real
  actor business logic needs full OS access (outbound network calls, file I/O,
  native libs), which WASM sandboxing would block.

### Options considered

**A. Direct-connection worker per language (extend today's Python model to
Rust)** — a Rust subprocess owns its own DB connection, polls PGMQ directly,
calls the actor function in-process, and archives the result, mirroring
`fsmpromiseworker.py` exactly. Pros: zero new design; precedent already works in
production for Python. Cons: adds one DB connection per active queue, directly
violating the connection-minimization goal; duplicates the full
poll/archive/error-handling logic per language with no shared harness.

**B. Revive the full Activity Gateway (gRPC/HTTP service)** — rebuild the
reverted 2026-06-14 prototype: a standalone gateway service owning the only DB
pool, polyglot workers talking to it over gRPC/HTTP holding zero DB connections.
Pros: general solution for _any_ number of languages/processes. Cons: this is
the scope that was already tried and explicitly reverted as too complex; adds a
new network service to deploy, secure, and monitor, for a need with no live
actor driving it today.

**C. Orchestrator-held poll + warm per-queue subprocess + Unix domain socket IPC
(chosen)** — the TS orchestrator (`asyncOperationWorkerlet.ts`) keeps 100% of
PGMQ poll/claim/archive logic — nothing moves out of it. For `"rust"` (and later
`"go"`), `startPromiseWorkerForLang` launches one warm subprocess per active
queue (`Deno.Command`, no container), tracked in `activeWorkers` and killed via
the existing `AbortController`/signal pattern — the same lifecycle shape
Python's subprocess already uses. Instead of the subprocess polling PGMQ itself,
the orchestrator sends it one request at a time over a **Unix domain socket**
and awaits the response; the subprocess never opens a DB connection. A single
generic "poll + dispatch-over-socket" harness is written once in TS and reused
for every compiled language. Pros: zero DB connections in the polyglot worker;
one harness reused across languages instead of a bespoke poller per language; no
container runtime dependency; socket transport avoids the risk of an actor's own
`println!`/log output corrupting a shared-stdio protocol; rollback is trivial.
Cons: one request in flight per process at a time (matches today's
single-consumer-per-queue model everywhere else); introduces a new small
protocol/contract to maintain; adds one indirection hop for debugging (TS ↔
socket ↔ compiled process) versus in-process TS.

**D. Do nothing** — leave go/rust unimplemented until an actor needs it. Pros:
zero effort now. Cons: the gap is already documented and known; deferring means
the first real Go/Rust actor request becomes blocked on this design landing on
the critical path.

### Decision drivers

**Option C**, in order:

1. **Zero DB connections on the polyglot side** — the one property Option A
   fails and Option C achieves without Option B's cost.
2. **Reuse over rebuild** — Option C reuses existing lifecycle machinery
   (`activeWorkers`, `AbortController`, the lazy-compile-and-cache pattern
   already used for `check_fn.go`/`check_fn.rs`) rather than introducing a new
   service class.
3. **No new infra requirement** — ruled out containers (unconfirmed runtime) and
   a gateway service (new deployable) in favor of a subprocess + socket, both of
   which are things this codebase already does today (Python subprocess,
   LISTEN-based sockets from Postgres).
4. **Protocol robustness** — Unix domain socket over stdin/stdout specifically
   to avoid a corrupted-framing failure mode where the actor's own output
   pollutes the RPC channel.

**First reference implementation targets Rust.** Go follows later against the
same contract (reusing `check_fn.go`'s existing AST-based validation approach
for its own checker); the contract is written generically enough that adding Go
should not require renegotiating the protocol.

### Consequences & migration

- **No migration required.** Go/Rust have zero workers today — this is net-new
  capability. TS and Python branches of `startPromiseWorkerForLang` are
  untouched.
- **What gets harder**: one more artifact type to build/ship per compiled
  language (a shim binary conforming to the socket contract); one more contract
  to keep stable as languages are added; debugging a Rust actor invocation now
  involves a socket hop instead of a single in-process call.
- **Rollback story**: the new code path is fully gated on
  `fsmLanguage === "rust"` (soon `"go"`) inside `startPromiseWorkerForLang`.
  Reverting means restoring the no-op/log-warning branch — no impact on TS or
  Python actors, no schema or data migration to undo.
- **Explicitly deferred, not solved by this decision**: per-actor dependency
  isolation (e.g. two Rust actors needing incompatible native library versions)
  — this would need containers or per-actor build isolation, out of scope given
  the "no confirmed container runtime" constraint. If that need arises,
  containerizing the same socket-shim subprocess is a compatible future upgrade,
  not a redesign.

### Acceptance criteria

- [ ] A language-neutral shim contract is documented: request/response JSON
      shape, socket framing (e.g. length-prefixed or newline-delimited over the
      Unix socket), startup handshake, one-request-at-a-time semantics, and
      graceful-shutdown signal — reusing the activity contract shape already
      defined above (`{actor, version, input, instance_id, correlation_id}` →
      `{output | error}`) rather than inventing a new shape.
- [ ] `startPromiseWorkerForLang`'s `"rust"` branch launches a warm subprocess
      per active queue via `Deno.Command` (no container), tracked in
      `activeWorkers` and terminated via the existing
      `signal.addEventListener("abort", ...)` pattern already used for Python.
- [ ] The TS orchestrator retains sole ownership of `readMessage` (PGMQ poll)
      and `archiveEventFromFsmPromiseTypeWorker` (archive) — the Rust subprocess
      never opens a DB connection, verified by inspection/log audit of the
      reference implementation.
- [ ] A reference Rust actor + shim exists (fixture under
      `apps/fsm-core-example/` or a test-only fixture) proving the full path
      end-to-end: dispatch → claim → orchestrator forwards over the Unix socket
      → Rust shim executes the actor function → response returned → archived.
- [ ] `validateAsyncOperationFromFoldersV2`'s Rust checker (`check_fn.rs`)
      either continues to pass unmodified, or is extended — decided and
      documented in the implementation issue — if the shim contract requires
      confirming more than "a function with this name exists" (e.g. a specific
      entrypoint that speaks the socket protocol).
- [ ] Failure modes are handled and covered by the reference implementation:
      subprocess crash mid-request (orchestrator does not hang indefinitely —
      timeout/abort path required), socket connect failure at startup (surfaced
      as a warning; queue not marked active, matching today's `pgmqQueueExists`
      guard behavior), and clean shutdown drains without leaving orphaned
      sockets or zombie processes.
- [ ] Go is explicitly out of scope for the first implementation, but the shim
      contract is validated as polyglot-ready (not Rust-specific) before
      merging, so a Go shim can follow later without a protocol renegotiation.

### Implementation

<!-- Filled in after acceptance: links to implementation issues and PRs. Tracked under issue #55. -->
</content>
