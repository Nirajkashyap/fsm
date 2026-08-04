import { assertEquals, assertExists } from "@std/assert";
import {
  type OperationKind,
  type OperationLang,
  type RegisteredActor,
  renderOperationModule,
  toRegisteredActor,
  toWrittenActor,
  writeActorFile,
  writeActorsBarrel,
  writeActorsManifest,
  writeActorsRegistry,
  writeAggregateActorsRegistry,
  type WrittenActor,
} from "../src/operation-logic-scaffold.ts";
import type { ActorReference } from "../src/util.ts";

type Case = {
  lang: OperationLang;
  kind: OperationKind;
  name: string;
  expected: string;
};

// A single stub in a module ends the file — renderOperationModule collapses
// the template's blank-line separator down to one trailing newline, matching
// `deno fmt`'s convention (see withSingleTrailingNewline in
// operation-logic-scaffold.ts).
const cases: Case[] = [
  // typescript
  {
    lang: "typescript",
    kind: "actions",
    name: "sendEmail",
    expected:
      "// Action: sendEmail\nexport function sendEmail(context: any, event: any) {\n  // TODO: implement\n}\n",
  },
  {
    lang: "typescript",
    kind: "guards",
    name: "isEligible",
    expected:
      "// Guard: isEligible\nexport function isEligible(context: any, event: any) {\n  // TODO: implement\n  return true;\n}\n",
  },
  {
    lang: "typescript",
    kind: "delays",
    name: "cooldown",
    expected:
      "// Delay: cooldown\nexport function delaycooldown(context: any, event: any): number {\n  // TODO: implement delay logic (return ms)\n  return 0;\n}\n",
  },
  {
    lang: "typescript",
    kind: "actors",
    name: "creditCheck",
    expected:
      "// Actor: creditCheck\nexport function creditCheck(input: unknown): unknown {\n  // TODO: implement actor logic\n  return {};\n}\n",
  },
  // python
  {
    lang: "python",
    kind: "actions",
    name: "sendEmail",
    expected:
      "# Action: sendEmail\ndef sendEmail(context, event):\n    # TODO: implement\n    pass\n",
  },
  {
    lang: "python",
    kind: "guards",
    name: "isEligible",
    expected:
      "# Guard: isEligible\ndef isEligible(context, event):\n    # TODO: implement\n    return True\n",
  },
  {
    lang: "python",
    kind: "delays",
    name: "cooldown",
    expected:
      "# Delay: cooldown\ndef delaycooldown(context, event):\n    # TODO: implement delay logic (return ms)\n    return 0\n",
  },
  {
    lang: "python",
    kind: "actors",
    name: "creditCheck",
    expected:
      "# Actor: creditCheck\ndef creditCheck(input):\n    # TODO: implement actor logic\n    return {}\n",
  },
  // rust
  {
    lang: "rust",
    kind: "actions",
    name: "sendEmail",
    expected:
      "// Action: sendEmail\n#[allow(non_snake_case)]\npub fn sendEmail(context: &serde_json::Value, event: &serde_json::Value) {\n    // TODO: implement\n}\n",
  },
  {
    lang: "rust",
    kind: "guards",
    name: "isEligible",
    expected:
      "// Guard: isEligible\n#[allow(non_snake_case)]\npub fn isEligible(context: &serde_json::Value, event: &serde_json::Value) -> bool {\n    // TODO: implement\n    true\n}\n",
  },
  {
    lang: "rust",
    kind: "delays",
    name: "cooldown",
    expected:
      "// Delay: cooldown\n#[allow(non_snake_case)]\npub fn delaycooldown(context: &serde_json::Value, event: &serde_json::Value) -> u64 {\n    // TODO: implement delay logic (return ms)\n    0\n}\n",
  },
  {
    lang: "rust",
    kind: "actors",
    name: "creditCheck",
    expected:
      "// Actor: creditCheck\n#[allow(non_snake_case)]\npub fn creditCheck(input: serde_json::Value) -> serde_json::Value {\n    // TODO: implement actor logic\n    serde_json::json!({})\n}\n",
  },
  // go (renderOperationModule prefixes the `package <kind>` header — accounted
  // for separately below, these cases cover the per-name stub only)
  {
    lang: "go",
    kind: "actions",
    name: "sendEmail",
    expected:
      "// Action: sendEmail\nfunc sendEmail(context map[string]any, event map[string]any) {\n\t// TODO: implement\n}\n",
  },
  {
    lang: "go",
    kind: "guards",
    name: "isEligible",
    expected:
      "// Guard: isEligible\nfunc isEligible(context map[string]any, event map[string]any) bool {\n\t// TODO: implement\n\treturn true\n}\n",
  },
  {
    lang: "go",
    kind: "delays",
    name: "cooldown",
    expected:
      "// Delay: cooldown\nfunc delaycooldown(context map[string]any, event map[string]any) int64 {\n\t// TODO: implement delay logic (return ms)\n\treturn 0\n}\n",
  },
  {
    lang: "go",
    kind: "actors",
    name: "creditCheck",
    expected:
      // Go exports (capitalizes) actor function names for cross-package
      // access — see toGoExportedName / #83. Other kinds/languages don't.
      "// Actor: creditCheck\nfunc CreditCheck(input any) (any, error) {\n\t// TODO: implement actor logic\n\treturn map[string]any{}, nil\n}\n",
  },
];

