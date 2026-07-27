// Activity Gateway server: a gRPC front door (client-facing) backed by the
// Unix-socket sidecar (worker-facing). This is the standalone local service
// SPEC-001's Option B introduces — it holds zero DB connections; the TS
// orchestrator (asyncOperationWorkerlet.ts) remains the only PGMQ poll/claim/
// archive owner and is meant to call this gateway as a gRPC client per
// claimed compiled-language actor invocation.
//
// Ported from the polygot-lang-ipc-worker prototype's server/src/main.ts,
// adapted to the ActivityGateway proto contract (proto/activity-gateway.proto)
// and to this repo's logger.

import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { dirname, fromFileUrl, join } from "@std/path";
import { getLogger } from "@logtape/logtape";
import { ActivityInvokeError, SidecarGateway } from "./sidecar/gateway.ts";

const logger = getLogger(["@pgfsm/worker", "async-op-worker-gateway"]);

const __dirname = dirname(fromFileUrl(import.meta.url));
const protoPath = join(__dirname, "proto", "activity-gateway.proto");

export interface GatewayServerOptions {
  /** gRPC bind target, e.g. "unix:/tmp/pgfsm-activity-gateway.sock" or "127.0.0.1:50061". */
  bindTarget: string;
  /** Unix socket the sidecar listens on for worker connections. */
  sidecarSocketPath: string;
  /** Default per-invoke timeout if the caller doesn't set one. */
  defaultInvokeTimeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_INVOKE_TIMEOUT_MS = 10_000;

function parseInput(inputJson: string): unknown {
  if (!inputJson.trim()) {
    return null;
  }
  return JSON.parse(inputJson);
}

function cleanupUnixSocket(bindTarget: string): void {
  if (!bindTarget.startsWith("unix:")) {
    return;
  }
  const path = bindTarget.slice("unix:".length);
  try {
    Deno.removeSync(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

export async function startActivityGatewayServer(
  options: GatewayServerOptions,
): Promise<void> {
  const timeoutMs = options.defaultInvokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;

  const sidecar = new SidecarGateway({
    socketPath: options.sidecarSocketPath,
  });
  sidecar.start();
  logger.info("Sidecar worker gateway listening on unix:{path}", {
    path: options.sidecarSocketPath,
  });

  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    pgfsm: {
      activitygateway: { ActivityGateway: grpc.ServiceClientConstructor };
    };
  };

  const server = new grpc.Server();
  server.addService(
    (loaded.pgfsm.activitygateway.ActivityGateway as unknown as {
      service: grpc.ServiceDefinition;
    }).service,
    {
      invoke: async (
        call: grpc.ServerUnaryCall<
          {
            parent_fsm_name: string;
            parent_fsm_version: string;
            fsm_type: string;
            fsm_name: string;
            fsm_version: string;
            fsm_language: string;
            input_json: string;
            instance_id: string;
            correlation_id: string;
            timeout_ms: number;
          },
          {
            ok: boolean;
            output_json: string;
            error_code: string;
            error_message: string;
            retriable: boolean;
          }
        >,
        callback: grpc.sendUnaryData<{
          ok: boolean;
          output_json: string;
          error_code: string;
          error_message: string;
          retriable: boolean;
        }>,
      ) => {
        logger.debug("Received Invoke() request: {request}", {
          request: call.request,
        });
        const req = call.request;
        try {
          const result = await sidecar.invoke(
            {
              parentFsmName: req.parent_fsm_name,
              parentFsmVersion: req.parent_fsm_version,
              fsmType: req.fsm_type,
              fsmName: req.fsm_name,
              fsmVersion: req.fsm_version,
              fsmLanguage: req.fsm_language,
              input: parseInput(req.input_json ?? ""),
              instanceId: req.instance_id,
              correlationId: req.correlation_id,
            },
            req.timeout_ms > 0 ? req.timeout_ms : timeoutMs,
          );

          callback(null, {
            ok: true,
            output_json: JSON.stringify(result.output ?? null),
            error_code: "",
            error_message: "",
            retriable: false,
          });
        } catch (error) {
          const invokeError = error instanceof ActivityInvokeError
            ? error
            : new ActivityInvokeError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
            );

          callback(null, {
            ok: false,
            output_json: "",
            error_code: invokeError.code,
            error_message: invokeError.message,
            retriable: invokeError.retriable,
          });
        }
      },
      listRegisteredActors: (
        _call: grpc.ServerUnaryCall<
          Record<string, never>,
          { actor_keys: string[] }
        >,
        callback: grpc.sendUnaryData<{ actor_keys: string[] }>,
      ) => {
        callback(null, { actor_keys: sidecar.listRegisteredActors() });
      },
    },
  );

  cleanupUnixSocket(options.bindTarget);

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      options.bindTarget,
      grpc.ServerCredentials.createInsecure(),
      (err) => (err ? reject(err) : resolve()),
    );
  });
  server.start();
  logger.info("Activity gateway gRPC server listening on {target}", {
    target: options.bindTarget,
  });

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      logger.info("Activity gateway shutting down...");
      server.tryShutdown(() => {
        sidecar.stop();
        cleanupUnixSocket(options.bindTarget);
        resolve();
      });
    };

    if (options.signal) {
      if (options.signal.aborted) {
        shutdown();
        return;
      }
      options.signal.addEventListener("abort", shutdown, { once: true });
    }
  });
}
