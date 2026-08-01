# CLAUDE.md — Worker Fleet (`apps/fsm-core-worker-ts/`)

Scoped guidance for `@pgfsm/worker`. Repo-wide conventions and session protocol
live in the root `CLAUDE.md` / `AGENTS.md`.

## What it is

The out-of-band worker fleet that drives FSM instances forward (see root
`CLAUDE.md` point 3 — the API never owns worker lifecycle). Kubernetes-style
split: `fsmlet` (kubelet — long-running node agent) is routed work by
`fsmscheduler` (kube-scheduler — control plane, run once per cluster), driven
one-shot by `fsmctl`. The `async-operation-*` CLIs are the equivalent trio for
promise/callback-based async operations.

Full CLI reference (flags, defaults, examples) lives in
`docs/guides/CLI-USAGE.md` — read it before invoking any of these directly.

## Commands

```bash
deno task fsmlet                    # node agent — claims & drives FSM workers
deno task fsmscheduler              # control-plane router (run once per cluster)
deno task cli                       # fsmctl — one-shot create/resume/send/stop
deno task async-operation-workerlet # node agent for promise-based async ops
deno task async-operation-scheduler # control-plane router for async ops
deno task async-operation-ctl       # one-shot control CLI for async ops
deno task check                     # deno check src/index.ts
```

## Structure (`src/`)

- `cli/` — six CLI entry points (`fsmlet.ts`, `fsmscheduler.ts`, `fsmctl.ts`,
  `async-operation-workerlet.ts`, `async-operation-scheduler.ts`,
  `async-operation-ctl.ts`)
- `fsmlet/` — node-agent implementation for FSM workers
- `fsmscheduler/` — control-plane routing implementation
- `asyncOperationWorkerlet/` — node-agent implementation for promise-based async
  ops (includes `fsmpromiseworker.py` — a polyglot example actor, not leftover
  Python tooling)
- `asyncOperationScheduler/` — control-plane routing for async ops
- `deprecated-inprocess-approach/` — legacy pre-scheduler CLI, superseded by the
  fsmlet/fsmscheduler dispatch model; not the path for new work
- `logger.ts` — composition-root LogTape config for this process
