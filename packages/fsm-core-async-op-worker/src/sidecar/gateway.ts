// Sidecar gateway: accepts one Unix-socket connection per worker process,
// tracks which actors each worker has registered, and routes invocations to
// the right worker's connection. Ported from the polygot-lang-ipc-worker
// prototype's server/src/sidecar/gateway.ts — the connection/registration/
// pending-invoke bookkeeping is unchanged; routing keys are
// `parentFsmName@parentFsmVersion@fsmType@fsmName@fsmVersion@fsmLanguage`
// (see protocol.ts's `actorKey()`) instead of the prototype's free-form
// function name, and the invoke/result/error bodies carry the KB-001
// activity contract.
//
// This class never opens a database connection — it only relays framed JSON
// between the gRPC-facing AsyncOperationWorkerGateway and worker processes,
// keeping the zero-DB-connections property SPEC-001 requires of the
// polyglot side.

import { getLogger } from "@logtape/logtape";
import {
  actorKey,
  type InvokeBody,
  type InvokeErrorBody,
  type InvokeResultBody,
  makeEnvelope,
  readFrame,
  type RegisterBody,
  type RegisteredActor,
  writeFrame,
} from "./protocol.ts";

const logger = getLogger([
  "@pgfsm/worker",
  "async-op-worker-gateway",
  "sidecar",
]);

export interface ActivityInvokeInput {
  parentFsmName: string;
  parentFsmVersion: string;
  fsmType: string;
  fsmName: string;
  fsmVersion: string;
  fsmLanguage: string;
  input: unknown;
  instanceId: string;
  correlationId: string;
}

export interface ActivityInvokeResult {
  output: unknown;
}

export class ActivityInvokeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retriable = false,
  ) {
    super(message);
    this.name = "ActivityInvokeError";
  }
}

interface PendingInvoke {
  resolve: (value: ActivityInvokeResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  key: string;
}

interface WorkerState {
  workerId: string;
  language: string;
  conn: Deno.Conn;
  actors: Set<string>;
  pendingByInvokeId: Map<string, PendingInvoke>;
  alive: boolean;
}

interface ActorRoute {
  workerId: string;
  meta: RegisteredActor;
}

export interface SidecarGatewayOptions {
  socketPath: string;
}

export class SidecarGateway {
  private readonly socketPath: string;
  private listener: Deno.UnixListener | null = null;
  private readonly workers = new Map<string, WorkerState>();
  private readonly actorRoutes = new Map<string, ActorRoute>();

  constructor(options: SidecarGatewayOptions) {
    this.socketPath = options.socketPath;
  }

  start(): void {
    this.cleanupSocket();
    this.listener = Deno.listen({ transport: "unix", path: this.socketPath });
    this.acceptLoop();
  }

  stop(): void {
    if (this.listener) {
      this.listener.close();
      this.listener = null;
    }

    for (const worker of this.workers.values()) {
      worker.alive = false;
      try {
        worker.conn.close();
      } catch {
        // already closed
      }
    }

    this.workers.clear();
    this.actorRoutes.clear();
    this.cleanupSocket();
  }

  listRegisteredActors(): string[] {
    return Array.from(this.actorRoutes.keys()).sort();
  }

  async invoke(
    request: ActivityInvokeInput,
    timeoutMs: number,
  ): Promise<ActivityInvokeResult> {
    const key = actorKey(
      request.parentFsmName,
      request.parentFsmVersion,
      request.fsmType,
      request.fsmName,
      request.fsmVersion,
      request.fsmLanguage,
    );
    const route = this.actorRoutes.get(key);
    if (!route) {
      throw new ActivityInvokeError(
        `no worker registered for actor: ${key}`,
        "ACTOR_NOT_FOUND",
      );
    }

    const worker = this.workers.get(route.workerId);
    if (!worker || !worker.alive) {
      throw new ActivityInvokeError(
        `worker unavailable for actor: ${key}`,
        "WORKER_UNAVAILABLE",
        true,
      );
    }

    const invokeId = crypto.randomUUID();

    return await new Promise<ActivityInvokeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.pendingByInvokeId.delete(invokeId);
        reject(
          new ActivityInvokeError(
            `actor invocation timed out after ${timeoutMs}ms`,
            "TIMEOUT",
            true,
          ),
        );
      }, timeoutMs);

      worker.pendingByInvokeId.set(invokeId, {
        resolve,
        reject,
        timer,
        key,
      });

      const body: InvokeBody = {
        invoke_id: invokeId,
        parent_fsm_name: request.parentFsmName,
        parent_fsm_version: request.parentFsmVersion,
        fsm_type: request.fsmType,
        fsm_name: request.fsmName,
        fsm_version: request.fsmVersion,
        fsm_language: request.fsmLanguage,
        input: request.input,
        instance_id: request.instanceId,
        correlation_id: request.correlationId,
        timeout_ms: timeoutMs,
        deadline_unix_ms: Date.now() + timeoutMs,
      };

