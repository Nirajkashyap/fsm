import { assertEquals, assertExists } from "@std/assert";
import { copy } from "@std/fs/copy";
import {
  addMissingFsmTypeToInvokeActors,
  type FsmDraftStateNode,
  generateFsmJSONFromFolders,
  normalizeActionsToObjects,
} from "../src/generate-fsm-json.ts";

// --- addMissingFsmTypeToInvokeActors unit tests ---

Deno.test("addMissingFsmTypeToInvokeActors - adds missing fsmType and fsmVersion", () => {
  const fsmJSON: FsmDraftStateNode = {
    states: {
      idle: {
        invoke: [{ src: "someActor" }],
      },
    },
  };
  const { fulljson, childActorsInfo } = addMissingFsmTypeToInvokeActors(
    fsmJSON,
    "v01",
  );

  assertEquals(fulljson.states!.idle.invoke![0].fsmType, "promise");
  assertEquals(fulljson.states!.idle.invoke![0].fsmVersion, "v01");
  assertEquals(fulljson.states!.idle.invoke![0].fsmLanguage, "typescript");
  assertEquals(childActorsInfo.length, 1);
  assertEquals(childActorsInfo[0].child_actor_src, "someActor");
  assertEquals(childActorsInfo[0].child_actor_fsmType, "promise");
  assertEquals(childActorsInfo[0].child_actor_fsmVersion, "v01");
  assertEquals(childActorsInfo[0].child_actor_fsmLanguage, "typescript");
});

Deno.test("addMissingFsmTypeToInvokeActors - preserves existing fsmType and fsmVersion", () => {
  const fsmJSON: FsmDraftStateNode = {
    states: {
      idle: {
        invoke: [{
          src: "sharedActor",
          fsmType: "sharedFsm",
          fsmVersion: "v02",
          fsmLanguage: "python",
        }],
      },
    },
  };
  const { fulljson, childActorsInfo } = addMissingFsmTypeToInvokeActors(
    fsmJSON,
    "v01",
  );

  assertEquals(fulljson.states!.idle.invoke![0].fsmType, "sharedFsm");
  assertEquals(fulljson.states!.idle.invoke![0].fsmVersion, "v02");
  assertEquals(fulljson.states!.idle.invoke![0].fsmLanguage, "python");
  assertEquals(childActorsInfo[0].child_actor_fsmType, "sharedFsm");
  assertEquals(childActorsInfo[0].child_actor_fsmVersion, "v02");
  assertEquals(childActorsInfo[0].child_actor_fsmLanguage, "python");
});

Deno.test("addMissingFsmTypeToInvokeActors - handles nested states", () => {
  const fsmJSON: FsmDraftStateNode = {
    states: {
      outer: {
        states: {
          inner: {
            invoke: [{ src: "nestedActor" }],
          },
        },
      },
    },
  };
  const { childActorsInfo } = addMissingFsmTypeToInvokeActors(fsmJSON, "v01");
  assertEquals(childActorsInfo.length, 1);
  assertEquals(childActorsInfo[0].child_actor_src, "nestedActor");
});

Deno.test("addMissingFsmTypeToInvokeActors - handles root-level invoke", () => {
  const fsmJSON: FsmDraftStateNode = {
    invoke: [{ src: "rootActor" }],
    states: {},
  };
  const { childActorsInfo } = addMissingFsmTypeToInvokeActors(fsmJSON, "v01");
  assertEquals(childActorsInfo.length, 1);
  assertEquals(childActorsInfo[0].child_actor_src, "rootActor");
});

Deno.test("addMissingFsmTypeToInvokeActors - returns empty childActorsInfo when no invoke", () => {
  const fsmJSON: FsmDraftStateNode = { states: { idle: {} } };
  const { childActorsInfo } = addMissingFsmTypeToInvokeActors(fsmJSON, "v01");
  assertEquals(childActorsInfo.length, 0);
});

Deno.test("addMissingFsmTypeToInvokeActors - does not mutate original", () => {
  const fsmJSON: FsmDraftStateNode = {
    states: { idle: { invoke: [{ src: "actor" }] } },
  };
  const original = JSON.stringify(fsmJSON);
  addMissingFsmTypeToInvokeActors(fsmJSON, "v01");
  assertEquals(JSON.stringify(fsmJSON), original);
});

// --- normalizeActionsToObjects unit tests ---

Deno.test("normalizeActionsToObjects - converts string entry/exit actions to { type }", () => {
  const input: FsmDraftStateNode = {
    states: {
      idle: {
        entry: ["doEnter", "doAlso"],
        exit: ["doExit"],
      },
    },
  };
  const result = normalizeActionsToObjects(input);
  assertEquals(result.states!.idle.entry, [{ type: "doEnter" }, {
    type: "doAlso",
  }]);
  assertEquals(result.states!.idle.exit, [{ type: "doExit" }]);
});

Deno.test("normalizeActionsToObjects - converts string actions in on-transitions", () => {
  const input: FsmDraftStateNode = {
    states: {
      idle: {
        on: {
          NEXT: [{
            actions: ["assignFoo", "assignBar"],
            eventType: "NEXT",
            source: "idle",
            target: ["active"],
          }],
        },
      },
    },
  };
  const result = normalizeActionsToObjects(input);
  assertEquals(
    result.states!.idle.on!.NEXT[0].actions,
    [{ type: "assignFoo" }, { type: "assignBar" }],
  );
});

