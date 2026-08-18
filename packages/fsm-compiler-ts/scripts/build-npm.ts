import { build, emptyDir } from "@deno/dnt";

await emptyDir("./dist");

await build({
  entryPoints: [
    "./src/index.ts",
    { kind: "bin", name: "fsm-compiler", path: "./src/cli/index.ts" },
  ],
  outDir: "./dist",
  shims: {
    deno: true,
  },
  // Publishing doesn't need test/*.test.ts bundled into dist — and dnt tries
  // to build them for the CJS target too, which fails on the top-level
  // await in test/cli.test.ts (CJS/UMD can't support it).
  test: false,
  package: {
    name: "@pgfsm/compiler",
    version: Deno.args[0]?.replace(/^v/, "") ?? "0.0.0",
    description: "FSM JSON compiler for PostgreSQL-backed state machines",
    license: "MIT",
    // pg ships no types of its own; dnt only auto-installs packages that
    // are themselves import specifiers, so without this the type-check
    // pass can't resolve `import ... from "pg"` (deno.json's own
    // "@types/pg" import mapping isn't picked up the same way here).
    devDependencies: {
      "@types/pg": "^8.18.0",
    },
  },
  compilerOptions: {
    lib: ["ES2022", "DOM"],
    target: "ES2022",
  },
  postBuild() {
    if (Deno.args.includes("--copy-readme")) {
      Deno.copyFileSync("README.md", "dist/README.md");
    }
  },
});
