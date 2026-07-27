"""Python worker SDK: connects to the gateway's sidecar Unix socket,
registers verified actors, and serves invoke requests.

Python counterpart of ../typescript/sdk.ts's ActorWorker — same wire
protocol (protocol.py, ported from ../../sidecar/protocol.ts), same
actor_key() identity
(parent_fsm_name@parent_fsm_version@fsm_type@fsm_name@fsm_version), same
register -> heartbeat -> serve lifecycle, and it dynamically loads each
verified actor's module/function itself rather than taking a pre-built
handler map. Uses a background thread for heartbeats (matching the
polygot-lang-ipc-worker prototype's Python worker-sdk) instead of the
TypeScript version's async Deno.Conn loop — plain blocking sockets + a
heartbeat thread is the natural Python shape for the same protocol.

This is the reference implementation alongside worker-sdk/typescript for a
compiled-language worker SDK (e.g. Rust) to follow — see SPEC-001's
acceptance criteria.
"""

from __future__ import annotations

import asyncio
import importlib.util
import socket
import threading
import time
from types import ModuleType
from typing import Any, Callable, Dict, List, Optional

from protocol import actor_key, make_envelope, read_frame, write_frame
from validate_async_operation import ActorPluginValidationResult

ActorHandler = Callable[[Any], Any]

DEFAULT_HEARTBEAT_MS = 5000


class ProtocolError(Exception):
    pass


def _load_module(module_path: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location("_pgfsm_actor", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


class ActorWorker:
    def __init__(
        self,
        worker_id: str,
        gateway_socket_path: str,
        verified_actors: List[ActorPluginValidationResult],
        heartbeat_ms: int = DEFAULT_HEARTBEAT_MS,
    ) -> None:
        self.worker_id = worker_id
        self.language = "python"
        self.gateway_socket_path = gateway_socket_path
        self.verified_actors = verified_actors
        self.heartbeat_ms = heartbeat_ms

        self._sock: Optional[socket.socket] = None
        self._handlers: Dict[str, ActorHandler] = {}
        self._stopped = False

    def run(self) -> None:
        if not self.verified_actors:
            raise ValueError("no actors to register, refusing to start worker")

        registered_actors = []
        for actor in self.verified_actors:
            module = _load_module(actor.fsm_module_path)
            handler = getattr(module, actor.method, None)
            if not callable(handler):
                raise ValueError(
                    f"'{actor.method}' is not exported as a function "
                    f"from {actor.fsm_module_path}"
                )

            key = actor_key(
                actor.parent_fsm_name,
                actor.parent_fsm_version,
                actor.fsm_type,
                actor.fsm_name,
                actor.fsm_version,
                actor.fsm_language,
            )
            self._handlers[key] = handler
            registered_actors.append(
                {
                    "parentFsmName": actor.parent_fsm_name,
                    "parentFsmVersion": actor.parent_fsm_version,
                    "fsmType": actor.fsm_type,
                    "fsmName": actor.fsm_name,
                    "fsmVersion": actor.fsm_version,
                    "fsmLanguage": actor.fsm_language,
                }
            )

        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(self.gateway_socket_path)
        self._sock = sock

        register_body = {
            "worker_id": self.worker_id,
            "language": self.language,
            "protocol_version": "1.0",
            "actors": registered_actors,
        }
        write_frame(
            sock,
            make_envelope(
                "register", f"worker:{self.worker_id}", "gateway", register_body
            ),
        )

        ack = read_frame(sock)
        if ack is None or ack.get("type") != "register_ack":
            raise ProtocolError(
                f"expected register_ack but got {ack.get('type') if ack else 'EOF'}"
            )
        if not ack.get("body", {}).get("accepted", False):
            raise ProtocolError("gateway rejected registration")

        print(
            f"Worker {self.worker_id} registered {len(registered_actors)} actor(s) "
            "with the gateway"
        )

        heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        heartbeat_thread.start()

        try:
            self._serve_loop()
        finally:
            self._stopped = True
            try:
                sock.close()
            except OSError:
                pass

    def stop(self) -> None:
        self._stopped = True
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass

    def _heartbeat_loop(self) -> None:
        assert self._sock is not None
        while not self._stopped:
            time.sleep(self.heartbeat_ms / 1000)
            if self._stopped:
                break
            try:
                write_frame(
                    self._sock,
                    make_envelope(
                        "heartbeat",
                        f"worker:{self.worker_id}",
                        "gateway",
                        {"worker_id": self.worker_id},
                    ),
                )
            except OSError:
                self._stopped = True
                break

    def _serve_loop(self) -> None:
        assert self._sock is not None
        while not self._stopped:
            envelope = read_frame(self._sock)
            if envelope is None:
                break

            msg_type = envelope.get("type")
            if msg_type == "cancel":
                continue
            if msg_type == "unregister":
                break
            if msg_type != "invoke":
                continue

            self._handle_invoke(envelope.get("body", {}))

    def _handle_invoke(self, body: Dict[str, Any]) -> None:
        invoke_id = body.get("invoke_id")
        key = actor_key(
            body.get("parent_fsm_name", ""),
            body.get("parent_fsm_version", ""),
            body.get("fsm_type", ""),
            body.get("fsm_name", ""),
            body.get("fsm_version", ""),
            body.get("fsm_language", ""),
        )
        handler = self._handlers.get(key)

        if handler is None:
            self._send_error(invoke_id, "NOT_FOUND", f"actor not found: {key}")
            return

        started = time.perf_counter()
        try:
            if asyncio.iscoroutinefunction(handler):
                output = asyncio.run(handler(body.get("input")))
            else:
                output = handler(body.get("input"))
            duration_ms = max(0, round((time.perf_counter() - started) * 1000))
            self._send(
                make_envelope(
                    "invoke_result",
                    f"worker:{self.worker_id}",
                    "gateway",
                    {
                        "invoke_id": invoke_id,
                        "output": output,
                        "duration_ms": duration_ms,
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001 — reported to the gateway, not raised
            self._send_error(invoke_id, "INTERNAL", str(exc))

    def _send_error(self, invoke_id: Optional[str], code: str, message: str) -> None:
        self._send(
            make_envelope(
                "invoke_error",
                f"worker:{self.worker_id}",
                "gateway",
                {
                    "invoke_id": invoke_id,
                    "error": {"code": code, "message": message, "retriable": False},
                },
            )
        )

    def _send(self, envelope: Dict[str, Any]) -> None:
        assert self._sock is not None
        write_frame(self._sock, envelope)
