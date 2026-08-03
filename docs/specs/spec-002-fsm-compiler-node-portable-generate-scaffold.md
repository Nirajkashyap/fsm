# SPEC-002: Node-Portable Generate/Scaffold Path for fsm-compiler-ts

| Field   | Value                      |
| ------- | -------------------------- |
| Status  | Draft                      |
| Date    | 2026-08-03                 |
| Authors | Niraj, Claude              |
| Issue   | #79                        |
| Affects | `packages/fsm-compiler-ts` |

---

## Problem

External actor authors — developers implementing FSM actors/actions/guards in
Python, Rust, or Go against this platform — need to run `@pgfsm/compiler`'s
`generate`, `generate-async-logic`, `generate-sync-logic`, and `delete` commands
(and the underlying library functions) to scaffold and manage FSM plugin
folders. Today that requires installing Deno, even though these authors are not
writing any Deno/TypeScript code themselves — a real adoption friction point for
exactly the polyglot audience this platform is built for.

`@pgfsm/compiler` already has an npm-publish path (`scripts/build-npm.ts`,
`@deno/dnt`), but it is currently broken (13 pre-existing TypeScript diagnostics
— `Deno.Command` typing under dnt's Node shims, and a missing `@types/pg`
declaration — reproduced identically on unmodified `main`) and, architecturally,
depends on `dnt`'s `shims: { deno: true }` to paper over direct `Deno.*` global
calls throughout the source. That shim layer is a second, dnt-maintained
implementation of "Deno API on Node" that the package doesn't strictly need for
the surface this audience actually uses.

## Constraints

- **ADR-001** (`docs/adr/adr-001-logging-library.md`) documents "zero-npm for
  library code — the packages target Deno as the primary runtime" as an accepted
  secondary requirement for the monorepo's Deno/TypeScript packages. This spec
  **scopes an explicit exception to `fsm-compiler-ts` only** —
  `fsm-sync-worker-ts`, `fsm-async-worker-ts`, and other Deno-primary packages
  are unaffected and ADR-001 continues to apply to them unchanged.
  `fsm-compiler-ts` is the one package with a legitimate external,
  non-Deno-installing audience (polyglot actor authors); the others do not have
  that audience.
- **ADR-002/ADR-003** show the rest of the platform (worker fleet, activity
  tier) deliberately depends on Deno-only APIs (`Deno.Command` for the chosen
  Rust/Go actor subprocess-IPC model, `Deno.memoryUsage()` for backpressure).
  This spec does not touch or reconsider that — it is scoped to
  `fsm-compiler-ts` alone, which is not part of that runtime path.
- **Scope is generate/scaffold only, not full CLI parity.**
  `validate-sync-operation`, `validate-async-operation`, and `load` are
  explicitly **out of scope** for this rewrite.
  `validate-async-operation-logic.ts` in particular shells out via
  `Deno.Command` to `deno run`/`python3`/`go build`/`rustc` to check stub
  declarations — porting that is materially riskier than the pure-file-I/O
  generate/scaffold path and isn't needed by the concrete consumer driving this
  work. These commands remain Deno-only.
- **In scope, mapped by file** (verified by grepping every `Deno.*` call site in
  the package):
  - `src/generate-fsm-json.ts` — 6 calls (`Deno.stat`, `Deno.errors.NotFound`,
    `Deno.cwd`, `Deno.readDir` ×2)
  - `src/operation-logic-scaffold.ts` — 9 calls (`Deno.mkdir`,
    `Deno.writeTextFile`, `Deno.cwd`, `Deno.readDir` ×2, `Deno.readTextFile`,
    `Deno.errors.NotFound`)
  - `src/delete-fsm-json-from-folders.ts` — 9 calls (`Deno.remove` ×3,
    `Deno.errors.NotFound`, `Deno.cwd`, `Deno.readDir` ×2)
  - `src/cli/index.ts` — the subset backing `generate`/`generate-async-logic`/
    `generate-sync-logic`/`delete` (arg parsing via `Deno.args`, `Deno.exit`,
    `Deno.env.get` for `DATABASE_URL` is `load`-only and out of scope,
    `Deno.stat`, `Deno.readTextFile`, `Deno.cwd`)
  - `src/generate-async-operation-logic.ts`,
    `src/generate-sync-operation-logic.ts` — **zero** `Deno.*` calls already; no
    change needed.
  - All calls in scope are filesystem/process/env operations with direct
    `node:fs/promises` / `node:process` equivalents — no exotic Deno-only
    capability is required for this surface.
