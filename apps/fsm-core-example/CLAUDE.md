# CLAUDE.md — FSM Examples (`apps/fsm-core-example/`)

Scoped guidance for example FSM definitions. Repo-wide conventions and session
protocol live in the root `CLAUDE.md` / `AGENTS.md`.

## FSM Definition Format

FSMs are versioned JSON files in `apps/fsm-core-example/fsm/` (e.g.
`creditCheck/`, `carVitals/`, `taskMachineConfig/`). Each version folder
(`v01/`, `v02/`) contains:

- `fsm.json` — state machine definition
- `xstate-fsm.json` — XState 5-compatible format
- `machine.ts` / `machine-with-provider.ts` — XState machine definitions
- Per-language actor implementations, one subdirectory per language:
  `typescript/{actions,actors,delays,guards}/`, `python/actors/`,
  `rust/actors/`, `go/actors/` — the concrete example of the polyglot actor
  model described in the root `CLAUDE.md`

`sharedFSM/` holds definitions reused across examples (e.g. `vitalsWorkflow/`).
Definitions target **XState 5** semantics and are consumed by
`packages/fsm-compiler-ts/`.
