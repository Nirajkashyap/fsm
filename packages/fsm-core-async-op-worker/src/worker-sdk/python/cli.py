#!/usr/bin/env python3
"""worker-sdk/python cli — Python reference worker for the Activity Gateway.

Python counterpart of ../typescript/cli.ts: validates python actor folders
under --folder-path (validate_async_operation.py), filters to verified
results, and (for `start`) hands that array straight to sdk.ActorWorker,
which dynamically imports each fsm_module_path/method pair itself.

USAGE
  python3 cli.py <scan|start> --folder-path <path> [options]

EXAMPLE
  python3 cli.py start \\
    --folder-path /abs/path/to/fsm-core-example/fsm \\
    --workflow-type promise
"""

from __future__ import annotations

import argparse
import signal
import sys
import uuid

from sdk import ActorWorker
from validate_async_operation import validate_async_operation_from_folders_python

VALID_WORKFLOW_TYPES = ["promise", "sharedPromise"]
DEFAULT_GATEWAY_SOCKET = "/tmp/pgfsm-activity-gateway-workers.sock"
DEFAULT_HEARTBEAT_MS = 5000


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="worker-sdk/python cli — reference worker for the Activity Gateway"
    )
    parser.add_argument("command", choices=["scan", "start"])
    parser.add_argument(
        "-f",
        "--folder-path",
        required=True,
        help="Absolute path to FSM folder, e.g. fsm-core-example/fsm",
    )
    parser.add_argument(
        "-t",
        "--workflow-type",
        default="promise",
        choices=VALID_WORKFLOW_TYPES,
        help=f"Workflow type: {' | '.join(VALID_WORKFLOW_TYPES)} (default: promise)",
    )
    parser.add_argument(
        "--skip-dirs",
        default="",
        help="Comma-separated top-level directory names to skip",
    )
    parser.add_argument(
        "-g",
        "--gateway-socket",
        default=DEFAULT_GATEWAY_SOCKET,
        help=f"Sidecar socket to connect to (default: {DEFAULT_GATEWAY_SOCKET})",
    )
    parser.add_argument(
        "-i",
        "--worker-id",
        default=None,
        help="Stable worker identity (default: python-<random>)",
    )
    parser.add_argument(
        "--heartbeat-ms",
        type=int,
        default=DEFAULT_HEARTBEAT_MS,
        help=f"Heartbeat interval (default: {DEFAULT_HEARTBEAT_MS})",
    )
    return parser


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)

    skip_dirs = [d.strip() for d in args.skip_dirs.split(",") if d.strip()]
    worker_id = args.worker_id or f"python-{uuid.uuid4().hex[:8]}"

    results = validate_async_operation_from_folders_python(
        args.folder_path, args.workflow_type, skip_dirs
    )
    verified = [r for r in results if r.is_verified]

    print(f"Discovered {len(results)} actor(s) under {args.folder_path}")
    for r in results:
        key = (
            f"{r.parent_fsm_name}@{r.parent_fsm_version}@{r.fsm_type}"
            f"@{r.fsm_name}@{r.fsm_version}@{r.fsm_language}"
        )
        if r.is_verified:
            print(f"  + {key} ({r.fsm_module_path})")
        else:
            print(f"  - {key} ({r.fsm_module_path}): {r.error_message}")

    if args.command == "scan":
        return 0

    if not verified:
        print("No verified actors found, refusing to start worker", file=sys.stderr)
        return 1

    worker = ActorWorker(
        worker_id=worker_id,
        gateway_socket_path=args.gateway_socket,
        verified_actors=verified,
        heartbeat_ms=args.heartbeat_ms,
    )

    def _on_signal(signum: int, frame: object) -> None:
        del signum, frame
        print("Shutdown requested — stopping worker...")
        worker.stop()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    print(
        f"Starting worker {worker_id}: gateway-socket={args.gateway_socket}, "
        f"folder-path={args.folder_path}"
    )
    try:
        worker.run()
    except Exception as exc:  # noqa: BLE001 — reported and turned into an exit code
        print(f"Worker {worker_id} failed: {exc}", file=sys.stderr)
        return 1

    print(f"Worker {worker_id} stopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
