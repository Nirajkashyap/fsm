import dotenv from "dotenv";
import { getLogger } from "@logtape/logtape";
import { configureCompilerLogger } from "./logger.ts";
import { validateSyncOperationFromFolders } from "./validate-sync-operation-logic.ts";

dotenv.config({ path: "./../../.env" });
const logger = getLogger(["@pgfsm/compiler", "test"]);
await configureCompilerLogger();

(async () => {
  const fsmfolderPath = "apps/fsm-core-example/fsm";

  // vitalsWorkflow is a shared, reusable sub-workflow (fsmType "sharedFsm"),
  // so it's scanned separately from the top-level FSMs (fsmType "fsm") even
  // though both now live under the same fsm/ folder.
  const outputSharedFSM = await validateSyncOperationFromFolders(
    fsmfolderPath,
    "sharedFsm",
    ["carVitals", "creditCheck", "taskMachineConfig"],
    [],
  );
  const outputFSM = await validateSyncOperationFromFolders(
    fsmfolderPath,
    "fsm",
    ["vitalsWorkflow"],
    outputSharedFSM,
  );
  logger.info("final output: {output}", { output: outputFSM });
})();
