#!/usr/bin/env bash
# Removes worktrees (and their local branches) whose PR has merged.
# Never touches remote branches — see AGENTS.md "Clean up after merge" policy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
LOG="$REPO/.claude/worktree-cleanup.log"

# launchd/cron don't source shell profiles, so common git/gh install
# locations may be missing from PATH regardless of machine or user.
for p in /opt/homebrew/bin /usr/local/bin /usr/bin /bin; do
  case ":$PATH:" in
    *":$p:"*) ;;
    *) PATH="$PATH:$p" ;;
  esac
done
export PATH

cd "$REPO"
{
  echo "=== Worktree cleanup run: $(date -u +"%Y-%m-%dT%H:%M:%SZ") ==="

  git fetch origin --quiet

  git worktree list --porcelain | awk '
    /^worktree / { wt=$2 }
    /^branch /   { branch=$2; sub("refs/heads/", "", branch); print wt "\t" branch }
  ' | while IFS=$'\t' read -r worktree_path branch; do
    [ "$worktree_path" = "$REPO" ] && continue

    if [ -n "$(git -C "$worktree_path" status --porcelain)" ]; then
      echo "SKIP $branch: uncommitted changes in $worktree_path"
      continue
    fi

    ahead=$(git -C "$worktree_path" rev-list --count "origin/$branch..$branch" 2>/dev/null || echo 0)
    if [ "$ahead" != "0" ]; then
      echo "SKIP $branch: local commits not pushed"
      continue
    fi

    pr_state=$(gh pr list --head "$branch" --state all --json state --jq '.[0].state // "NONE"' 2>/dev/null || echo "ERROR")

    case "$pr_state" in
      MERGED)
        git worktree remove "$worktree_path"
        git branch -d "$branch"
        echo "REMOVED $branch (worktree + local branch): PR merged"
        ;;
      CLOSED)
        echo "REVIEW $branch: PR closed without merge — not auto-removed, check manually"
        ;;
      OPEN)
        echo "SKIP $branch: PR still open"
        ;;
      NONE)
        echo "SKIP $branch: no PR found for branch"
        ;;
      *)
        echo "SKIP $branch: could not determine PR state ($pr_state)"
        ;;
    esac
  done

  echo "=== Done ==="
} >> "$LOG" 2>&1
