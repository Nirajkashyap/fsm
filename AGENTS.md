# AGENTS.md

Protocol for coding agents working in this repository — Claude Code, Cursor,
Codex, Gemini CLI, or any other. Humans pairing with an agent follow the same
flow. Build commands, architecture, and naming conventions live in `CLAUDE.md`
(readable by any agent — the name is historical).

Instructions here are the soft layer. The hard invariants (branch names, issue
references, PR linkage) are enforced by prek git hooks and CI regardless of
which agent — or human — does the work. See [Enforcement](#enforcement).

## Session gate

At the start of every session, before doing anything else, ask:

> "What are we doing in this session today? a) Explore / understand the
> codebase, experiment, or general Q&A b) Design / architecture work (new
> component, cross-cutting change, execution-model decision) c) Working on the
> codebase — feature, bug, or chore"

### (a) Explore / experiment / Q&A

Continue normally. Don't touch GitHub issues. Code changes are fine here —
experiments and throwaway work don't need an issue, a branch, or a worktree
(there's no issue number to name one with). If exploration turns into real
design or implementation work, stop and re-enter the gate as (b) or (c) — that's
the point a worktree gets created.

### (b) Design / architecture → spec-driven path

**Do not write implementation code in a design session.** The deliverable is a
reviewed spec, not code.

1. Interrogate the design before writing anything. Cover, in order:
   - **Problem** — what breaks or is impossible today? Who is affected?
   - **Constraints** — what is fixed? Check the standing architectural
     constraints in `docs/kb/` and `docs/adr/` (e.g. ADR-002: bounded worker
     fleet and dispatch strategy; ADR-003: connection minimization, polyglot via
     queue) — a spec that violates an accepted ADR must say so explicitly and
     propose superseding it.
   - **Options** — at least two, with trade-offs. Propose options the user
     didn't mention.
   - **Decision drivers** — why the chosen option wins.
   - **Consequences & migration** — what gets harder, rollback story.
   - **Acceptance criteria** — how we'll know it's implemented correctly.
2. Write the spec: copy `docs/specs/TEMPLATE.md` to
   `docs/specs/spec-NNN-short-slug.md` (next free number), status **Draft**.
3. Create a design issue and link the session (see
   [Issue linking](#issue-linking)):

   ```bash
   gh issue create --title "design: <title>" --body "<one-paragraph summary + link to spec path>" --label design --assignee @me
   ```

4. Create a worktree for this branch before making any changes — see
   [Multi-agent coordination](#multi-agent-coordination):

   ```bash
   git worktree add .claude/worktrees/design-<issue-number> -b design/<issue-number>-short-slug
   ```

5. Open a **spec-only PR** on branch `design/<issue-number>-short-slug`. The PR
   body must contain `Spec: docs/specs/spec-NNN-short-slug.md` and
   `Closes #<issue-number>`. No implementation code rides along.
6. Humans review the design in the PR. On merge, the spec's status becomes
   **Accepted**; cut implementation issues that link back to the spec. Durable,
   hard-to-reverse decisions graduate to `docs/adr/` (see `docs/specs/README.md`
   for the lifecycle).

Claude Code users: the `/design-spec` skill walks through this path.

### (c) Feature / bug / chore → issue-driven path

1. List open issues (assigned to the current user, plus unassigned):

   ```bash
   gh issue list --state open --assignee @me
   gh issue list --state open --search "no:assignee"
   ```

2. Ask which issue number this session is for; if it isn't listed, help create
   one (see below).

#### If they give an issue number

- Confirm it exists and read details: `gh issue view <n>`
- Assign it: `gh issue edit <n> --add-assignee @me`
- Link the session (see [Issue linking](#issue-linking))
- Confirm the type from its labels; if missing, ask and add one (**feature =
  `enhancement`**): `gh issue edit <n> --add-label <bug|enhancement|chore>`

#### If the issue doesn't exist yet

Ask for:

- Type: bug, feature (label: `enhancement`), or chore
- A short title and one-paragraph description
- For bugs: repro steps and expected vs. actual behavior
- For features: the user-facing outcome and any acceptance criteria
- For chores: why it's needed and what "done" looks like

Then create, assign, and link:

```bash
gh issue create --title "<title>" --body "<body>" --label <type> --assignee @me
```

Issues created via `gh` bypass the issue forms, so also add the matching
`area: *` label — the component→label mapping lives in
`.github/advanced-issue-labeler.yml`.

#### Before making any changes

Create a worktree for this issue's branch — see
[Multi-agent coordination](#multi-agent-coordination):

```bash
git worktree add .claude/worktrees/<type>-<issue-number> -b <type>/<issue-number>-short-slug
```

## Issue linking

Every code-work session posts a comment on its issue so anyone can see which
agent is (or was) on it:

```bash
gh issue comment <n> --body "🤖 <agent-name> session linked: <session-id>"
```

Claude Code records its session id in `.claude/.current-session-id` (written by
the SessionStart hook) — use
`gh issue comment <n> --body "🤖 Claude session linked: $(cat .claude/.current-session-id)"`.
Agents without a session id post their name and start time instead.

## Multi-agent coordination

These rules apply to every code-work session, not only when another agent is
known to be active — sessions can't reliably detect each other, so treat
coordination as always-on.

- **Assignment is the lock.** Never start work on an issue assigned to someone
  else. If an issue looks stale, comment and ask — don't take it.
- **One issue, one branch.** Branch `<type>/<issue-number>-short-slug` where
  type is `feat | bug | chore | design` (e.g. `bug/142-worker-lock-timeout`).
- **Commits reference the issue**: `fix(worker): handle lock timeout (#142)`.
- **Agent attribution**: never add a `Co-Authored-By: <agent> <noreply@...>`
  trailer to commit messages — no commit in this repo should include that line.
- **PRs include `Closes #<number>`** so merging auto-closes the issue. Design
  PRs also include the `Spec:` line.
- **Always work in a worktree.** Every code-work session creates its own
  worktree before starting work — never commit directly on a branch checked out
  in the shared working directory:
  `git worktree add .claude/worktrees/<type>-<issue-number> -b <type>/<issue-number>-slug`
  and tell the user the path. Caveat: the API dev server (port 9999) and local
  Supabase are shared services — only one worktree can run them at a time;
  coordinate before starting either, or change `PORT` in that worktree's `.env`.
- **One worktree per session, reused across issues.** If a session pivots to a
  second issue, reuse the same worktree — `git checkout -b` the new issue's
  branch inside it — rather than adding another worktree directory.
- **Clean up after merge.** Once an issue's PR merges, remove its worktree and
  delete the local branch:
  `git worktree remove .claude/worktrees/<type>-<issue-number>` then
  `git branch -d <type>/<issue-number>-short-slug`. Don't remove a worktree that
  still has uncommitted or unpushed changes.
- **Guard against worktree sprawl.** Before creating a new worktree, run
  `git worktree list`. If it already has more than 7 entries under
  `.claude/worktrees/`, scan each one's PR before adding another:

  ```bash
  gh pr view <branch> --json state,url   # per worktree's branch
  ```

  - **PR merged or closed** — remove that worktree and delete its branch (same
    as [Clean up after merge](#multi-agent-coordination) above), then proceed.
  - **PR still open** — don't remove it silently. Tell the user which worktrees
    are still open and let them choose: close/merge one of those PRs so its
    worktree can be removed, or resume that session to finish the work. Only
    remove an open-PR worktree if the user says to.

## Enforcement

These invariants are checked mechanically; agents should satisfy them rather
than discover them at commit time:

- **prek `commit-msg` hook** — commits on `feat/* | bug/* | chore/* | design/*`
  branches must reference an issue (`(#<n>)` or `#<n>` anywhere in the message).
  Run `prek install` once per clone (installs all configured hook stages).
- **prek `pre-commit` hook** — branch name must be `main`, `renovate/*`, or
  match `<type>/<issue-number>-short-slug`.
- **CI `pr-lint`** — PR body must contain `Closes #<n>` (design PRs: also a
  `Spec: docs/specs/...` line); head branch must match the naming convention.
- Merges to `main` go through PRs with human review — no agent merges its own
  work unreviewed.
