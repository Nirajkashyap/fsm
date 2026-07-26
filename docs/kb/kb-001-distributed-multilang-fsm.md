# KB-001: Distributed, Multi-Language FSM Execution — Architecture & Best Practices

**Status:** Knowledge Base / Design Guidance **Date:** 2026-06-13 (§3, §4
revised 2026-07-22) **Relates to:**
[ADR-002 — Worker Execution Model](../adr/adr-002-worker-execution-model.md),
[SPEC-001 — Polyglot Actor Workers for Compiled Languages](../specs/spec-001-compiled-lang-actor-workers.md)

> **2026-07-22 revision note:** §3 originally described a bounded
> orchestrator-fleet-pulls-and-leases model (Stage 2 in ADR-002's terms) and a
> not-yet-built gateway/broker for the activity tier. Both were overtaken by
> events: ADR-002 Stage 3 (merged 2026-07-01) replaced the pull/lease dispatcher
> with a Kubernetes-style **scheduler + node-agent (kubelet)** split for the
> _orchestrator_ tier (`fsmscheduler` + `fsmlet`) — and the same split was
> independently built for the _activity_ tier (`asyncOperationScheduler` +
> `asyncOperationWorkerlet`), which this KB never described. §3 below is
> rewritten to match the code as of 2026-07-22. The ADR-003/004 this KB used to
> cite for the old model no longer exist as files — both were folded into
> ADR-002 Stage 3 during the 2026-07-01 docs reorg; see that ADR for the
> pre-Stage-3 history instead.

---

## 1. Problem statement

We want a distributed FSM platform where:

1. A single `fsm.json` can have **actors/actions/guards implemented in different
   languages** (TS, Python, Rust, Go…).
2. **Many instances of the same FSM** run concurrently; each instance has its
   own durable queue and is driven forward independently.
3. A worker **starts when an instance is created**, **out-of-band from the API**
   (the HTTP tier never blocks on or owns worker lifecycle).
4. **Database connections (pg Pool objects) are minimized**, even as instance
   count and the number of polyglot actor processes grow.

This KB captures the recommended architecture and the trade-offs behind it.

---

## 2. The core distinction: Orchestrator vs Activity

The single most important idea — borrowed from **Temporal** (workflow vs
activity) and **AWS Step Functions** (state machine vs activity worker):

| Concern                       | What it does                                                                                               | Needs DB?                                                                                                                                                     | Language         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Orchestrator** (FSM driver) | Read instance queue → resolve state → evaluate transitions/guards → run _pure_ actions → persist macrostep | **Yes** (the only DB-touching tier)                                                                                                                           | Fixed (TS today) |
| **Activity worker** (actor)   | Execute one unit of business logic for an `invoke`d actor: take input, do work, return output              | **No** (ideally) — but see §3.2: the node agent that supervises the actor always holds DB connections; only the actor execution itself is meant to be zero-DB | **Any**          |

**Decoupling the two along a queue boundary is what makes the system both
polyglot and connection-frugal.**

---

## 3. Actual architecture (as of 2026-07-22)

The system evolved past a bounded-fleet-pulls-and-leases model into a
**Kubernetes-style scheduler + node-agent split, applied twice** — once for the
orchestrator tier, once for the activity tier. This is not a hypothetical
"recommended" design; it is what the code does today.

```
         POST /fsm/instances / fsmctl        (API: thin, no worker lifecycle)
                │
                ▼
enqueue_fsm_dispatch_v2()                    (PG function, control plane)
  • INSERT fsm_dispatch_queue (status='pending')
  • pg_notify('fsm_scheduler_work', instance_id)
                │
                ▼
┌─────────────────────────────────────────────────────┐
│ fsmscheduler  — control plane, kube-scheduler equiv. │
│ LISTEN fsm_scheduler_work                            │
│ → schedule_next_pending(): SELECT FOR UPDATE SKIP    │
│     LOCKED, score by fsm_modules match + free        │
│     capacity on fsm_daemon_node, UPDATE 'scheduled',  │
│     pg_notify('fsm_fsmlet_work_<id>')  ← push-assign │
└─────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────┐
│ fsmlet fleet — node agents, kubelet equiv.           │
│ (N standing processes, NOT one per instance)         │
│ LISTEN fsm_fsmlet_work_<id>, fsm_worker_stop         │
│ claimScheduledForFsmlet() → startFSMWorkerWithDBLock │
│   (in-process, Semaphore(maxConcurrency)-bounded)    │
│ lock_fsm_instance = defense-in-depth atomic lease    │
│ heartbeat every 5s → fsm_daemon_node                 │
└─────────────────────────────────────────────────────┘
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
│       Rust/Go  → see §3.3 (the actual open problem)  │
│ heartbeat every 5s → async_operation_workerlet       │
└─────────────────────────────────────────────────────┘
                │  result archived by the TS orchestrator
                ▼
back onto the instance's fsm queue → fsmlet resumes the FSM instance
```

### 3.1 Orchestrator tier: `fsmscheduler` + `fsmlet` (Stage 3, ADR-002)

`fsmlet.ts` documents itself as "node agent (kubelet equivalent)" and
`fsmscheduler.ts` as "control-plane routing process (kube-scheduler
equivalent)." This landed 2026-07-01 (commit `8a22689`, "replace pgmq dispatch
with table-scan + pg_notify scheduler model") and fully superseded the old
`run-fsm-dispatch-daemon.ts` pgmq-pull dispatcher this KB used to describe.