- **Target runtime**: latest active Node.js LTS. No legacy-Node support
  required.
- **CLI binary must ship**, not just library exports — `npx fsm-compiler` /
  global install parity with today's `dnt` build for the in-scope commands.

## Options considered

### Option A — Fix `build-npm.ts` (keep `dnt`)

Fix the 13 existing TypeScript diagnostics and continue publishing via
`@deno/dnt`'s `shims: { deno: true }`, which polyfills every `Deno.*` call
(including out-of-scope ones like `Deno.Command`) for Node at build time.

**Pros**: smallest immediate diff — a type-error fix, not a rewrite; keeps full
CLI parity (`validate-*`, `load` included) with no guard logic needed. **Cons**:
perpetuates a second, `dnt`-maintained shim implementation for code that doesn't
need it; doesn't address the underlying "why does this depend on Deno-only APIs
at all" question; `dnt` is a lower-activity project and every future `Deno.*`
addition risks a repeat of the same class of build breakage.

### Option B — Rewrite in-scope files to use `node:*` built-ins, drop `dnt` entirely (chosen)

Deno implements `node:fs/promises`, `node:process`, etc. natively. Replace the
in-scope `Deno.*` calls with their `node:` equivalents (`Deno.readTextFile` →
`readFile(path, "utf8")` from `node:fs/promises`; `Deno.cwd()` →
`process.cwd()`; `Deno.args` → `process.argv.slice(2)`; `Deno.exit()` →
`process.exit()`; `Deno.errors.NotFound` → `err.code === "ENOENT"` check). The
same source then runs unmodified under both Deno and Node — no shim, no separate
build artifact. Publish via `deno publish` to JSR; Node consumers install
through JSR's `npm.jsr.io` compatibility bridge. `scripts/build-npm.ts` and the
`build:npm` task are removed.

**Pros**: single source of truth, no shim layer to maintain or go stale;
directly answers "why does this need Deno-only APIs" by removing the dependency
for the in-scope surface; smaller actual diff than it sounds (~24 call sites
across 3 files + partial `cli/index.ts`, not 60+ across 10 — the `Deno.Command`
subprocess code that makes up most of the remaining count lives entirely in the
out-of-scope `validate-async-operation-logic.ts`). **Cons**: unverified whether
JSR's npm bridge correctly ships a CLI `bin` entry the way `dnt` explicitly
builds one — real risk, not yet confirmed; out-of-scope commands (`validate-*`,
`load`) still reference bare `Deno.*` globals and will throw under Node unless
explicitly guarded.

### Option C — Do nothing (smaller hammer)

Leave `dnt` broken; external actor authors keep installing Deno.

**Pros**: zero effort. **Cons**: doesn't solve the real, current problem driving
this — a concrete external consumer needs this now.

## Decision

**Option B**, in this order:

1. **Removes the actual dependency, not just its symptom.** The problem isn't
   that `dnt` is broken — it's that the package calls Deno-only APIs it doesn't
   need to. Option A fixes today's break but leaves the next one waiting.
2. **Smaller than it looks.** Mapping every call site showed the
   `Deno.Command`-heavy code (the genuinely hard-to-port part) is entirely
   outside this rewrite's scope already. What's left is uniformly
   filesystem/process calls with 1:1 `node:` equivalents.
3. **No new dependency, no shim to keep in sync.** `dnt` transforms and
   maintains its own Deno-API-on-Node emulation; using Node's real built-ins
   directly (which Deno also implements) means one code path, not two.