for (const { lang, kind, name, expected } of cases) {
  Deno.test(`renderOperationModule - ${lang}/${kind}`, () => {
    const goHeader = lang === "go" ? `package ${kind}\n\n` : "";
    assertEquals(
      renderOperationModule(lang, kind, [name]),
      goHeader + expected,
    );
  });
}

Deno.test("renderOperationModule - multiple stubs keep a blank-line separator between them, single trailing newline at the end", () => {
  const out = renderOperationModule("typescript", "actions", [
    "sendEmail",
    "sendSms",
  ]);
  assertEquals(
    out,
    "// Action: sendEmail\nexport function sendEmail(context: any, event: any) {\n  // TODO: implement\n}\n" +
      "\n" +
      "// Action: sendSms\nexport function sendSms(context: any, event: any) {\n  // TODO: implement\n}\n",
  );
});

Deno.test("writeActorFile - go actor gets a package header, exported (capitalized) function, and its own subfolder", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const actor: ActorReference = { src: "creditCheck" };
    const file = await writeActorFile(dir, "go", actor);
    assertEquals(file, `${dir}/go/actors/creditCheck/creditCheck.go`);
    const content = await Deno.readTextFile(file);
    assertEquals(
      content,
      "package actors\n\n// Actor: creditCheck\nfunc CreditCheck(input any) (any, error) {\n\t// TODO: implement actor logic\n\treturn map[string]any{}, nil\n}\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorFile - go actor also writes its own go.mod, module path derived from the FSM/version/actor folder names", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const absFolderPath = `${dir}/apps/fsm-core-example/fsm/creditCheck/v01`;
    await Deno.mkdir(absFolderPath, { recursive: true });
    const actor: ActorReference = { src: "checkBureau" };
    await writeActorFile(absFolderPath, "go", actor);
    const goModContent = await Deno.readTextFile(
      `${absFolderPath}/go/actors/checkBureau/go.mod`,
    );
    assertEquals(
      goModContent,
      "module fsm-core-example/creditcheck/v01/go/actors/checkbureau\n\ngo 1.19\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorFile - typescript actor has no package header", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const actor: ActorReference = { src: "creditCheck" };
    const file = await writeActorFile(dir, "typescript", actor);
    assertEquals(file, `${dir}/typescript/actors/creditCheck/creditCheck.ts`);
    const content = await Deno.readTextFile(file);
    assertEquals(
      content,
      "// Actor: creditCheck\nexport function creditCheck(input: unknown): unknown {\n  // TODO: implement actor logic\n  return {};\n}\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("toWrittenActor - builds record matching writeActorFile's path convention", () => {
  const actor: ActorReference = { src: "checkBureau" };
  assertEquals(toWrittenActor("typescript", actor), {
    src: "checkBureau",
    fileBaseName: "checkBureau",
    fsmLanguage: "typescript",
    filePath: "typescript/actors/checkBureau/checkBureau.ts",
    exportedName: "checkBureau",
  });
});

Deno.test("toWrittenActor - go capitalizes exportedName for cross-package export, src is untouched", () => {
  const actor: ActorReference = { src: "checkBureau" };
  assertEquals(toWrittenActor("go", actor), {
    src: "checkBureau",
    fileBaseName: "checkBureau",
    fsmLanguage: "go",
    filePath: "go/actors/checkBureau/checkBureau.go",
    exportedName: "CheckBureau",
  });
});

Deno.test("writeActorsManifest - writes all actors across all languages", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const actors: WrittenActor[] = [
      toWrittenActor("typescript", { src: "checkBureau" }),
      toWrittenActor("python", { src: "checkBureauPython" }),
      toWrittenActor("go", { src: "checkBureauGo" }),
    ];
    const file = await writeActorsManifest(dir, actors);
    assertEquals(file, `${dir}/actors-manifest.json`);
    const manifest = JSON.parse(await Deno.readTextFile(file));
    assertEquals(manifest, {
      actors: [
        {
          src: "checkBureau",
          fsmLanguage: "typescript",
          filePath: "typescript/actors/checkBureau/checkBureau.ts",
          exportedName: "checkBureau",
        },
        {
          src: "checkBureauPython",
          fsmLanguage: "python",
          filePath: "python/actors/checkBureauPython/checkBureauPython.py",
          exportedName: "checkBureauPython",
        },
        {
          src: "checkBureauGo",
          fsmLanguage: "go",
          filePath: "go/actors/checkBureauGo/checkBureauGo.go",
          exportedName: "CheckBureauGo",
        },
      ],
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsManifest - writes an empty manifest when there are no actors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeActorsManifest(dir, []);
    const manifest = JSON.parse(await Deno.readTextFile(file));
    assertEquals(manifest, { actors: [] });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// A version-folder path matching the `<pluginRoot>/<fsmName>/<version>`
// convention, so toRegisteredActor can derive parentFsmName/parentFsmVersion.
const CREDIT_CHECK_V01 = "/repo/apps/fsm-core-example/fsm/creditCheck/v01";

const actorsForBarrelTests: RegisteredActor[] = [
  toRegisteredActor(CREDIT_CHECK_V01, "typescript", { src: "checkBureau" }),
  toRegisteredActor(CREDIT_CHECK_V01, "typescript", {
    src: "determineMiddleScore",
  }),
  toRegisteredActor(CREDIT_CHECK_V01, "python", { src: "checkBureauPython" }),
  toRegisteredActor(CREDIT_CHECK_V01, "rust", { src: "checkBureau" }),
];

Deno.test("writeActorsBarrel - typescript re-exports only typescript actors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeActorsBarrel(
      dir,
      actorsForBarrelTests,
      "typescript",
    );
    assertEquals(file, `${dir}/typescript/actors/index.ts`);
    const content = await Deno.readTextFile(file!);
    assertEquals(
      content,
      'export { checkBureau } from "./checkBureau/checkBureau.ts";\n' +
        'export { determineMiddleScore } from "./determineMiddleScore/determineMiddleScore.ts";\n',
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsBarrel - python writes an __init__.py with namespace-package imports", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeActorsBarrel(dir, actorsForBarrelTests, "python");
    assertEquals(file, `${dir}/python/actors/__init__.py`);
    const content = await Deno.readTextFile(file!);
    assertEquals(
      content,
      "from .checkBureauPython.checkBureauPython import checkBureauPython\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsBarrel - rust writes a mod.rs with #[path] attributes", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeActorsBarrel(dir, actorsForBarrelTests, "rust");
    assertEquals(file, `${dir}/rust/actors/mod.rs`);
    const content = await Deno.readTextFile(file!);
    assertEquals(
      content,
      '#[path = "checkBureau/checkBureau.rs"]\n' +
        "#[allow(non_snake_case)]\n" +
        "mod checkBureau;\n" +
        "pub use checkBureau::checkBureau;\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsBarrel - writes nothing when there are no actors for that language", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const actors: WrittenActor[] = [
      toWrittenActor("python", { src: "checkBureauPython" }),
    ];
    const file = await writeActorsBarrel(dir, actors, "typescript");
    assertEquals(file, undefined);
    let existsErr: unknown;
    try {
      await Deno.stat(`${dir}/typescript`);
    } catch (err) {
      existsErr = err;
    }
    assertExists(existsErr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsRegistry - typescript carries the full activity-registration identity per actor", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeActorsRegistry(
      dir,
      actorsForBarrelTests,
      "typescript",
    );
    assertEquals(file, `${dir}/typescript/actors/generated-registry.ts`);
    const content = await Deno.readTextFile(file!);
    assertEquals(
      content,
      'import { checkBureau } from "./checkBureau/checkBureau.ts";\n' +
        'import { determineMiddleScore } from "./determineMiddleScore/determineMiddleScore.ts";\n' +
        "\n" +
        "export type ActorRegistration = {\n" +
        "  parentFsmName: string;\n" +
        "  parentFsmVersion: string;\n" +
        "  fsmType: string;\n" +
        "  fsmName: string;\n" +
        "  fsmVersion: string;\n" +
        "  fsmLanguage: string;\n" +
        "  handler: (input: unknown) => unknown;\n" +
        "};\n" +
        "\n" +
        "export const ACTOR_REGISTRATIONS: ActorRegistration[] = [\n" +
        "  {\n" +
        '    parentFsmName: "creditCheck",\n' +
        '    parentFsmVersion: "v01",\n' +
        '    fsmType: "promise",\n' +
        '    fsmName: "checkBureau",\n' +
        '    fsmVersion: "v01",\n' +
        '    fsmLanguage: "typescript",\n' +
        "    handler: checkBureau,\n" +
        "  },\n" +
        "  {\n" +
        '    parentFsmName: "creditCheck",\n' +
        '    parentFsmVersion: "v01",\n' +
        '    fsmType: "promise",\n' +
        '    fsmName: "determineMiddleScore",\n' +
        '    fsmVersion: "v01",\n' +
        '    fsmLanguage: "typescript",\n' +
        "    handler: determineMiddleScore,\n" +
        "  },\n" +
        "];\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsRegistry - python carries the full activity-registration identity per actor", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeActorsRegistry(
      dir,
      actorsForBarrelTests,
      "python",
    );
    assertEquals(file, `${dir}/python/actors/generated_registry.py`);
    const content = await Deno.readTextFile(file!);
    assertEquals(
      content,
      "import importlib.util\n" +
        "import os\n" +
        "\n" +
        "_BASE_DIR = os.path.dirname(os.path.abspath(__file__))\n" +
        "\n" +
        "\n" +
        "def _load_actor(rel_path, fn_name):\n" +
        "    spec = importlib.util.spec_from_file_location(\n" +
        "        fn_name, os.path.join(_BASE_DIR, rel_path)\n" +
        "    )\n" +
        "    module = importlib.util.module_from_spec(spec)\n" +
        "    spec.loader.exec_module(module)\n" +
        "    return getattr(module, fn_name)\n" +
        "\n" +
        "\n" +
        'checkBureauPython = _load_actor("checkBureauPython/checkBureauPython.py", "checkBureauPython")\n' +
        "\n" +
        "ACTOR_REGISTRATIONS = [\n" +
        "    {\n" +
        '        "parent_fsm_name": "creditCheck",\n' +
        '        "parent_fsm_version": "v01",\n' +
        '        "fsm_type": "promise",\n' +
        '        "fsm_name": "checkBureauPython",\n' +
        '        "fsm_version": "v01",\n' +
        '        "fsm_language": "python",\n' +
        '        "handler": checkBureauPython,\n' +
        "    },\n" +
        "]\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsRegistry - rust reuses the barrel's #[path] module instead of redeclaring it", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeActorsRegistry(dir, actorsForBarrelTests, "rust");
    assertEquals(file, `${dir}/rust/actors/generated_registry.rs`);
    const content = await Deno.readTextFile(file!);
    assertEquals(
      content,
      '#[path = "mod.rs"]\n' +
        "mod actors;\n" +
        "\n" +
        "pub struct ActorRegistration {\n" +
        "    pub parent_fsm_name: &'static str,\n" +
        "    pub parent_fsm_version: &'static str,\n" +
        "    pub fsm_type: &'static str,\n" +
        "    pub fsm_name: &'static str,\n" +
        "    pub fsm_version: &'static str,\n" +
        "    pub fsm_language: &'static str,\n" +
        "    pub handler: fn(serde_json::Value) -> serde_json::Value,\n" +
        "}\n" +
        "\n" +
        "pub fn actor_registrations() -> Vec<ActorRegistration> {\n" +
        "    vec![\n" +
        "        ActorRegistration {\n" +
        '            parent_fsm_name: "creditCheck",\n' +
        '            parent_fsm_version: "v01",\n' +
        '            fsm_type: "promise",\n' +
        '            fsm_name: "checkBureau",\n' +
        '            fsm_version: "v01",\n' +
        '            fsm_language: "rust",\n' +
        "            handler: actors::checkBureau,\n" +
        "        },\n" +
        "    ]\n" +
        "}\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsRegistry - writes nothing when there are no actors for that language", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const actors: RegisteredActor[] = [
      toRegisteredActor(CREDIT_CHECK_V01, "python", {
        src: "checkBureauPython",
      }),
    ];
    const file = await writeActorsRegistry(dir, actors, "typescript");
    assertEquals(file, undefined);
    let existsErr: unknown;
    try {
      await Deno.stat(`${dir}/typescript`);
    } catch (err) {
      existsErr = err;
    }
    assertExists(existsErr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const OTHER_FSM_V02 = "/repo/apps/fsm-core-example/fsm/otherFsm/v02";

const actorsForAggregateTests: RegisteredActor[] = [
  ...actorsForBarrelTests,
  toRegisteredActor(OTHER_FSM_V02, "typescript", { src: "someActor" }),
  toRegisteredActor(OTHER_FSM_V02, "python", { src: "someActorPy" }),
  toRegisteredActor(OTHER_FSM_V02, "rust", { src: "someActorRs" }),
];

Deno.test("writeAggregateActorsRegistry - typescript re-imports and flattens each FSM-version's registry", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeAggregateActorsRegistry(
      dir,
      "fsm",
      actorsForAggregateTests,
      "typescript",
    );
    assertEquals(file, `${dir}/typescript-actors-registry.generated.ts`);
    const content = await Deno.readTextFile(file!);
    assertEquals(
      content,
      'import { ACTOR_REGISTRATIONS as creditcheck_v01 } from "./fsm/creditCheck/v01/typescript/actors/generated-registry.ts";\n' +
        'import { ACTOR_REGISTRATIONS as otherfsm_v02 } from "./fsm/otherFsm/v02/typescript/actors/generated-registry.ts";\n' +
        "\n" +
        "export const ACTOR_REGISTRATIONS = [\n" +
        "  ...creditcheck_v01,\n" +
        "  ...otherfsm_v02,\n" +
        "];\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeAggregateActorsRegistry - python loads each FSM-version's registry from a fixed path", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeAggregateActorsRegistry(
      dir,
      "fsm",
      actorsForAggregateTests,
      "python",
    );
    assertEquals(file, `${dir}/python_actors_registry_generated.py`);
    const content = await Deno.readTextFile(file!);
    assertEquals(
      content,
      "# Each FSM-version's registry is loaded from a fixed, compiler-generated\n" +
        "# path -- not a runtime scan -- since Python has no static-import syntax that\n" +
        "# reaches an arbitrarily-nested sibling directory the way TS/Rust do.\n" +
        "import importlib.util\n" +
        "import os\n" +
        "\n" +
        "_BASE_DIR = os.path.dirname(os.path.abspath(__file__))\n" +
        "\n" +
        "\n" +
        "def _load_registrations(rel_path):\n" +
        "    spec = importlib.util.spec_from_file_location(\n" +
        '        "generated_registry", os.path.join(_BASE_DIR, rel_path)\n' +
        "    )\n" +
        "    module = importlib.util.module_from_spec(spec)\n" +
        "    spec.loader.exec_module(module)\n" +
        "    return module.ACTOR_REGISTRATIONS\n" +
        "\n" +
        "\n" +
        'creditcheck_v01 = _load_registrations("fsm/creditCheck/v01/python/actors/generated_registry.py")\n' +
        'otherfsm_v02 = _load_registrations("fsm/otherFsm/v02/python/actors/generated_registry.py")\n' +
        "\n" +
        "ACTOR_REGISTRATIONS = [\n" +
        "    *creditcheck_v01,\n" +
        "    *otherfsm_v02,\n" +
        "]\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeAggregateActorsRegistry - rust #[path]-includes each FSM-version's actor barrel under a unique alias", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await writeAggregateActorsRegistry(
      dir,
      "fsm",
      actorsForAggregateTests,
      "rust",
    );
    assertEquals(file, `${dir}/rust-actors-registry.generated.rs`);
    const content = await Deno.readTextFile(file!);
    assertEquals(
      content,
      '#[path = "fsm/creditCheck/v01/rust/actors/mod.rs"]\n' +
        "mod creditcheck_v01;\n" +
        "\n" +
        '#[path = "fsm/otherFsm/v02/rust/actors/mod.rs"]\n' +
        "mod otherfsm_v02;\n" +
        "\n" +
        "pub struct ActorRegistration {\n" +
        "    pub parent_fsm_name: &'static str,\n" +
        "    pub parent_fsm_version: &'static str,\n" +
        "    pub fsm_type: &'static str,\n" +
        "    pub fsm_name: &'static str,\n" +
        "    pub fsm_version: &'static str,\n" +
        "    pub fsm_language: &'static str,\n" +
        "    pub handler: fn(serde_json::Value) -> serde_json::Value,\n" +
        "}\n" +
        "\n" +
        "pub fn actor_registrations() -> Vec<ActorRegistration> {\n" +
        "    vec![\n" +
        "        ActorRegistration {\n" +
        '            parent_fsm_name: "creditCheck",\n' +
        '            parent_fsm_version: "v01",\n' +
        '            fsm_type: "promise",\n' +
        '            fsm_name: "checkBureau",\n' +
        '            fsm_version: "v01",\n' +
        '            fsm_language: "rust",\n' +
        "            handler: creditcheck_v01::checkBureau,\n" +
        "        },\n" +
        "        ActorRegistration {\n" +
        '            parent_fsm_name: "otherFsm",\n' +
        '            parent_fsm_version: "v02",\n' +
        '            fsm_type: "promise",\n' +
        '            fsm_name: "someActorRs",\n' +
        '            fsm_version: "v02",\n' +
        '            fsm_language: "rust",\n' +
        "            handler: otherfsm_v02::someActorRs,\n" +
        "        },\n" +
        "    ]\n" +
        "}\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeAggregateActorsRegistry - writes nothing when there are no actors for that language", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const actors: RegisteredActor[] = [
      toRegisteredActor(CREDIT_CHECK_V01, "python", {
        src: "checkBureauPython",
      }),
    ];
    const file = await writeAggregateActorsRegistry(
      dir,
      "fsm",
      actors,
      "typescript",
    );
    assertEquals(file, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
