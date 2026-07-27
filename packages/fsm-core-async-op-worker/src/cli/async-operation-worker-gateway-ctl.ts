import { parseArgs } from "@std/cli/parse-args";
import { getLogger } from "@logtape/logtape";
import { CATEGORY, configureLogging, isTerminal } from "@pgfsm/logging";
import { ActivityGatewayClient } from "../gatewayClient.ts";

const logger = getLogger([
  "@pgfsm/worker",
  "async-op-worker-gateway",
  "ctl",
]);
await configureLogging({
  levels: { [CATEGORY.worker]: isTerminal ? "debug" : "info" },
});

const DEFAULT_TARGET = "unix:/tmp/pgfsm-activity-gateway.sock";
const DEFAULT_TIMEOUT_MS = 5_000;

function printHelp(): void {
  logger.info(`
async-operation-worker-gateway-ctl — CLI client for the Activity Gateway

USAGE
  deno run --allow-all cli/async-operation-worker-gateway-ctl.ts <list|invoke> [options]

OPTIONS
  --target <target>              gRPC target (default: ${DEFAULT_TARGET})
  -h, --help                     Show this help message

INVOKE OPTIONS
  --parent-fsm-name <name>       required
  --parent-fsm-version <ver>     required
  --fsm-type <type>              required, e.g. promise
  --fsm-name <name>              required
  --fsm-version <ver>            required
  --fsm-language <lang>          required, e.g. typescript, python, rust, go
  --input <json>                 JSON-encoded input payload (default: null)
  --instance-id <id>             default: random UUID
  --correlation-id <id>          default: random UUID
  --timeout-ms <ms>              default: ${DEFAULT_TIMEOUT_MS}

COMMANDS
  list      Calls ListRegisteredActors and prints the actor keys currently registered.
  invoke    Calls Invoke for the given actor identity and prints the result.

DESCRIPTION
  A thin debug/test client for the Activity Gateway's gRPC contract
  (proto/activity-gateway.proto) — connects, calls one RPC, prints the
  result, and exits. Actor identity matches ActorPluginValidationResult /
  sidecar/protocol.ts's actorKey():
  parentFsmName@parentFsmVersion@fsmType@fsmName@fsmVersion@fsmLanguage.

EXAMPLE
  deno run --allow-all cli/async-operation-worker-gateway-ctl.ts list

  deno run --allow-all cli/async-operation-worker-gateway-ctl.ts invoke \\
    --parent-fsm-name creditCheck --parent-fsm-version v01 \\
    --fsm-type promise --fsm-name checkBureau --fsm-version v01 \\
    --fsm-language rust --input '{{"ssn":"123"}}'
`);
}

const args = parseArgs(Deno.args, {
  string: [
    "target",
    "parent-fsm-name",
    "parent-fsm-version",
    "fsm-type",
    "fsm-name",
    "fsm-version",
    "fsm-language",
    "input",
    "instance-id",
    "correlation-id",
    "timeout-ms",
  ],
  boolean: ["help"],
  alias: { h: "help" },
});

if (args.help) {
  printHelp();
  Deno.exit(0);
}

const command = String(args._[0] ?? "");
if (command !== "list" && command !== "invoke") {
  logger.error("First argument must be one of: list, invoke. Got: {command}", {
    command: command || "(none)",
  });
  printHelp();
  Deno.exit(1);
}

const target = args.target ?? DEFAULT_TARGET;
const client = new ActivityGatewayClient({ target });

try {
  if (command === "list") {
    const actors = await client.listRegisteredActors();
    if (actors.length === 0) {
      logger.info("No actors currently registered.");
    } else {
      logger.info("Registered actors ({count}):", { count: actors.length });
      for (const actor of actors) {
        logger.info("  {actor}", { actor });
      }
    }
  } else {
    const requiredFlags = [
      "parent-fsm-name",
      "parent-fsm-version",
      "fsm-type",
      "fsm-name",
      "fsm-version",
      "fsm-language",
    ] as const;
    const missing = requiredFlags.filter((key) => !args[key]);
    if (missing.length > 0) {
      logger.error("invoke requires: --{missing}", {
        missing: missing.join(", --"),
      });
      printHelp();
      Deno.exit(1);
    }

    let input: unknown = null;
    if (args.input) {
      try {
        input = JSON.parse(args.input);
      } catch (error) {
        logger.error("--input must be valid JSON: {error}", {
          error: error instanceof Error ? error.message : String(error),
        });
        Deno.exit(1);
      }
    }

    const result = await client.invokeActor({
      parentFsmName: args["parent-fsm-name"]!,
      parentFsmVersion: args["parent-fsm-version"]!,
      fsmType: args["fsm-type"]!,
      fsmName: args["fsm-name"]!,
      fsmVersion: args["fsm-version"]!,
      fsmLanguage: args["fsm-language"]!,
      input,
      instanceId: args["instance-id"] ?? crypto.randomUUID(),
      correlationId: args["correlation-id"] ?? crypto.randomUUID(),
      timeoutMs: args["timeout-ms"]
        ? Number(args["timeout-ms"])
        : DEFAULT_TIMEOUT_MS,
    });

    logger.info("Result: {output}", { output: JSON.stringify(result.output) });
  }
} catch (error) {
  const msg = error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
  logger.error("Command failed: {error}", { error: msg });
  client.close();
  Deno.exit(1);
}

client.close();
