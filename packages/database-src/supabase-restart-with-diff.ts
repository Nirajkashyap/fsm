#!/usr/bin/env -S deno run --allow-all
import { config as loadDotenv } from "dotenv";
import { join } from "node:path";
import type { ReleaseType } from "semver";
import { getNextPkgVersionFilename } from "./get-next-pkg-version-util.ts";

// Deno equivalent of the npm script chain:
//   supabase:restart:with:diff:withUpgradeScript:<patch|minor|major>
// Each function below mirrors one npm script in package.json; running this
// file directly performs the full chain for a given incrementType, same as
// `npm run supabase:restart:with:diff:withUpgradeScript:patch` (or :minor/:major).
//
// Invoke directly from a terminal, from any cwd:
//   ./supabase-restart-with-diff.ts [incrementType] [target]
// or:
//   deno run --allow-all supabase-restart-with-diff.ts [incrementType] [target]
// or:
//   deno task restart-with-diff-temp -- [incrementType] [target]
//
// incrementType is a semver release type (patch|minor|major|...), same as
// `get-next-pkg-version.ts`'s CLI arg — defaults to "patch" if omitted.
//
// target selects which Supabase project config the CLI operates against —
// "main" (default, packages/database-src/supabase/config.toml) or "full-ext"
// (packages/database-src/full-ext/supabase/config.toml, the pgrx extension's
// project). The Supabase CLI only ever reads `<workdir>/supabase/config.toml`
// (the subfolder must be literally named "supabase"), so switching targets
// means passing a different --workdir, not a different config file path.
// Both configs share the same project_id/ports on purpose — they're
// mutually exclusive alternates of the same local stack, not a pair meant to
// run concurrently. `stop` one before `start`ing the other.

const SCRIPT_DIR = import.meta.dirname!;
// `npm run` prepends node_modules/.bin to PATH, so a bare `supabase` in an
// npm script resolves to the project-pinned CLI version. Deno.Command has no
// such PATH mangling, so a bare "supabase" here would instead pick up
// whatever's on the user's global PATH — silently running a different,
// possibly incompatible CLI version. Resolve the pinned binary explicitly.
// const SUPABASE_BIN = join(SCRIPT_DIR, "node_modules/.bin/supabase");
const SUPABASE_BIN = "supabase";

type Target = "main" | "full-ext";

const DOCKER_VOLUME_LABEL = "label=com.supabase.cli.project=database-src";
const TYPES_OUTPUT = "database.types.ts";

const WORKDIRS: Record<Target, string> = {
  "main": SCRIPT_DIR,
  "full-ext": join(SCRIPT_DIR, "full-ext"),
};

function resolveTarget(value: string | undefined): Target {
  if (value === undefined || value === "main") return "main";
  if (value === "full-ext") return "full-ext";
  throw new Error(`Unknown target "${value}" — expected "main" or "full-ext"`);
}

// Loaded up front (not just before `supabase start`) — every supabase CLI
// subcommand parses config.toml, which interpolates env(...) references
// (e.g. auth.external.google.client_id), so `supabase stop` and `supabase db
// diff` need these vars available just as much as `supabase start` does.
loadDotenv({ path: join(SCRIPT_DIR, "../../.env") });

async function run(
  cmd: string,
  args: string[],
  opts: Deno.CommandOptions = {},
): Promise<void> {
  const command = new Deno.Command(cmd, {
    args,
    cwd: SCRIPT_DIR,
    stdout: "inherit",
    stderr: "inherit",
    ...opts,
  });
  const { code } = await command.output();
  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with code ${code}`);
  }
}

async function runCapture(cmd: string, args: string[]): Promise<string> {
  const command = new Deno.Command(cmd, {
    args,
    cwd: SCRIPT_DIR,
    stdout: "piped",
    stderr: "inherit",
  });
  const { code, stdout } = await command.output();
  const output = new TextDecoder().decode(stdout).trim();
  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with code ${code}`);
  }
  return output;
}

// npm run supabase:stop
async function stopSupabase(workdir: string): Promise<void> {
  await run(SUPABASE_BIN, ["stop", "--workdir", workdir]);
}

// npm run supabase:docker:volume:clean
async function cleanDockerVolume(): Promise<void> {
  const volumes = await runCapture("docker", [
    "volume",
    "ls",
    "-q",
    "--filter",
    DOCKER_VOLUME_LABEL,
  ]);
  if (volumes) {
    await run("docker", ["volume", "rm", ...volumes.split("\n")]);
  } else {
    console.log("No matching docker volume to remove.");
  }
}

// npm run supabase:db:diff:schemafolder:sql:withUpgradeScript:<patch|minor|major>
async function diffSchemaWithUpgradeScript(
  incrementType: ReleaseType,
  workdir: string,
  target: Target,
): Promise<void> {
  const pkg = JSON.parse(
    await Deno.readTextFile(join(SCRIPT_DIR, "package.json")),
  );

  // Alternative: read `name` from deno.json instead of package.json, via a
  // native JSON module import (statically resolved relative to this file, no
  // readTextFile/JSON.parse needed) rather than the SCRIPT_DIR-joined
  // readTextFile approach above. deno.json currently has no "name" field —
  // it's a bare imports/tasks config — so this would require adding one back
  // before switching to it. Note the import itself would need to move to the
  // top of the file (static imports can't live inside a function).
  // import denoConfig from "./deno.json" with { type: "json" };
  // const nextVersion = getNextPkgVersionFilename(
  //   denoConfig.name,
  //   incrementType,
  //   join(workdir, "supabase/migrations"),
  // );

  // full-ext holds one authoritative SQL file per version (no upgrade-diff
  // chain — see pgxn-build-and-publish.ts's full-ext override), so its
  // filenames are always `{pkgName}--{version}.sql`, never
  // `{pkgName}--{old}--{new}.sql`.
  const nextVersion = getNextPkgVersionFilename(
    pkg.name,
    incrementType,
    join(workdir, "supabase/migrations"),
    target === "full-ext" ? "single" : "upgrade",
  );
  await run(SUPABASE_BIN, [
    "db",
    "diff",
    "-f",
    nextVersion,
    "--workdir",
    workdir,
    "--debug",
  ]);
}

// npm run supabase:start:env
async function startSupabaseWithEnv(workdir: string): Promise<void> {
  await run(SUPABASE_BIN, ["start", "--workdir", workdir, "--debug"]);
}

// npm run supabase:gen:types
async function genTypes(workdir: string): Promise<void> {
  const types = await runCapture(SUPABASE_BIN, [
    "gen",
    "types",
    "typescript",
    "--local",
    "--workdir",
    workdir,
    "--schema",
    "public,fsm_core,pgmq",
  ]);
  await Deno.mkdir(join(SCRIPT_DIR, "generated"), { recursive: true });
  await Deno.writeTextFile(
    join(SCRIPT_DIR, "generated", TYPES_OUTPUT),
    types + "\n",
  );
}

// npm run supabase:restart:with:diff:withUpgradeScript:<patch|minor|major>
async function restartWithDiffWithUpgradeScript(
  incrementType: ReleaseType,
  target: Target,
): Promise<void> {
  const workdir = WORKDIRS[target];
  await stopSupabase(workdir);
  await cleanDockerVolume();
  await diffSchemaWithUpgradeScript(incrementType, workdir, target);
  await startSupabaseWithEnv(workdir);
  await genTypes(workdir);
}

if (import.meta.main) {
  const incrementType = (Deno.args[0] ?? "patch") as ReleaseType;
  const target = resolveTarget(Deno.args[1]);
  await restartWithDiffWithUpgradeScript(incrementType, target);
}
