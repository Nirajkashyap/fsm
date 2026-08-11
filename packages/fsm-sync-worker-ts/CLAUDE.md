# CLAUDE.md — Worker Fleet (`packages/fsm-sync-worker-ts/`)

Scoped guidance for `@pgfsm/sync-worker`. Repo-wide conventions and session
protocol live in the root `CLAUDE.md` / `AGENTS.md`.

## What it is

The out-of-band worker fleet that drives FSM instances forward (see root
`CLAUDE.md` point 3 — the API never owns worker lifecycle). Kubernetes-style
split: `fsmlet` (kubelet — long-running node agent) is routed work by
`fsmscheduler` (kube-scheduler — control plane, run once per cluster), driven
one-shot by `fsmctl`.

The equivalent trio for promise/callback-based async operations
(`async-operation-workerlet`, `async-operation-scheduler`,
`async-operation-ctl`) lives in the sibling package
`packages/fsm-async-worker-ts/` — see its `CLAUDE.md`.

Full CLI reference (flags, defaults, examples) lives in
`docs/guides/CLI-USAGE.md` — read it before invoking any of these directly.

## Commands

```bash
deno task fsmlet       # node agent — claims & drives FSM workers
deno task fsmscheduler # control-plane router (run once per cluster)
deno task cli          # fsmctl — one-shot create/resume/send/stop
deno task check        # deno check src/index.ts
```

## Structure (`src/`)

- `cli/` — three CLI entry points (`fsmlet.ts`, `fsmscheduler.ts`, `fsmctl.ts`)
- `fsmlet/` — node-agent implementation for FSM workers
- `fsmscheduler/` — control-plane routing implementation
- `logger.ts` — composition-root LogTape config for this process
