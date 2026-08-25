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
  fsm: {
    folderPath: new URL("../fsm-core-example/fsm", import.meta.url).pathname,
    skipDirs: [],
  },
});

const host = new Hono();
host.route(urlPathPrefix, fsmRouter);

export default host;
