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
//
// Built on the compiler-generated Connect-ES stubs
// (packages/fsm-proto-codegen/gen/typescript/, see that package's README) via
// @connectrpc/connect-node's connectNodeAdapter, instead of @grpc/grpc-js +
// @grpc/proto-loader's runtime reflection (see gatewayClient.ts for the same
// migration on the client side, including why it's still wire-compatible
// with real gRPC clients: connectNodeAdapter serves the gRPC, gRPC-web, and
// Connect protocols from one handler by default). Bound to a plain
// node:http2 server instead of a grpc.Server — Unix-socket binding is
// Node's own `server.listen(path)`, no gRPC-specific "unix:" scheme needed
// server-side either.

import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import * as http2 from "node:http2";
import { getLogger } from "@logtape/logtape";
import { ActivityInvokeError, SidecarGateway } from "./sidecar/gateway.ts";
import { ActivityGateway } from "../../fsm-proto-codegen/gen/typescript/activity-gateway_connect.js";

const logger = getLogger(["@pgfsm/worker", "async-op-worker-gateway"]);

// Same Deno-vs-tsc `never` inference gap documented in gatewayClient.ts's
// RawActivityGatewayClient — router.service()'s Partial<ServiceImpl<T>>
// parameter hits it too. Hand-rolled and cast once at the router.service()
// call, instead of fighting Connect's generic inference under Deno.
interface RawActivityGatewayServiceImpl {
  invoke(request: {
    parentFsmName: string;
    parentFsmVersion: string;
    fsmType: string;
    fsmName: string;
    fsmVersion: string;
    fsmLanguage: string;
    inputJson: string;
    instanceId: string;
    correlationId: string;
    timeoutMs: number;
  }): Promise<{
    ok: boolean;
    outputJson: string;
    errorCode: string;
    errorMessage: string;
    retriable: boolean;
  }>;
  listRegisteredActors(
    request: Record<string, never>,
  ): Promise<{ actorKeys: string[] }>;
}

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

/**
 * Binds an http2 server to a grpc-js-style target ("unix:<path>" or
 * "host:port") — mirrors gatewayClient.ts's targetToHttp2Options, but for
 * listening rather than connecting. Node's http2 Server has no "unix:"
 * scheme either; `server.listen(path)` vs. `server.listen(port, host)` is
 * how it distinguishes the two itself.
 */
function bindHttp2Server(
  server: http2.Http2Server,
  bindTarget: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    if (bindTarget.startsWith("unix:")) {
      server.listen(bindTarget.slice("unix:".length), onListening);
    } else {
      const sepIndex = bindTarget.lastIndexOf(":");
      const host = bindTarget.slice(0, sepIndex);
      const port = Number(bindTarget.slice(sepIndex + 1));
      server.listen(port, host, onListening);
    }
  });
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

  const serviceImpl: RawActivityGatewayServiceImpl = {
    invoke: async (req) => {
      logger.debug("Received Invoke() request: {request}", { request: req });
      try {
        const result = await sidecar.invoke(
          {
            parentFsmName: req.parentFsmName,
            parentFsmVersion: req.parentFsmVersion,
            fsmType: req.fsmType,
            fsmName: req.fsmName,
            fsmVersion: req.fsmVersion,
            fsmLanguage: req.fsmLanguage,
            input: parseInput(req.inputJson ?? ""),
            instanceId: req.instanceId,
            correlationId: req.correlationId,
          },
          req.timeoutMs > 0 ? req.timeoutMs : timeoutMs,
        );

        return {
          ok: true,
          outputJson: JSON.stringify(result.output ?? null),
          errorCode: "",
          errorMessage: "",
          retriable: false,
        };
      } catch (error) {
        const invokeError = error instanceof ActivityInvokeError
          ? error
          : new ActivityInvokeError(
            error instanceof Error ? error.message : String(error),
            "UNKNOWN",
          );

        return {
          ok: false,
          outputJson: "",
          errorCode: invokeError.code,
          errorMessage: invokeError.message,
          retriable: invokeError.retriable,
        };
      }
    },
    listRegisteredActors: () =>
      Promise.resolve({ actorKeys: sidecar.listRegisteredActors() }),
  };

  const routes = (router: ConnectRouter) => {
    router.service(
      ActivityGateway,
      serviceImpl as unknown as Partial<ServiceImpl<typeof ActivityGateway>>,
    );
  };

  cleanupUnixSocket(options.bindTarget);

  const server = http2.createServer(connectNodeAdapter({ routes }));
  await bindHttp2Server(server, options.bindTarget);
  logger.info("Activity gateway gRPC server listening on {target}", {
    target: options.bindTarget,
  });

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      logger.info("Activity gateway shutting down...");
      server.close(() => {
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
