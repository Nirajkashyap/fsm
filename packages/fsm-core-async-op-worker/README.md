# fsm-core-async-op-worker — Activity Gateway

The Activity Gateway for promise-type async FSM operations across polyglot
(TypeScript/Python/Rust/Go) actors — a standalone alternative to
`fsm-async-worker-ts` (v1), not something that integrates with or is invoked by
it. Runs on Deno.

## What it does

- **Accepts worker registrations** — TS/Python/Rust/Go worker processes connect
  over a Unix socket (the "sidecar") and announce which actors they serve.
- **Owns its own Postgres connection and poll loop** — every 30 seconds
  (default), asks Postgres which pending work matches its currently-registered
  workers, with zero dependency on any external orchestrator's poll loop.
- **Dispatches and archives** — for each claimed item, invokes the right worker
  over the sidecar socket and archives the result.
- **Optionally exposes a client-facing gRPC/Connect API** (`Invoke`,
  `ListRegisteredActors`).

Full flag reference, examples, and the PGMQ dispatch model behind this live in
[`docs/guides/CLI-USAGE.md`](./docs/guides/CLI-USAGE.md); the goal-vs-current
scoping record is [`GOAL.md`](./GOAL.md).

## How to run

```bash
# From this package's directory
deno task gateway
deno task gateway-ctl -c list
```

### Via npx (no Deno required)

```bash
npx @pgfsm/async-worker async-operation-worker-gateway
npx @pgfsm/async-worker async-operation-worker-gateway-ctl -c list
```

This package is published to npm as `@pgfsm/async-worker` with
`async-operation-worker-gateway` and `async-operation-worker-gateway-ctl` `bin`
entries, so each can be run via `npx`/`npm install -g` on plain Node — no Deno
install needed.

Those bin entries only exist because publishing goes through
`deno task build:npm` (`scripts/build-npm.ts`, using `@deno/dnt`), which
transpiles + Node-shims the source into `dist/` and registers the library export
alongside the shebanged CLI bins in one pass. `deno pack` (used for this repo's
other npm-published packages) does **not** synthesize a `package.json` `bin`
field, so a CLI packed that way would be unreachable from `npx` —
`.github/workflows/npm-publish.yml` builds this package's `async-worker` matrix
entry through the dnt path instead.

## Prerequisites

- **Deno** (see `.prototools` for pinned version) — always required to run from
  source
- **Database connection** — `DATABASE_URL` in `.env`, or `--db-url`/`-d` passed
  to the CLI (only needed for the poll loop; see `--disable-poll-loop` in
  `CLI-USAGE.md`)
- **At least one worker-sdk process** to register actors and actually serve
  invocations — see `packages/fsm-proto-codegen/`'s generated stubs, or
  `apps/fsm-core-example/worker-sdk-generated/<lang>/`

## Key exports

```typescript
import {
  ActivityGatewayClient, // invoke actors through the gateway's client-facing API
  SidecarGateway, // the sidecar itself — worker registration + dispatch
  startActivityGatewayServer, // sidecar + gRPC/Connect server + poll loop, all in one process
  startAsyncOpPollLoop, // the 30s Postgres poll/claim/archive loop
} from "@pgfsm/async-worker";
```

## Deno version

Managed by `.prototools`. Install with:

```bash
proto install deno --pin local
```