The bounded-fleet **mechanics** this KB originally called for are in fact
present: one `fsmlet` process is long-running, holds a `Semaphore` sized by
`maxConcurrency` (default 8) and an `activeWorkers` map, and multiplexes that
many FSM instances concurrently on one event loop — not one process per
instance. That math still holds:

```
connections ≈ (fleet size) × (small pool size)        ← independent of instance count
processes   ≈ fleet size                               ← bounded
```

What's different from the originally-described model is **how an instance gets
to a fsmlet**. There is no anonymous pool of workers racing to pull off a shared
queue and lease via `lock_fsm_instance` alone. Instead a **centralized
`fsmscheduler`** does placement: it claims the oldest pending dispatch entry
from `fsm_dispatch_queue`, scores registered fsmlets in `fsm_daemon_node` by
JSONB module-containment + free capacity, and **push-assigns** the work to one
named fsmlet via that fsmlet's own `pg_notify` channel (`fsm_fsmlet_work_<id>`)
— per ADR-002 §Stage 3: "the node agent (kubelet / fsmlet) should not decide
what to run — it should only run what the scheduler assigns to it."

`lock_fsm_instance` (`fsm-instance-lock.ts`) is still in the code
(`fsmworker.ts:179,188`) but now plays a narrower role: a defense-in-depth
atomic lease taken by `startFSMWorkerWithDBLock` immediately under the
scheduler's assignment, not the primary dispatch mechanism.

### 3.2 Activity tier: `asyncOperationScheduler` + `asyncOperationWorkerlet` (mirrors §3.1 exactly)

This tier was **not described anywhere in the earlier version of this KB** — it
was built after 2026-06-13 and mirrors §3.1 one-to-one rather than following the
gateway/broker design the original 2026-06-13 KB recommended for this boundary
(see §3.3 for where that transport question stands today).

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

So the "activity worker" in §2's table is really **two things bundled
together**, with different DB-connection stories:

1. **The workerlet itself (control-plane facing)** — registration, heartbeat,
   claim, its dedicated LISTEN connection. This **always** holds DB connections,
   by design, exactly like a fsmlet does. This part of the activity tier was
   never going to be zero-DB once it became a kubelet — the "Needs DB? No
   (ideally)" cell in §2's table only ever applied to the next layer down.
2. **The per-actor-language execution the workerlet supervises**
   (`startPromiseWorkerForLang`) — this is where "zero DB connections in the
   polyglot worker" is actually won or lost, and today it is **not** won for
   every language. See §3.3.

No gateway or broker process exists anywhere in the current code — the Activity
Gateway prototyped 2026-06-14 was reverted 2026-06-23 as "too complex for now",
and the system's actual answer to "how do we decouple the activity tier" turned
out to be _another_ scheduler/kubelet pair, not the gateway/broker this KB
recommended.

### 3.3 The open problem: how should `asyncOperationWorkerlet` do polyglot?

