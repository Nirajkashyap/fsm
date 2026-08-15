// apps/host/app.ts
import { Hono } from "hono";
import createApp from "../fsm-core-ts-hono-deno/lib/create-app.ts";

const urlPathPrefix = "/fsm";

const fsmRouter = await createApp(urlPathPrefix, {
  sharedPromise: {
    folderPath:
      new URL("../fsm-core-example/sharedPromise", import.meta.url).pathname,
    skipDirs: [],
  },
  // vitalsWorkflow is a shared, reusable sub-workflow (fsmType "sharedFsm"),
  // living alongside the top-level FSMs (fsmType "fsm") under the same fsm/
  // folder — split here via skipDirs rather than a separate folder.
  sharedFsm: {
    folderPath: new URL("../fsm-core-example/fsm", import.meta.url).pathname,
    skipDirs: ["carVitals", "creditCheck", "taskMachineConfig"],
  },
  fsm: {
    folderPath: new URL("../fsm-core-example/fsm", import.meta.url).pathname,
    skipDirs: ["vitalsWorkflow"],
  },
});

const host = new Hono();
host.route(urlPathPrefix, fsmRouter);

export default host;
