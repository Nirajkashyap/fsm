// TypeScript worker SDK: connects to the gateway's sidecar Unix socket,
// registers verified actors, and serves invoke requests.
// Ported from the polygot-lang-ipc-worker prototype's
// worker-sdk/typescript/src/cli.ts, with changes:
//
// - Reuses this package's own sidecar/protocol.ts for framing/envelopes
//   instead of duplicating the wire protocol (the prototype had to
//   duplicate it because the gateway and each worker-sdk were separate
//   deployable units; here they're the same monorepo package).
// - Routes by `actorKey()`'s
//   `parentFsmName@parentFsmVersion@fsmType@fsmName@fsmVersion` instead of a
//   free-form function name, matching the activity contract this gateway
//   speaks.
// - Actor discovery is validate-async-operation.ts's
//   `validateAsyncOperationFromFoldersTypescript` (this repo's real FSM
//   actor convention — see check_fn.ts), not a standalone directory scan.
//   `ActorWorker` takes the verified `ActorPluginValidationResult[]`
//   directly and dynamically imports each `fsmModulePath`/`method` pair
//   itself.
//
// This is the reference implementation for a compiled-language worker SDK
// (e.g. Rust) to follow — see SPEC-001's acceptance criteria.

import { toFileUrl } from "@std/path";
import { getLogger } from "@logtape/logtape";
import type { ActorPluginValidationResult } from "@pgfsm/compiler";
import {
  actorKey,
  type InvokeBody,
  type InvokeErrorBody,
  type InvokeResultBody,
  makeEnvelope,
  readFrame,
  type RegisterAckBody,
  type RegisterBody,
  type RegisteredActor,
  writeFrame,
} from "../../sidecar/protocol.ts";

const logger = getLogger([
  "@pgfsm/worker",
  "async-op-worker-gateway",
  "worker-sdk-ts",
]);

export type ActorHandler = (input: unknown) => unknown | Promise<unknown>;

const DEFAULT_HEARTBEAT_MS = 5_000;

export interface ActorWorkerOptions {
  workerId: string;
  language: string;
  gatewaySocketPath: string;
  heartbeatMs?: number;
}

// Connects to the gateway's sidecar socket, registers `verifiedActors`
// (already filtered to `isVerified === true` by the caller), and serves
// invoke requests until the gateway unregisters this worker or `stop()` is
// called.
export class ActorWorker {
  private conn: Deno.Conn | null = null;
  private stopped = false;
  private readonly handlers = new Map<string, ActorHandler>();

  constructor(
    private readonly options: ActorWorkerOptions,
    private readonly verifiedActors: ActorPluginValidationResult[],
  ) {}

  async run(): Promise<void> {
    if (this.verifiedActors.length === 0) {
      throw new Error("no actors to register, refusing to start worker");
    }

    const registeredActors: RegisteredActor[] = [];
    for (const actor of this.verifiedActors) {
      const mod = await import(toFileUrl(actor.fsmModulePath).href);
      const handler = mod[actor.method];
      if (typeof handler !== "function") {
        throw new Error(
          `'${actor.method}' is not exported as a function from ${actor.fsmModulePath}`,
        );
      }

      this.handlers.set(
        actorKey(
          actor.parentFsmName,
          actor.parentFsmVersion,
          actor.fsmType,
          actor.fsmName,
          actor.fsmVersion,
        ),
        handler as ActorHandler,
      );
      registeredActors.push({
        parentFsmName: actor.parentFsmName,
        parentFsmVersion: actor.parentFsmVersion,
        fsmType: actor.fsmType,
        fsmName: actor.fsmName,
        fsmVersion: actor.fsmVersion,
      });
    }

    const conn = await Deno.connect({
      transport: "unix",
      path: this.options.gatewaySocketPath,
    });
    this.conn = conn;

    const registerBody: RegisterBody = {
      worker_id: this.options.workerId,
      language: this.options.language,
      protocol_version: "1.0",
      actors: registeredActors,
    };

    await writeFrame(
      conn,
      makeEnvelope(
        "register",
        `worker:${this.options.workerId}`,
        "gateway",
        registerBody as unknown as Record<string, unknown>,
      ),
    );

    const ack = await readFrame(conn);
    if (!ack || ack.type !== "register_ack") {
      throw new Error(`expected register_ack but got ${ack?.type ?? "EOF"}`);
    }
    const ackBody = ack.body as unknown as RegisterAckBody;
    if (!ackBody.accepted) {
      throw new Error("gateway rejected registration");
    }

    logger.info(
      "Worker {workerId} registered {count} actor(s) with the gateway",
      { workerId: this.options.workerId, count: registeredActors.length },
    );

    const heartbeat = this.heartbeatLoop(conn);

    try {
      await this.serveLoop(conn);
    } finally {
      this.stopped = true;
      await heartbeat.catch(() => {});
      try {
        conn.close();
      } catch {
        // already closed
      }
    }
  }

  stop(): void {
    this.stopped = true;
    try {
      this.conn?.close();
    } catch {
      // already closed
    }
  }

  private async heartbeatLoop(conn: Deno.Conn): Promise<void> {
    const intervalMs = this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    while (!this.stopped) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (this.stopped) {
        break;
      }
      await writeFrame(
        conn,
        makeEnvelope(
          "heartbeat",
          `worker:${this.options.workerId}`,
          "gateway",
          { worker_id: this.options.workerId },
        ),
      );
    }
  }

  private async serveLoop(conn: Deno.Conn): Promise<void> {
    while (!this.stopped) {
      const envelope = await readFrame(conn);
      if (!envelope) {
        break;
      }

      if (envelope.type === "cancel") {
        continue;
      }
      if (envelope.type === "unregister") {
        break;
      }
      if (envelope.type !== "invoke") {
        continue;
      }

      await this.handleInvoke(conn, envelope.body as unknown as InvokeBody);
    }
  }

  private async handleInvoke(conn: Deno.Conn, body: InvokeBody): Promise<void> {
    const key = actorKey(
      body.parent_fsm_name,
      body.parent_fsm_version,
      body.fsm_type,
      body.fsm_name,
      body.fsm_version,
    );
    const handler = this.handlers.get(key);
    const started = performance.now();

    if (!handler) {
      await this.sendError(
        conn,
        body.invoke_id,
        "NOT_FOUND",
        `actor not found: ${key}`,
      );
      return;
    }

    try {
      const output = await Promise.resolve(handler(body.input));
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      const result: InvokeResultBody = {
        invoke_id: body.invoke_id,
        output,
        duration_ms: durationMs,
      };
      await writeFrame(
        conn,
        makeEnvelope(
          "invoke_result",
          `worker:${this.options.workerId}`,
          "gateway",
          result as unknown as Record<string, unknown>,
        ),
      );
    } catch (error) {
      await this.sendError(
        conn,
        body.invoke_id,
        "INTERNAL",
        error instanceof Error ? error.message : "unknown worker error",
      );
    }
  }

  private async sendError(
    conn: Deno.Conn,
    invokeId: string,
    code: string,
    message: string,
  ): Promise<void> {
    const errorBody: InvokeErrorBody = {
      invoke_id: invokeId,
      error: { code, message, retriable: false },
    };
    await writeFrame(
      conn,
      makeEnvelope(
        "invoke_error",
        `worker:${this.options.workerId}`,
        "gateway",
        errorBody as unknown as Record<string, unknown>,
      ),
    );
  }
}
