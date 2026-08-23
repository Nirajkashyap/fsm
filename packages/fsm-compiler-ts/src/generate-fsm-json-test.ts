import dotenv from "dotenv";
import { getLogger } from "@logtape/logtape";
import { configureCompilerLogger } from "./logger.ts";
import { generateFsmJSONFromFolders } from "./generate-fsm-json.ts";

dotenv.config({ path: "./../../.env" });
const logger = getLogger(["@pgfsm/compiler", "test"]);
await configureCompilerLogger();

const fsmfolderPath = "apps/fsm-core-example/fsm";

(async () => {
  logger.info("=== generateFsmJSON tests ===");

  const skipFSMDirs = ["carVitals", "taskMachineConfig", "vitalsWorkflow"];
  logger.info("--- generate fsm (showRecommendation = true) ---");
  await generateFsmJSONFromFolders(fsmfolderPath, skipFSMDirs, true);
  logger.info("fsm generated with recommendation");

  logger.info("=== generateFsmJSON tests complete ===");
})();