Deno.test("normalizeActionsToObjects - converts string actions in transitions array", () => {
  const input: FsmDraftStateNode = {
    states: {
      idle: {
        transitions: [{
          actions: ["doSomething"],
          eventType: "GO",
          source: "idle",
          target: ["done"],
        }],
      },
    },
  };
  const result = normalizeActionsToObjects(input);
  assertEquals(result.states!.idle.transitions![0].actions, [{
    type: "doSomething",
  }]);
});

Deno.test("normalizeActionsToObjects - converts string actions in initial transition", () => {
  const input: FsmDraftStateNode = {
    initial: { actions: ["initAction"], source: "root", target: ["idle"] },
    states: { idle: {} },
  };
  const result = normalizeActionsToObjects(input);
  assertEquals(result.initial!.actions, [{ type: "initAction" }]);
});

Deno.test("normalizeActionsToObjects - leaves existing actionObjects unchanged", () => {
  const input: FsmDraftStateNode = {
    states: {
      idle: {
        entry: [{ type: "alreadyObject", extra: true }],
      },
    },
  };
  const result = normalizeActionsToObjects(input);
  assertEquals(result.states!.idle.entry, [{
    type: "alreadyObject",
    extra: true,
  }]);
});

Deno.test("normalizeActionsToObjects - handles nested states recursively", () => {
  const input: FsmDraftStateNode = {
    states: {
      outer: {
        states: {
          inner: {
            entry: ["nestedAction"],
          },
        },
      },
    },
  };
  const result = normalizeActionsToObjects(input);
  assertEquals(result.states!.outer.states!.inner.entry, [{
    type: "nestedAction",
  }]);
});

Deno.test("normalizeActionsToObjects - does not mutate original", () => {
  const input: FsmDraftStateNode = {
    states: { idle: { entry: ["doEnter"] } },
  };
  const original = JSON.stringify(input);
  normalizeActionsToObjects(input);
  assertEquals(JSON.stringify(input), original);
});

// --- generateFsmJSONFromFolders integration tests ---
// generateFsmJSONFromFolders writes fsm.json/xstate-fsm.json in place, so
// these must run against a disposable copy, never the tracked
// apps/fsm-core-example (see #125).

const FIXTURE_ROOT = await Deno.makeTempDir({
  prefix: "fsm-compiler-generate-fsm-json-",
});
const APP_ROOT = `${FIXTURE_ROOT}/fsm-core-example`;
await copy("apps/fsm-core-example", APP_ROOT);
const FSM_FOLDER = `${APP_ROOT}/fsm`;
// vitalsWorkflow is a shared, reusable sub-workflow (fsmType "sharedFsm"),
// living alongside the top-level FSMs (fsmType "fsm") under the same fsm/
// folder.
const SHARED_FSM_SKIP_DIRS = ["carVitals", "creditCheck", "taskMachineConfig"];

Deno.test("generateFsmJSONFromFolders - generates fsm.json for fsm folder", async () => {
  await generateFsmJSONFromFolders(FSM_FOLDER, []);

  const stat = await Deno.stat(`${FSM_FOLDER}/creditCheck/v01/fsm.json`);
  assertEquals(stat.isFile, true);
});

Deno.test("generateFsmJSONFromFolders - generates fsm.json for vitalsWorkflow (shared)", async () => {
  await generateFsmJSONFromFolders(
    FSM_FOLDER,
    SHARED_FSM_SKIP_DIRS,
  );

  const stat = await Deno.stat(
    `${FSM_FOLDER}/vitalsWorkflow/v01/fsm.json`,
  );
  assertEquals(stat.isFile, true);
});

Deno.test("generateFsmJSONFromFolders - showRecommendation=false produces no recommendation output", async () => {
  // Captures that the function completes without error when showRecommendation is false (default)
  await generateFsmJSONFromFolders(FSM_FOLDER, [], false);
});

Deno.test("generateFsmJSONFromFolders - showRecommendation=true runs AJV validation without throwing", async () => {
  // Should complete without throwing even if schema issues exist
  await generateFsmJSONFromFolders(FSM_FOLDER, [], true);
});

Deno.test("generateFsmJSONFromFolders - showRecommendation=true on vitalsWorkflow (shared) runs AJV validation without throwing", async () => {
  await generateFsmJSONFromFolders(
    FSM_FOLDER,
    SHARED_FSM_SKIP_DIRS,
    true,
  );
});

Deno.test("generateFsmJSONFromFolders - respects skipDirs", async () => {
  // carVitals is skipped — its fsm.json may or may not exist but no error is thrown
  await generateFsmJSONFromFolders(FSM_FOLDER, ["carVitals"]);
});

Deno.test("generateFsmJSONFromFolders - throws on path starting with '.'", async () => {
  let threw = false;
  try {
    await generateFsmJSONFromFolders("./relative/path");
  } catch (e) {
    threw = true;
    assertExists((e as Error).message.match(/cannot start with/i));
  }
  assertEquals(threw, true);
});

Deno.test("generateFsmJSONFromFolders - throws on path ending with '/'", async () => {
  let threw = false;
  try {
    await generateFsmJSONFromFolders("some/path/");
  } catch (e) {
    threw = true;
    assertExists((e as Error).message.match(/cannot end with/i));
  }
  assertEquals(threw, true);
});

// --- Cleanup ---
// Deno runs tests within a file sequentially in declaration order (absent
// --parallel), so this runs last and removes the fixture copy every prior
// test in this file wrote into.
Deno.test("cleanup fixture copy", async () => {
  await Deno.remove(FIXTURE_ROOT, { recursive: true });
});