Inside `startPromiseWorkerForLang` (`asyncOperationWorkerlet.ts:92–145`), the
per-language dispatch is uneven, and this is a concrete, current gap — not a
future hypothetical:

| Language   | Mechanism                                                      | Holds its own DB connection?                                                      |
| ---------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| TypeScript | in-process, `import()`, polls PGMQ via `startFSMPromiseWorker` | No — shares the workerlet's own pool (fine; same process)                         |
| Python     | `Deno.Command` subprocess running `fsmpromiseworker.py`        | **Yes** — its own `psycopg2` connection, independent poll → invoke → archive loop |
| Rust       | — (see below)                                                  | n/a — nothing runs today                                                          |
| Go         | — (see below)                                                  | n/a — nothing runs today                                                          |

Python's path is exactly **Option A** below: one more DB connection per active
queue, growing with actor traffic, independent of
`fsm_dispatch_queue`/`fsm_daemon_node` connection counts. It works in production
today but is an accepted stopgap, not the target state. Rust and Go have **no
implementation at all** — `startPromiseWorkerForLang` just logs
`"Promise worker for lang={lang} not yet implemented"` and returns.

Transport options for this boundary are on the table (kept from the earlier
version of this KB, since the trade-offs are unchanged even though the
surrounding architecture is) — **none is decided in this KB**. This is the open
problem SPEC-001 (Draft, issue #55) is working through:

| Option                                         | Polyglot worker connects to                                                                 | DB conns from actor execution                              | Notes                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **A. Direct pgmq/PG**                          | Postgres (pg client per lang)                                                               | **High** — every actor process holds PG conns              | Simplest, but every extra language = more PG connections. **This is Python's current path.** |
| **B. Activity Gateway**                        | A thin gRPC/HTTP service that owns the pool                                                 | **Low** — only the gateway pool                            | Prototyped 2026-06-14, reverted 2026-06-23 as too complex for the need at the time.          |
| **C. Local IPC to the supervising node agent** | The `asyncOperationWorkerlet` itself, over some local transport (e.g. a Unix domain socket) | **Zero** — the actor process opens no DB connection at all | No new service; reuses the workerlet's own lifecycle machinery.                              |

Fixing Rust/Go the same way Python was fixed (Option A: a subprocess that owns
its own PG connection) would repeat Option A's connection-growth problem once
more per compiled language. Re-attempting the reverted Activity Gateway (Option
B) remains a candidate, weighed against its earlier "too complex for now"
verdict, given there is still no live actor blocked on this today. Which option
(or a variant) is right — and the transport, container-vs-plain- subprocess, and
warm-vs-cold-per-message questions underneath it — is what SPEC-001 is
resolving. See that spec for the full options analysis, decision drivers, and
acceptance criteria. As of this revision the spec is **Draft**: no option has
been accepted, and Python's own-connection model plus the Rust/Go gap both still
exist in the code today.

### 3.4 Connection accounting, updated

There is no gateway/broker tier in this system and none is planned. The actual
connection-holding tiers today are:

- `fsmscheduler` (1 dedicated LISTEN connection, control plane)
- `asyncOperationScheduler` (1 dedicated LISTEN connection, control plane)
- Each `fsmlet` (1 pool + 1 dedicated LISTEN connection for
  `fsm_fsmlet_work_<id>`/`fsm_worker_stop`)
- Each `asyncOperationWorkerlet` (1 pool + 1 dedicated LISTEN connection for
  `async_op_workerlet_work_<id>`)
- Each active **Python** promise-worker subprocess (1 `psycopg2` connection,
  scales with active queues — the still-open gap from §3.3)

Two schedulers + a LISTEN connection per fsmlet/workerlet node is a real, if
small, addition to the connection budget that the original bounded-fleet model
didn't account for — worth remembering when sizing the pooler below. Whether
Rust/Go add zero connections once SPEC-001 lands depends on which option it
settles on (§3.3): Option C would; Option A would not.

### 3.5 Put a connection pooler in front of Postgres — non-negotiable at scale

Regardless of the above, run **PgBouncer** (or **Supabase Supavisor**) in
**transaction pooling** mode. Logical pools in every worker then multiplex onto
a tiny set of physical backend connections.

- Keep each worker `Pool` **small** (e.g. `max: 2–5`). The FSM model is
  queue-bound, not connection-bound — workers spend most time waiting on pgmq,
  not holding a connection.
- Net physical connections = `pooler backend size` (a fixed, tuned number),
  **not** `Σ worker pools`.
- Caveat: transaction-mode pooling disallows session-level features (some
  prepared statements, `LISTEN/NOTIFY`, advisory **session** locks). Note: the
  codebase uses `pgListenerForWorkerStopEvent` (`LISTEN` on `fsm_worker_stop`) —
  **`LISTEN` needs a session connection**, so give the LISTEN consumer a
  _direct_ connection (bypass the transaction pooler) and route everything else
  through the pooler.

---

## 4. Distributed-systems best practices that apply here

- **At-least-once, design for idempotency.** pgmq + visibility timeout =
  at-least-once. Every actor and every macrostep must tolerate redelivery (use
  `correlation_id` / msg dedup; the macrostep already keys off DB state, which
  helps).
- **The queue is the contract.** Decouple tiers by message schema, not by shared
  code/imports. Version the message payload.
- **Lease, don't assign — except this system deliberately does both.** The
  original guidance here was "workers pull and lock; never push-assign an
  instance to a named worker." ADR-002 Stage 3 explicitly chose the opposite for
  both tiers: `fsmscheduler`/`asyncOperationScheduler` push-assign to a _named_
  fsmlet/workerlet via a per-node `pg_notify` channel, precisely to get a
  cluster-wide, capacity-aware placement view that a leaderless pull model can't
  provide (module-match routing, "don't route to a node at capacity").
  `lock_fsm_instance` is kept as a second, defense-in-depth lease underneath the
  push-assignment — so the system gets both properties, at the cost of the
  scheduler becoming a control-plane component whose availability now matters
  (if all schedulers are down, nothing gets assigned even though
  fsmlets/workerlets are healthy and idle).
- **Backpressure = bounded fleet.** Concurrency is capped by fleet size ×
  per-worker concurrency, itself capped by pool/pooler capacity (see ADR-002
  §Stage 3, "Backpressure is real" — the scheduler checks `active_workers` vs
  `max_concurrency` before assigning, rather than a worker self-limiting after
  already dequeuing). Prefer bounding here over unbounded process spawning.
- **Fault isolation per tier:** an actor crash must not kill the orchestrator;
  an orchestrator crash must release leases (it does — `cleanup()`/visibility
  timeout, plus a dead fsmlet's stale `fsm_daemon_node` heartbeat rows are
  ignored by the scheduler after 30s).
- **Observability:** propagate `instance_id` + `correlation_id` through every
  queue hop for end-to-end tracing across languages.
- **Separate scaling axes:** API, orchestrator fleet, and each language's
  activity fleet scale independently. None should force-scale another.
- **Keep PG the source of truth** (matches CLAUDE.md): state/locks/queues stay
  in PG; compute fleets are stateless and disposable.

---

## 5. Prior art to mirror

- **Temporal** — workflow (orchestrator) vs activity (polyglot worker); bounded
  worker fleets polling task queues; per-worker multiplexing of many executions.
  Still the right mental model for the orchestrator/activity **split itself**
  (§2), and for the "polyglot via a queue boundary, not `import()`" idea.
- **AWS Step Functions** — state machine vs "activity workers" (any language)
  that poll for tasks and return results.
- **Cadence / Netflix Conductor** — same orchestrator/worker split with polyglot
  SDKs.
- **Kubernetes** (`kube-apiserver` / `kube-scheduler` / `kubelet`) — the model
  actually chosen for _dispatch_, per ADR-002 Stage 3. This is a real divergence
  from Temporal worth naming explicitly: Temporal's workers **pull** from a
  shared task queue and lease work themselves (no central placement decision);
  this system's schedulers **push-assign** to a specific, named node after a
  capacity/module-match scoring pass. Both are valid distributed-worker
  patterns, but they answer "how does a worker get work?" in opposite ways — see
  §4's "Lease, don't assign" entry for the trade-off this bought.

The chosen design, for both the orchestrator and the activity tier, is closer to
**Kubernetes' scheduler/kubelet split** than to Temporal's worker-fleet model,
with **Postgres doing double duty as etcd (state) and the task-queue substrate**
instead of a dedicated scheduler server or message broker.
