import { parseArgs } from "@std/cli/parse-args";
import { getLogger } from "@logtape/logtape";
import { CATEGORY, configureLogging, isTerminal } from "@pgfsm/logging";
import { startActivityGatewayServer } from "../index.ts";

const logger = getLogger(["@pgfsm/worker", "async-op-worker-gateway", "cli"]);
// Composition root for this CLI: configures LogTape once, same pattern as
// apps/fsm-core-worker-ts/src/logger.ts's configureWorkerLogger.
await configureLogging({
  levels: { [CATEGORY.worker]: isTerminal ? "debug" : "info" },
});

const args = parseArgs(Deno.args, {
  string: ["bind", "sidecar-socket", "invoke-timeout-ms"],
  boolean: ["help"],
  alias: { h: "help", b: "bind", s: "sidecar-socket", t: "invoke-timeout-ms" },
});

function printHelp(): void {
  logger.info(`
async-operation-worker-gateway — local Activity Gateway for compiled-language actors

USAGE
  deno run --allow-all src/cli/async-operation-worker-gateway.ts [options]

OPTIONS
  -b, --bind <target>              gRPC bind target (default: unix:/tmp/pgfsm-activity-gateway.sock)
  -s, --sidecar-socket <path>      Unix socket path workers connect to (default: /tmp/pgfsm-activity-gateway-workers.sock)
  -t, --invoke-timeout-ms <ms>     Default per-invoke timeout (default: 10000)
  -h, --help                       Show this help message

DESCRIPTION
  Starts the Activity Gateway: a gRPC service (client-facing) backed by a
  Unix-socket sidecar (worker-facing). Compiled-language worker processes
  connect to the sidecar socket and register the actors they serve; the TS
  orchestrator (asyncOperationWorkerlet.ts) is the intended gRPC client,
  calling Invoke() once per claimed PGMQ message. The gateway holds zero DB
  connections — see docs/specs/spec-001-compiled-lang-actor-workers.md.
`);
}

if (args.help) {
  printHelp();
  Deno.exit(0);
}

const bindTarget = args.bind ?? "unix:/tmp/pgfsm-activity-gateway.sock";
const sidecarSocketPath = args["sidecar-socket"] ??
  "/tmp/pgfsm-activity-gateway-workers.sock";
const invokeTimeoutArg = args["invoke-timeout-ms"];
const defaultInvokeTimeoutMs = invokeTimeoutArg
  ? Number(invokeTimeoutArg)
  : undefined;

if (invokeTimeoutArg && !Number.isInteger(defaultInvokeTimeoutMs)) {
  logger.error("--invoke-timeout-ms must be a positive integer, got: {value}", {
    value: invokeTimeoutArg,
  });
  Deno.exit(1);
}

const controller = new AbortController();
let shutdownRequested = false;

const onSignal = () => {
  if (shutdownRequested) {
    logger.info("Force exit.");
    Deno.exit(0);
  }
  shutdownRequested = true;
  logger.info(
    "Shutdown requested — stopping activity gateway gracefully. Ctrl+C again to force exit...",
  );
  controller.abort();
};

Deno.addSignalListener("SIGINT", onSignal);
Deno.addSignalListener("SIGTERM", onSignal);

try {
  logger.info(
    "Starting activity gateway: bind={bind}, sidecar-socket={socket}",
    { bind: bindTarget, socket: sidecarSocketPath },
  );
  await startActivityGatewayServer({
    bindTarget,
    sidecarSocketPath,
    defaultInvokeTimeoutMs,
    signal: controller.signal,
  });
  logger.info("Activity gateway stopped.");
} catch (err) {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  logger.error("Activity gateway failed: {error}", { error: msg });
  Deno.exit(1);
}
