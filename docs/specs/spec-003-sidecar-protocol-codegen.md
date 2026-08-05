# SPEC-003: Codegen the Sidecar Wire Protocol (worker-sdk-protocol.eta → buf)

| Field   | Value                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status  | Draft                                                                                                                                                 |
| Date    | 2026-08-05                                                                                                                                            |
| Authors | Niraj, Claude                                                                                                                                         |
| Issue   | #88                                                                                                                                                   |
| Affects | `packages/fsm-core-async-op-worker` (`src/sidecar/protocol.ts`), `packages/fsm-compiler-ts` (`worker-sdk-protocol.eta`), `packages/fsm-proto-codegen` |

---

## Problem

The Activity Gateway's worker-facing sidecar protocol — the `register` /
`register_ack` / `invoke` / `invoke_result` / `invoke_error` / `heartbeat` /
`cancel` / `unregister` envelope and body shapes defined in
`packages/fsm-core-async-op-worker/src/sidecar/protocol.ts` — is hand-ported to
Python, Rust, and Go by `fsm-compiler-ts`'s `worker-sdk-protocol.eta` templates
(TypeScript's generated `sdk.ts` imports `protocol.ts` directly instead, since
it's the same runtime).

There is no compiler or build-time check that the 4 language copies stay
structurally in sync. If a field is added, renamed, or removed in `protocol.ts`,
nothing catches a stale `worker-sdk-protocol.eta` port until it fails at runtime
— on the wire, cross-language, with no schema to diff against. This is exactly
the class of bug `fsm-proto-codegen` (buf + `activity-gateway.proto`) was built
to eliminate on the _client_-facing side of the gateway (#86); the sidecar
(worker-facing) side still has it.

## Constraints

- **ADR-003 (Activity Gateway revision, 2026-07-26)** established the sidecar's
  length-prefixed-frame-over-Unix-socket transport specifically to avoid a
  corrupted-framing failure mode where an actor's own stdout output could
  pollute the RPC channel. This spec does not touch the transport (still a Unix
  socket, still length-prefixed frames) — only what's inside the frame. If
  Option B below is chosen, it amends ADR-003's frame _body_ format (JSON →
  protobuf bytes), not the framing/transport decision itself.
- **Connection model**: unlike `activity-gateway.proto`'s `Invoke`/
  `ListRegisteredActors` (client calls, unary request/response), the sidecar
  protocol is not unary. The **worker** initiates the connection and pushes
  `register`/`heartbeat`; the **gateway** pushes `invoke` calls back
  _unsolicited_ on the same connection. Any redesign must preserve this
  worker-initiates, gateway-pushes-invoke shape — it's what lets a worker
  process register once and serve invocations indefinitely without the gateway
  needing to know how to reach it externally.
- **No streaming codegen precedent in this repo yet.** `fsm-proto-codegen` has
  only been proven for unary RPCs (`activity-gateway.proto`). Go/Rust gRPC
  bidi-streaming codegen and runtime plumbing (stream pump loops, cancellation,
  backpressure) is unproven here.
- **Debuggability during active development**: the sidecar protocol is still
  being revised (ADR-003 itself has been revised twice). Length-prefixed JSON is
  readable by attaching to the socket directly (`nc`, a raw read loop) with no
  decoder; this has been useful during the Activity Gateway's own bring-up.

## Options considered

### Option A — Protobuf-ize the message schemas only, keep the existing framing

Define `.proto` messages for the envelope and each body type (`RegisterBody`,
`InvokeBody`, `InvokeResultBody`, `InvokeErrorBody`, `RegisterAckBody`, etc. —
mirroring `sidecar/protocol.ts`'s existing interfaces field-for-field). Generate
per-language types via `fsm-proto-codegen`. Swap `body: Record<string, unknown>`
(JSON) for a serialized protobuf message inside the _same_ length-prefixed frame
`sidecar/protocol.ts` already writes/reads. `gateway.ts`'s register → heartbeat
→ invoke control flow, and each worker SDK's connection loop, don't change —
only the serialization step does (`JSON.stringify`/`.parse` →
`toBinary`/`fromBinary`).

- **Pros**: directly fixes the actual pain (schema drift across 4 hand-ported
  copies) with a single source of truth; small, contained diff — no change to
  connection lifecycle, retry, or heartbeat logic in any of the 4 SDKs or
  `gateway.ts`; reuses `fsm-proto-codegen` exactly as it already works today
  (only unary-shaped message types, no streaming codegen needed).
- **Cons**: binary frames are no longer human-readable on the wire without a
  decoder; still a bespoke framing scheme (buf/protobuf gives you message
  schemas, not socket framing — `sidecar/protocol.ts` keeps hand-rolling the
  length-prefix read/write loop, just as it does today for JSON).

### Option B — Move the sidecar leg onto real gRPC bidi-streaming

Replace the custom envelope/framing entirely with a gRPC bidi-streaming service
(worker opens a stream, gateway pushes `Invoke` messages down it, worker pushes
results back up it), reusing the Unix-socket-over-HTTP2 approach already proven
for `gatewayClient.ts`/`gatewayServer.ts` (#86). Converges both gateway
boundaries (client-facing and worker-facing) onto one networking model and
codegen pipeline.

- **Pros**: one transport/codegen story for the whole gateway, not two; gets
  HTTP/2-level flow control and cancellation propagation for free.
- **Cons**: real architecture change, not a serialization swap — rewrites
  `sidecar/gateway.ts`'s connection handling and every worker SDK's
  connect/register/invoke loop; requires bidi-streaming codegen and runtime code
  in Go and Rust that this repo has no working example of yet (higher risk of
  getting the stream-pump/cancellation logic wrong per language); gives up
  JSON's raw-socket readability during a protocol that's still actively being
  revised.

## Decision

**Recommend Option A.** It captures the concrete, present pain — schema drift
across 4 hand-maintained copies — for a fraction of Option B's cost and risk.
Option B's appeal (one unified transport model) is mostly aesthetic against
today's actual problem; nothing currently requires HTTP/2 flow control or true
bidi-streaming semantics that the existing register/heartbeat/invoke-push model
doesn't already provide by hand. If a concrete need for real streaming semantics
(backpressure, mid-call cancellation propagated from the gateway to a specific
in-flight invoke) shows up later, Option B remains available as a follow-up —
Option A does not foreclose it, since the message schemas it defines are still
valid gRPC service message types if the transport is revisited later.

Open for review/override: this is a Draft, not yet Accepted.

## Consequences & migration

- **What gets harder**: adding a new sidecar message field now requires
  regenerating stubs (`buf generate`) rather than editing 4 files by hand — a
  net win for correctness, marginal friction increase for the edit itself.
- **Migration path**: additive — introduce the `.proto` schemas and
  `fsm-proto-codegen` output alongside the existing hand-ported
  `worker-sdk-protocol.eta` templates, cut over `sidecar/protocol.ts` and one
  language's worker SDK at a time, verified end-to-end (same bar as #86:
  actually run the generated code against a live gateway/worker pair, not just
  type-check/compile it), before deleting the old Eta templates.
- **Rollback story**: until the old `worker-sdk-protocol.eta` templates are
  deleted, reverting means pointing `writeWorkerSdk` back at them — no wire
  format is shared externally (this is an internal gateway↔worker contract), so
  there's no external compatibility break to manage either way.
- **ADR-003 impact**: this spec amends ADR-003's sidecar frame-body format (JSON
  → protobuf bytes inside the same length-prefixed frame), not its
  transport/framing decision. ADR-003 should get a short revision note pointing
  at this spec once accepted, the same way the 2026-07-26 Activity Gateway
  revision itself was recorded.

## Acceptance criteria

- [ ] `.proto` message definitions exist for every `sidecar/protocol.ts` body
      type (`RegisterBody`, `RegisterAckBody`, `InvokeBody`, `InvokeResultBody`,
      `InvokeErrorBody`) and the `WireEnvelope`, field-for- field equivalent to
      the current TypeScript interfaces.
- [ ] `fsm-proto-codegen` generates working stubs for all 4 languages from these
      definitions (same verification bar as #86: actually built/run against the
      generated output per language, not just generated).
- [ ] `sidecar/protocol.ts` and at least one other language's worker SDK are
      migrated to serialize/deserialize the frame body as protobuf bytes instead
      of JSON, verified end-to-end against a live gateway/worker pair over a
      real Unix socket.
- [ ] `worker-sdk-protocol.eta` (and its per-language variants) are deleted once
      every language's worker SDK has been migrated — no leftover hand-ported
      copy of a now-generated schema.
- [ ] ADR-003 has a revision note pointing at this spec's outcome.

## Implementation

<!-- Filled in after acceptance: links to implementation issues and PRs. -->