      writeFrame(
        worker.conn,
        makeEnvelope(
          "invoke",
          "gateway",
          `worker:${worker.workerId}`,
          body as unknown as Record<string, unknown>,
          request.correlationId,
        ),
      ).catch((error) => {
        worker.pendingByInvokeId.delete(invokeId);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private async acceptLoop(): Promise<void> {
    if (!this.listener) {
      return;
    }

    for await (const conn of this.listener) {
      this.handleConnection(conn);
    }
  }

  private async handleConnection(conn: Deno.Conn): Promise<void> {
    let workerId: string | null = null;

    try {
      while (true) {
        const envelope = await readFrame(conn);
        if (!envelope) {
          break;
        }

        if (envelope.type === "register") {
          const body = envelope.body as unknown as RegisterBody;
          workerId = body.worker_id;
          this.registerWorker(body, conn);
          await writeFrame(
            conn,
            makeEnvelope(
              "register_ack",
              "gateway",
              `worker:${body.worker_id}`,
              {
                accepted: true,
                gateway_protocol_version: "1.0",
                registered_actors: body.actors.map((a) =>
                  actorKey(
                    a.parentFsmName,
                    a.parentFsmVersion,
                    a.fsmType,
                    a.fsmName,
                    a.fsmVersion,
                    a.fsmLanguage,
                  )
                ),
                rejected_actors: [],
              },
              envelope.trace_id,
            ),
          );
          continue;
        }

        if (!workerId) {
          continue;
        }

        if (envelope.type === "invoke_result") {
          const body = envelope.body as unknown as InvokeResultBody;
          this.resolvePendingInvoke(workerId, body.invoke_id, {
            output: body.output,
          });
          continue;
        }

        if (envelope.type === "invoke_error") {
          const body = envelope.body as unknown as InvokeErrorBody;
          this.rejectPendingInvoke(
            workerId,
            body.invoke_id,
            new ActivityInvokeError(
              body.error?.message ||
                `worker error (${body.error?.code ?? "UNKNOWN"})`,
              body.error?.code ?? "UNKNOWN",
              body.error?.retriable,
            ),
          );
          continue;
        }

        if (envelope.type === "unregister") {
          this.unregisterWorker(workerId);
          break;
        }
      }
    } catch (error) {
      logger.warn("Sidecar connection error for worker={workerId}: {error}", {
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (workerId) {
        this.unregisterWorker(workerId);
      }
      try {
        conn.close();
      } catch {
        // already closed
      }
    }
  }

  private registerWorker(body: RegisterBody, conn: Deno.Conn): void {
    const existing = this.workers.get(body.worker_id);
    if (existing) {
      this.unregisterWorker(body.worker_id);
      try {
        existing.conn.close();
      } catch {
        // already closed
      }
    }

    const worker: WorkerState = {
      workerId: body.worker_id,
      language: body.language,
      conn,
      actors: new Set(),
      pendingByInvokeId: new Map(),
      alive: true,
    };

    this.workers.set(body.worker_id, worker);

    for (const meta of body.actors) {
      const key = actorKey(
        meta.parentFsmName,
        meta.parentFsmVersion,
        meta.fsmType,
        meta.fsmName,
        meta.fsmVersion,
        meta.fsmLanguage,
      );
      this.actorRoutes.set(key, { workerId: body.worker_id, meta });
      worker.actors.add(key);
    }

    logger.info(
      "Registered worker {workerId} ({language}) with {count} actor(s)",
      {
        workerId: body.worker_id,
        language: body.language,
        count: body.actors.length,
      },
    );
  }

  private unregisterWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return;
    }

    worker.alive = false;

    for (const key of worker.actors) {
      this.actorRoutes.delete(key);
    }

    for (const pending of worker.pendingByInvokeId.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new ActivityInvokeError(
          `worker disconnected while invoking ${pending.key}`,
          "WORKER_DISCONNECTED",
          true,
        ),
      );
    }

    worker.pendingByInvokeId.clear();
    this.workers.delete(workerId);

    logger.info("Unregistered worker {workerId}", { workerId });
  }

  private resolvePendingInvoke(
    workerId: string,
    invokeId: string,
    result: ActivityInvokeResult,
  ): void {
    const worker = this.workers.get(workerId);
    const pending = worker?.pendingByInvokeId.get(invokeId);
    if (!pending || !worker) {
      return;
    }

    worker.pendingByInvokeId.delete(invokeId);
    clearTimeout(pending.timer);
    pending.resolve(result);
  }

  private rejectPendingInvoke(
    workerId: string,
    invokeId: string,
    error: Error,
  ): void {
    const worker = this.workers.get(workerId);
    const pending = worker?.pendingByInvokeId.get(invokeId);
    if (!pending || !worker) {
      return;
    }

    worker.pendingByInvokeId.delete(invokeId);
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private cleanupSocket(): void {
    try {
      Deno.removeSync(this.socketPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
}
