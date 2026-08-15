import dotenv from "dotenv";
import { getLogger } from "@logtape/logtape";
import { configureCompilerLogger } from "./logger.ts";
import { loadFsmJSONFromFolders } from "./load-fsm-json.ts";
import { Pool } from "pg";

dotenv.config({ path: "./../../.env" });
const logger = getLogger(["@pgfsm/compiler", "test"]);
await configureCompilerLogger();

const pool = new Pool({ connectionString: Deno.env.get("DATABASE_URL") });

(async () => {
  const fsmfolderPath = "apps/fsm-core-example/fsm";

  const deps = {
    db: pool,
  };

  // vitalsWorkflow is a shared, reusable sub-workflow (fsmType "sharedFsm"),
  // so it's scanned separately from the top-level FSMs (fsmType "fsm") even
  // though both now live under the same fsm/ folder.
  await loadFsmJSONFromFolders(
    fsmfolderPath,
    "sharedFsm",
    ["carVitals", "creditCheck", "taskMachineConfig"],
    deps,
  );
  await loadFsmJSONFromFolders(
    fsmfolderPath,
    "fsm",
    ["vitalsWorkflow"],
    deps,
  );
  logger.info("All workflows inserted successfully");
})();
