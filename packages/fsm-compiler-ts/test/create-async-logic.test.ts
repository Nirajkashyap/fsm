import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createAsyncOperationLogic } from "../src/create-async-logic.ts";

Deno.test("createAsyncOperationLogic - writes a single actor under <appRoot>/shared-async-op/<version>/<lang>/actors/<name>/<name>.<ext>", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = await createAsyncOperationLogic(
      dir,
      "typescript",
      "v01",
      "checkCreditScore",
    );
    assertEquals(
      file,
      `${dir}/shared-async-op/v01/typescript/actors/checkCreditScore/checkCreditScore.ts`,
    );
    const content = await Deno.readTextFile(file);
    assertEquals(
      content,
      '// Actor: checkCreditScore\nexport function checkCreditScore(input: unknown): unknown {\n  // TODO: implement actor logic\n  return { input, msg: "checkCreditScore actor invoked by typescript" };\n}\n',
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("createAsyncOperationLogic - writes a generated-registry.ts entry with the fixed standaloneAsyncOp identity", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createAsyncOperationLogic(
      dir,
      "typescript",
      "v01",
      "checkCreditScore",
    );
    const registryContent = await Deno.readTextFile(
      `${dir}/shared-async-op/v01/typescript/actors/generated-registry.ts`,
    );
    assertStringIncludes(
      registryContent,
      'import { checkCreditScore } from "./checkCreditScore/checkCreditScore.ts";',
    );
    assertStringIncludes(
      registryContent,
      'parentFsmName: "standaloneAsyncOp",',
    );
    assertStringIncludes(registryContent, 'parentFsmVersion: "v01",');
    assertStringIncludes(registryContent, 'fsmType: "standaloneAsyncOp",');
    assertStringIncludes(registryContent, 'fsmName: "checkCreditScore",');
    assertStringIncludes(registryContent, 'fsmVersion: "v01",');
    assertStringIncludes(registryContent, 'fsmLanguage: "typescript",');
    assertStringIncludes(registryContent, "handler: checkCreditScore,");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("createAsyncOperationLogic - a second call accumulates in the registry instead of clobbering the first", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createAsyncOperationLogic(
      dir,
      "typescript",
      "v01",
      "checkCreditScore",
    );
    await createAsyncOperationLogic(dir, "typescript", "v01", "verifyIdentity");
    const registryContent = await Deno.readTextFile(
      `${dir}/shared-async-op/v01/typescript/actors/generated-registry.ts`,
    );
    assertStringIncludes(registryContent, "handler: checkCreditScore,");
    assertStringIncludes(registryContent, "handler: verifyIdentity,");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("createAsyncOperationLogic - go writes no registry file (no per-version registry for go)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createAsyncOperationLogic(dir, "go", "v01", "checkCreditScore");
    const registryDirExists = await Deno.stat(
      `${dir}/shared-async-op/v01/go/actors/generated-registry.go`,
    ).then(() => true).catch(() => false);
    assertEquals(registryDirExists, false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("createAsyncOperationLogic - go actor gets a go.mod rooted at the app root (not one level shallow)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const absAppRoot = `${dir}/fsm-core-example`;
    await Deno.mkdir(absAppRoot, { recursive: true });
    await createAsyncOperationLogic(
      absAppRoot,
      "go",
      "v01",
      "checkCreditScore",
    );
    const goModContent = await Deno.readTextFile(
      `${absAppRoot}/shared-async-op/v01/go/actors/checkCreditScore/go.mod`,
    );
    assertEquals(
      goModContent,
      "module fsm-core-example/shared-async-op/v01/go/actors/checkcreditscore\n\ngo 1.19\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("createAsyncOperationLogic - rejects a version that doesn't match the vNN convention", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await assertRejects(
      () =>
        createAsyncOperationLogic(dir, "typescript", "1", "checkCreditScore"),
      Error,
      "Invalid version",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
