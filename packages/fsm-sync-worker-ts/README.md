# fsm-sync-worker-ts — Worker Fleet

The out-of-band worker fleet that drives FSM instances forward (the HTTP API
never blocks on or owns worker lifecycle). Runs on Deno.

## What it does

Kubernetes-style split:

| CLI              | Role                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| **fsmlet**       | Long-running node agent (kubelet equivalent) — claims and drives FSM workers    |
| **fsmscheduler** | Control-plane routing process (kube-scheduler equivalent), run once per cluster |
| **fsmctl**       | One-shot control CLI (kubectl equivalent) — create/resume/send/stop             |
| **pgcron**       | One-shot deploy-time script — (re)registers the `pg_cron` drain job             |

Full flag reference, examples, and the dispatch model behind these four CLIs
live in [`docs/guides/CLI-USAGE.md`](./docs/guides/CLI-USAGE.md).

## How to run

```bash
# From this package's directory
deno task fsmlet -f <fsm-folder-path>
deno task fsmscheduler
deno task cli -c create -n <fsm-name> -v <fsm-version>
deno task pgcron
```

### Via npx (no Deno required)

```bash
npx @pgfsm/sync-worker fsmlet -f <fsm-folder-path>
npx @pgfsm/sync-worker fsmscheduler
npx @pgfsm/sync-worker fsmctl -c create -n <fsm-name> -v <fsm-version>
npx @pgfsm/sync-worker pgcron
```

This package is published to npm as `@pgfsm/sync-worker` with `fsmlet`,
`fsmscheduler`, `fsmctl`, and `pgcron` `bin` entries, so each can be run via
`npx`/`npm install -g` on plain Node — no Deno install needed.

Those bin entries only exist because publishing goes through
`deno task build:npm` (`scripts/build-npm.ts`, using `@deno/dnt`), which
transpiles + Node-shims the source into `dist/` and registers the library export
alongside the shebanged CLI bins in one pass. `deno pack` (used for this repo's
other npm-published packages) does **not** synthesize a `package.json` `bin`
field, so a CLI packed that way would be unreachable from `npx` —
`.github/workflows/npm-publish.yml` builds this package's `sync-worker` matrix
entry through the dnt path instead.

## Prerequisites

- **Deno** (see `.prototools` for pinned version) — always required to run from
  source
- **Database connection** — `DATABASE_URL` in `.env`, or `--db-url`/`-d` passed
  to any CLI

## Key exports

```typescript
import {
  runFsmlet, // node-agent implementation behind the fsmlet CLI
  runFsmScheduler, // control-plane routing implementation behind fsmscheduler
  startFSMWorker, // drive a single FSM instance
  startFSMWorkerWithDBLock, // same, holding a DB-level advisory lock
} from "@pgfsm/sync-worker";
```

## Deno version

Managed by `.prototools`. Install with:

```bash
proto install deno --pin local
```
