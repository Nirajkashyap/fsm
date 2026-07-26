import { parseArgs } from "@std/cli/parse-args";
import { getLogger } from "@logtape/logtape";
import { CATEGORY, configureLogging, isTerminal } from "@pgfsm/logging";
import type { WorkflowType } from "@pgfsm/compiler";
import { ActorWorker } from "./sdk.ts";
import { validateAsyncOperationFromFoldersTypescript } from "./validate-async-operation.ts";

const logger = getLogger([
  "@pgfsm/worker",
  "async-op-worker-gateway",
  "worker-sdk-ts",
  "cli",
]);
await configureLogging({
  levels: { [CATEGORY.worker]: isTerminal ? "debug" : "info" },
});

const VALID_WORKFLOW_TYPES: WorkflowType[] = ["promise", "sharedPromise"];

function printHelp(): void {
  logger.info(`
worker-sdk/typescript cli — TypeScript reference worker for the Activity Gateway

USAGE
  deno run --allow-all cli.ts <scan|start> [options]

OPTIONS
  -f, --folder-path <path>      Absolute path to FSM folder, e.g. fsm-core-example/fsm (required)
  -t, --workflow-type <type>    Workflow type: ${
    VALID_WORKFLOW_TYPES.join(" | ")
  } (default: promise)
      --skip-dirs <dirs>        Comma-separated top-level directory names to skip
  -g, --gateway-socket <path>   Sidecar socket to connect to (default: /tmp/pgfsm-activity-gateway-workers.sock)
  -i, --worker-id <id>          Stable worker identity (default: typescript-<random>)
      --heartbeat-ms <ms>       Heartbeat interval (default: 5000)
  -h, --help                    Show this help message

COMMANDS
  scan    Validate typescript actor folders under --folder-path and print what would be registered.
  start   Validate, then connect to the gateway and serve invocations for verified actors until stopped.

DESCRIPTION
  Follows this repo's existing FSM actor convention (see
  apps/fsm-core-example/fsm/creditCheck/v01/typescript/actors/checkBureau/
  checkBureau.ts and check_fn.ts): --folder-path must contain
  <fsmName>/<version>/typescript/actors/<actorName>/<actorName>.ts, exporting
  a named function <actorName>(input) — not a default export. Registered
  with the gateway as "<actorName>@<version>".

EXAMPLE
  deno run --allow-all cli.ts start \\
    --folder-path /abs/path/to/fsm-core-example/fsm \\
    --workflow-type promise
`);
}

const args = parseArgs(Deno.args, {
  string: [
    "folder-path",
    "workflow-type",
    "skip-dirs",
    "gateway-socket",
    "worker-id",
    "heartbeat-ms",
  ],
  boolean: ["help"],
  alias: {
    h: "help",
    f: "folder-path",
    t: "workflow-type",
    g: "gateway-socket",
    i: "worker-id",
  },
});

if (args.help) {
  printHelp();
  Deno.exit(0);
}

const command = String(args._[0] ?? "");
if (command !== "scan" && command !== "start") {
  logger.error("First argument must be one of: scan, start. Got: {command}", {
    command: command || "(none)",
  });
  printHelp();
  Deno.exit(1);
}

const folderPath = args["folder-path"];
if (!folderPath) {
  logger.error("--folder-path is required");
  printHelp();
  Deno.exit(1);
}

const workflowTypeArg = args["workflow-type"] ?? "promise";
if (!VALID_WORKFLOW_TYPES.includes(workflowTypeArg as WorkflowType)) {
  logger.error("--workflow-type must be one of: {valid}. Got: {got}", {
    valid: VALID_WORKFLOW_TYPES.join(", "),
    got: workflowTypeArg,
  });
  Deno.exit(1);
}
const workflowType = workflowTypeArg as WorkflowType;

const skipDirs = args["skip-dirs"]
  ? args["skip-dirs"].split(",").map((d) => d.trim()).filter(Boolean)
  : [];
const gatewaySocketPath = args["gateway-socket"] ??
  "/tmp/pgfsm-activity-gateway-workers.sock";
const workerId = args["worker-id"] ??
  `typescript-${crypto.randomUUID().slice(0, 8)}`;
const heartbeatMs = args["heartbeat-ms"]
  ? Number(args["heartbeat-ms"])
  : undefined;

const results = await validateAsyncOperationFromFoldersTypescript(
  folderPath,
  workflowType,
  skipDirs,
);
const verified = results.filter((result) => result.isVerified);

logger.info("Discovered {count} actor(s) under {path}", {
  count: results.length,
  path: folderPath,
});
for (const result of results) {
  if (result.isVerified) {
    logger.info("  + {actor}@{version} ({file})", {
      actor: result.src,
      version: result.fsmVersion,
      file: result.fsmModulePath,
    });
  } else {
    logger.warn("  - {actor}@{version} ({file}): {reason}", {
      actor: result.src,
      version: result.fsmVersion,
      file: result.fsmModulePath,
      reason: result.errorMessage,
    });
  }
}

if (command === "scan") {
  Deno.exit(0);
}

if (verified.length === 0) {
  logger.error("No verified actors found, refusing to start worker");
  Deno.exit(1);
}

const worker = new ActorWorker(
  { workerId, language: "typescript", gatewaySocketPath, heartbeatMs },
  verified,
);

const onSignal = () => {
  logger.info("Shutdown requested — stopping worker...");
  worker.stop();
};
Deno.addSignalListener("SIGINT", onSignal);
Deno.addSignalListener("SIGTERM", onSignal);

try {
  logger.info(
    "Starting worker {workerId}: gateway-socket={socket}, folder-path={path}",
    { workerId, socket: gatewaySocketPath, path: folderPath },
  );
  await worker.run();
  logger.info("Worker {workerId} stopped.", { workerId });
} catch (err) {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  logger.error("Worker {workerId} failed: {error}", { workerId, error: msg });
  Deno.exit(1);
}