**Risk carried forward, not resolved by this decision**: whether JSR's npm
bridge correctly exposes a `bin` entry for the CLI. This is the first thing to
verify in implementation (see Acceptance criteria) — if it fails, the fallback
is documented below, not a redesign.

## Consequences & migration

- **No migration for existing consumers.** `fsm-sync-worker-ts`,
  `fsm-async-worker-ts`, and `apps/fsm-core-ts-hono-deno` all consume
  `@pgfsm/compiler` via Deno workspace resolution (root `deno.json`'s
  `"workspace"` array), never through the npm/JSR build path — they are
  completely unaffected.
- **What gets harder**: future PRs touching the in-scope files
  (`generate-fsm-json.ts`, `operation-logic-scaffold.ts`,
  `delete-fsm-json-from-folders.ts`, the in-scope part of `cli/index.ts`) must
  use `node:*` built-ins instead of `Deno.*` globals, or explicitly document why
  a new addition is Deno-only. Unlike `dnt`, there is no build-time TypeScript
  check that would catch an accidental `Deno.*` reintroduction — the Node smoke
  test in Acceptance criteria is the only guard, so it must run in CI, not just
  locally.
- **Release process**: `deno publish` (JSR) is a new mechanism for this package,
  replacing `deno task build:npm`. No CI workflow currently invokes either
  automatically — this is greenfield, not a migration of existing automation.
- **Rollback story**: if the JSR-npm-bridge CLI `bin` risk (Decision, above)
  turns out broken, fall back to Option A — restore/fix `build-npm.ts`. The
  `node:`-built-ins rewrite is not wasted in that fallback: code that already
  avoids `Deno.*` globals is _easier_ for `dnt` to shim, not harder, since
  there's less left for `shims: { deno: true }` to cover.

## Acceptance criteria

- [ ] `src/generate-fsm-json.ts`, `src/operation-logic-scaffold.ts`,
      `src/delete-fsm-json-from-folders.ts`, and the in-scope portion of
      `src/cli/index.ts` (`generate`, `generate-async-logic`,
      `generate-sync-logic`, `delete` commands + the arg-parsing/exit/stat
      plumbing they depend on) contain zero direct `Deno.*` global references —
      only `node:fs/promises` / `node:process` (and `node:path` if needed).
- [ ] The existing Deno-side regression suite
      (`test/operation-logic-scaffold.test.ts`,
      `test/generate-fsm-json.test.ts`, the in-scope subset of
      `test/cli.test.ts`) passes unmodified under `deno test` after the rewrite
      — proof the rewrite is behavior-preserving, not just portable.
- [ ] **New**: a Node-runtime smoke test (real `node`, not Deno) runs the
      in-scope commands against a fixture folder and produces identical output
      to the Deno run — the actual proof of portability. Wired into CI, not just
      run locally once.
- [ ] `cli/index.ts` detects the absence of the Deno global before dispatching
      to `validate-sync-operation`, `validate-async-operation`, or `load`, and
      exits with a clear "not supported outside Deno" message under Node instead
      of a raw `ReferenceError`.
- [ ] `deno publish --dry-run` (or equivalent JSR check) succeeds, and a local
      install of the resulting package through JSR's npm bridge correctly
      exposes both the library exports and a working `fsm-compiler` bin/CLI
      entry. This is the acceptance test for the CLI-`bin` risk flagged in the
      Decision — if it fails, invoke the rollback (Option A) instead of
      redesigning.
- [ ] `scripts/build-npm.ts` and the `build:npm` `deno.json` task are removed,
      unless the previous criterion failed and the Option A fallback is in
      effect instead.
- [ ] `README.md` / `docs/guides/cli-usage.md` document Node.js install/usage
      for the external-actor-author audience, and explicitly list which commands
      remain Deno-only.

## Implementation

<!-- Filled in after acceptance: links to implementation issues and PRs. -->
