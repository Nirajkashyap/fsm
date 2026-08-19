import { build, emptyDir } from "@deno/dnt";

await emptyDir("./dist");

await build({
  entryPoints: [
    "./src/index.ts",
    {
      kind: "bin",
      name: "async-operation-worker-gateway",
      path: "./src/cli/async-operation-worker-gateway.ts",
    },
    {
      kind: "bin",
      name: "async-operation-worker-gateway-ctl",
      path: "./src/cli/async-operation-worker-gateway-ctl.ts",
    },
  ],
  outDir: "./dist",
  shims: {
    deno: true,
  },
  package: {
    name: "@pgfsm/async-worker",
    version: Deno.args[0]?.replace(/^v/, "") ?? "0.0.0",
    description:
      "Activity Gateway (async-operation-worker-gateway/-ctl) for promise-type async FSM operations across polyglot actors",
    license: "Apache-2.0",
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
