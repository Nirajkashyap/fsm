import dotenv from "dotenv";
import { deleteFsmJSONFromFolders } from "./delete-fsm-json-from-folders.ts";

dotenv.config({ path: "./../../.env" });

(async () => {
  // const folderPath = Deno.args[0] || Deno.cwd()+ "/packages/fsm-compiler-ts/src/sampleFSMfromFolder";
  // const fsmfolderPath = 'packages/fsm-compiler-ts/src/example/fsm';
  const fsmfolderPath = "apps/fsm-core-example/fsm";
  // try {
  //   const stat = await Deno.stat(folderPath);
  //   if (!stat.isDirectory) {
  //     throw new Error(`Provided path '${folderPath}' is not a directory.`);
  //   }
  // } catch (err) {
  //   throw new Error(`Directory '${folderPath}' does not exist.`);
  // }

  const skipFSMDirs = ["carVitals", "taskMachineConfig", "vitalsWorkflow"];
  // const skipFSMDirs = [];
  await deleteFsmJSONFromFolders(
    fsmfolderPath,
    skipFSMDirs,
  );
})();
