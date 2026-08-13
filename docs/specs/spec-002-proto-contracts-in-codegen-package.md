# SPEC-002: Proto Contract Ownership Moves to `fsm-proto-codegen`

| Field   | Value                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------- |
| Status  | Accepted                                                                                          |
| Date    | 2026-08-13                                                                                        |
| Authors | Niraj, Claude                                                                                     |
| Issue   | #110                                                                                              |
| Affects | `packages/fsm-proto-codegen`, `packages/fsm-core-async-op-worker`, future proto-defining services |

---

## Problem

Today, `.proto` contracts live with the service that defines them
(`packages/fsm-core-async-op-worker/src/proto/{activity_gateway,sidecar_gateway}.proto`,
each with its own `buf.yaml`), while `packages/fsm-proto-codegen` owns only the
codegen _config_ (`buf.gen.yaml`) and the generated `gen/` output. This split
was established when `fsm-proto-codegen` was created (#87) and reaffirmed twice
since (#100, #102/#104), on the stated rationale that Buf modules should be
rooted where their source lives and the defining service should own its own
contracts.

Nothing is broken today — this isn't a bug report. `fsm-proto-codegen` is
currently the one package that actually operates on `.proto` contracts across
all four target languages (it's what `buf generate` runs from, what pins the
TypeScript plugin versions, what the generated stubs are published from); the
service that merely _defines_ a contract has no other reason to hold its source
file. The problem is a **conceptual ownership mismatch**, made concrete now —
proactively, before a second proto-defining service exists — so the pattern that
gets followed the next time one is added is decided deliberately instead of by
precedent-copying whatever `fsm-core-async-op-worker` happens to have done
first.

## Constraints

- No accepted ADR governs proto file placement directly; ADR-003 (Activity
  Gateway / polyglot actor execution model) established that
  `fsm-core-async-op-worker` owns the Activity Gateway and Sidecar Gateway wire
  protocols conceptually — this spec does not change who defines those
  protocols, only where the `.proto` source text and its `buf.yaml` module
  config are checked in.
- `fsm-proto-codegen`'s generated `gen/{typescript,python,rust,go}/` output and
  its consumers (`gatewayClient.ts`, `gatewayServer.ts`, `sidecar/gateway.ts`,
  the compiler-generated worker SDK templates) all import through the package's
  `deno.json` `exports` map / language-specific package manifests — none of them
  import the `.proto` source directly, so relocating the source cannot change
  any consumer's import path.
- No CI workflow currently runs `buf generate`/`buf lint`/`buf breaking`
  (verified: no reference to `buf` in `.github/workflows/`) — regeneration is
  manual and its output is committed, so this move carries no CI risk.
- Each service keeps its own independent `buf.yaml` module (own lint/
  breaking-change policy) — centralizing the _location_ does not mean
  centralizing the _policy_. A single shared buf module for all services was
  considered and rejected (see Option C).

## Options considered

### Option A — Status quo: leave contracts with the defining service

Keep `.proto` + `buf.yaml` in `fsm-core-async-op-worker/src/proto/`, as today.
`fsm-proto-codegen` stays purely a codegen-config package with no source of its
own.

- **Pros**: zero migration cost. The service that owns a wire protocol keeps its
  contract and its implementation in the same directory tree, which is the more
  common convention across polyglot-proto monorepos generally. No cross-package
  coupling — changing the Activity Gateway's protocol only ever touches
  `fsm-core-async-op-worker`.
- **Cons**: the pattern was already re-litigated twice (#100, #102/#104)
  precisely because it wasn't obviously right the first time; leaves the "where
  does the next service's `.proto` go" question undecided until it's asked under
  time pressure again.

### Option B — Relocate, one independent buf module per service (chosen)

Move `fsm-core-async-op-worker/src/proto/` (both `.proto` files + `buf.yaml`) to
`fsm-proto-codegen/proto/fsm-core-async-op-worker/`. Each service that defines
contracts gets its own subdirectory under `fsm-proto-codegen/proto/`, each
keeping its own `buf.yaml` (own lint/breaking-change policy, own Buf module
boundary) — only the _location_ centralizes, not the _governance_.
`buf.gen.yaml`'s `inputs:` list grows by one entry per service.

- **Pros**: `fsm-proto-codegen` becomes the single place to look for "what wire
  contracts exist and what do they compile to" — source and the four language
  outputs live in one package. Establishes the pattern for the next
  proto-defining service now, deliberately, rather than by whoever adds the next
  `.proto` file copying whatever's closest. Per-service `buf.yaml` independence
  is preserved, so this doesn't force one lint/breaking policy onto unrelated
  services.
- **Cons**: couples two packages' change history — modifying the Activity
  Gateway's wire protocol now means editing a file inside `fsm-proto-codegen`
  rather than inside `fsm-core-async-op-worker`, the package that actually
  implements and calls it. Contributors working on a service need to know to
  look in a different package for its contract. `fsm-proto-codegen`'s own docs
  currently state it deliberately owns no `.proto` source — that claim has to be
  reversed, not just amended.

### Option C — Relocate, single shared buf module for everything

Same relocation as Option B, but one `buf.yaml` at `fsm-proto-codegen/proto/`
governs every service's contracts together — one lint/breaking-change policy,
one Buf module, all services' `.proto` files as siblings.

- **Pros**: simplest possible `buf.gen.yaml` (`inputs: - directory: proto`),
  cross-service message reuse becomes trivial (same module).
- **Cons**: forces every unrelated service's contracts under one breaking-change
  policy and one lint ruleset, so a lint exception needed by one service's
  contract (as `fsm-core-async-op-worker`'s `buf.yaml` briefly had, per #104's
  history, before it was removed) leaks scope onto every other service. Rejected
  — no cross-service proto reuse need exists today (confirmed: only one service
  defines contracts), so the coupling cost isn't bought by any real benefit yet.

## Decision

**Option B.** Ownership of contract _location_ moves to `fsm-proto-codegen`
(it's the package that actually builds and publishes against every language),
while ownership of contract _governance_ (lint/breaking-change policy, module
boundary) stays with each defining service via its own `buf.yaml` under its own
subdirectory. This is decided proactively — no second proto-defining service
exists yet — specifically so the convention is settled before it's needed under
time pressure.

## Consequences & migration

**Gets harder:**

- Modifying `fsm-core-async-op-worker`'s wire protocol becomes a cross-package
  edit: the `.proto` source lives in `fsm-proto-codegen`, but the code that
  implements/calls it (`gatewayServer.ts`, `gatewayClient.ts`,
  `sidecar/gateway.ts`) stays in `fsm-core-async-op-worker`. A protocol change
  now touches two packages' directories in one PR instead of one.
- `fsm-proto-codegen/README.md`/`CLAUDE.md` currently state, twice, that this
  package deliberately owns no `.proto` source — that stated rationale is
  reversed, not just extended, and needs rewriting rather than patching.
- Doc comments referencing the old `fsm-core-async-op-worker/src/proto/...` path
  exist beyond `fsm-proto-codegen` itself: `gatewayServer.ts`,
  `sidecar/gateway.ts`, `cli/async-operation-worker-gateway-ctl.ts`, all four
  `fsm-compiler-ts` worker-SDK scaffold templates (TS/Python/Rust/Go), the
  compiler's already-generated `apps/fsm-core-example/worker-sdk-generated/`
  output, and the root `README.md` (which also still has a stale pre-#104
  filename, `activity-gateway.proto`, worth fixing in the same pass).

**Migration:**

1. `git mv packages/fsm-core-async-op-worker/src/proto packages/fsm-proto-codegen/proto/fsm-core-async-op-worker`
   (carries `buf.yaml` + both `.proto` files, preserving git history).
2. Update `buf.gen.yaml`'s `inputs:` entry from
   `../fsm-core-async-op-worker/src/proto` to `proto/fsm-core-async-op-worker`.
3. Regenerate (`deno task generate`) and diff against currently-committed `gen/`
   — must be byte-identical (pure relocation, no schema/version change).
4. Update every doc/comment reference enumerated above.
5. No consumer import paths change — `gen/` output and the `deno.json`/language
   package manifests it's published through are unaffected.

**Rollback:** a straight `git mv` back plus reverting the `buf.gen.yaml`
`inputs:` entry and doc changes; no generated output or consumer-facing API
changes are involved, so rollback carries no compatibility risk.

## Acceptance criteria

- [x] `packages/fsm-core-async-op-worker/src/proto/` no longer exists; its
      `.proto` files and `buf.yaml` live at
      `packages/fsm-proto-codegen/proto/fsm-core-async-op-worker/`, moved with
      `git mv` (history preserved).
- [x] `buf.gen.yaml`'s `inputs:` points at the new location.
- [x] `deno task generate` produces byte-identical output to what's currently
      committed under `gen/`.
- [x] `fsm-proto-codegen/README.md` and `CLAUDE.md` rewritten to state it owns
      per-service proto contract sources (one subdirectory per service, each an
      independent buf module), including a short "adding a new service's
      contracts" note establishing the convention for next time.
- [x] All doc-comment references to the old path (enumerated in Consequences)
      updated, including the stale `activity-gateway.proto` filename in the root
      `README.md`.
- [x] No changes to any generated stub's content, any consumer's import path, or
      `fsm-core-async-op-worker`'s runtime behavior.

## Implementation

- #112 — relocates `proto/`, updates `buf.gen.yaml`, rewrites
  `fsm-proto-codegen` docs, and fixes stale path references across consumers.
