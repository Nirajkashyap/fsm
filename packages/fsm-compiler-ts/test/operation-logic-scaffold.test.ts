import { assertEquals, assertExists } from "@std/assert";
import {
  type OperationKind,
  type OperationLang,
  renderOperationModule,
  toWrittenActor,
  writeActorFile,
  writeActorsBarrel,
  writeActorsManifest,
  writeActorsRegistry,
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

const actorsForBarrelTests: WrittenActor[] = [
  toWrittenActor("typescript", { src: "checkBureau" }),
  toWrittenActor("typescript", { src: "determineMiddleScore" }),
  toWrittenActor("python", { src: "checkBureauPython" }),
  toWrittenActor("rust", { src: "checkBureau" }),
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

Deno.test("writeActorsRegistry - typescript writes a string-keyed lookup map", async () => {
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
        "export const ACTOR_REGISTRY: Record<string, (input: unknown) => unknown> = {\n" +
        "  checkBureau,\n" +
        "  determineMiddleScore,\n" +
        "};\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsRegistry - python writes a string-keyed dict", async () => {
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
      "from .checkBureauPython.checkBureauPython import checkBureauPython\n" +
        "\n" +
        "ACTOR_REGISTRY = {\n" +
        '    "checkBureauPython": checkBureauPython,\n' +
        "}\n",
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
        "pub type ActorFn = fn(serde_json::Value) -> serde_json::Value;\n" +
        "\n" +
        "pub fn actor_registry(name: &str) -> Option<ActorFn> {\n" +
        "    match name {\n" +
        '        "checkBureau" => Some(actors::checkBureau),\n' +
        "        _ => None,\n" +
        "    }\n" +
        "}\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeActorsRegistry - writes nothing when there are no actors for that language", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const actors: WrittenActor[] = [
      toWrittenActor("python", { src: "checkBureauPython" }),
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
