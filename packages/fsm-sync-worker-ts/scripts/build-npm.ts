import { build, emptyDir } from "@deno/dnt";

await emptyDir("./dist");

await build({
  entryPoints: [
    "./src/index.ts",
    { kind: "bin", name: "fsmlet", path: "./src/cli/fsmlet.ts" },
    { kind: "bin", name: "fsmscheduler", path: "./src/cli/fsmscheduler.ts" },
    { kind: "bin", name: "fsmctl", path: "./src/cli/fsmctl.ts" },
    { kind: "bin", name: "pgcron", path: "./src/cli/pgcron.ts" },
  ],
  outDir: "./dist",
  shims: {
    deno: true,
  },
  package: {
    name: "@pgfsm/sync-worker",
    version: Deno.args[0]?.replace(/^v/, "") ?? "0.0.0",
    description:
      "Out-of-band worker fleet (fsmlet/fsmscheduler/fsmctl/pgcron) driving FSM instances for PostgreSQL-backed state machines",
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
