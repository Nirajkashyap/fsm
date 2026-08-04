#!/usr/bin/env bash
# Installs a recurring job that runs fsm-worktree-cleanup.sh every ~2
# days: launchd on macOS, cron on Linux. Generates config from this
# machine's own paths, so it works for any user regardless of where they
# cloned the repo. Safe to re-run — it replaces its own prior entry.
#
# Windows: there's no bash/git/gh runtime to hook a native scheduler into
# directly. Run this script inside WSL (with git+gh installed and
# authenticated there) so it takes the Linux/cron path, then point Windows
# Task Scheduler at wsl.exe as a belt-and-suspenders trigger in case the WSL
# instance isn't already running:
#   schtasks /create /tn "FSM Worktree Cleanup" ^
#     /tr "wsl.exe -e /path/to/fsm-worktree-cleanup.sh" ^
#     /sc daily /mo 2 /st 09:00
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
CLEANUP_SCRIPT="$SCRIPT_DIR/fsm-worktree-cleanup.sh"
LOG="$REPO/.claude/worktree-cleanup.log"
LABEL="com.fsm.worktree-cleanup"
MARKER="# fsm-worktree-cleanup (managed by install-fsm-worktree-cleanup.sh)"

case "$(uname)" in
  Darwin)
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    mkdir -p "$HOME/Library/LaunchAgents"

    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$CLEANUP_SCRIPT</string>
  </array>

  <key>StartInterval</key>
  <integer>172800</integer>

  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF

    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"

    echo "Installed and loaded $LABEL (launchd, runs every 2 days)"
    echo "  plist:  $PLIST"
    echo "  script: $CLEANUP_SCRIPT"
    echo "  log:    $LOG"
    echo
    echo "Run now:  launchctl kickstart -k gui/\$(id -u)/$LABEL"
    echo "Disable:  launchctl bootout gui/\$(id -u)/$LABEL"
    ;;

  Linux)
    CRON_LINE="0 9 */2 * * $CLEANUP_SCRIPT >> $LOG 2>&1 $MARKER"
    ( crontab -l 2>/dev/null | grep -vF "$MARKER"; echo "$CRON_LINE" ) | crontab -

    echo "Installed cron entry (runs at 09:00 on every odd day-of-month, ~every 2 days):"
    echo "  $CRON_LINE"
    echo "  log: $LOG"
    echo
    echo "View:    crontab -l"
    echo "Remove:  crontab -l | grep -vF '$MARKER' | crontab -"
    ;;

  *)
    echo "Unsupported OS: $(uname)." >&2
    echo "On Windows, run this installer inside WSL — see the comment at the top of this file." >&2
    exit 1
    ;;
esac
