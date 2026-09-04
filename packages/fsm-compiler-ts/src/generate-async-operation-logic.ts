import { getLogger } from "@logtape/logtape";
import { extractFsmPluginRefs } from "./util.ts";
import {
  actorFileBaseName,
  eachVersionedFsmFolder,
  formatGoFilesBestEffort,
  formatRustFilesBestEffort,
  formatTsFilesBestEffort,
  goModTidyManyBestEffort,
  isOperationLang,
  resolvePluginRootAbsPath,
  toRegisteredActor,
  writeActorFile,
  writeActorsBarrel,
  writeActorsManifest,
  writeActorsRegistry,
  writeAggregateActorsRegistry,
  writeAggregateGoRegistry,
  writeWorkerSdk,
} from "./operation-logic-scaffold.ts";
import type {
  ActorsBarrelLang,
  FsmMachineJson,
  RegisteredActor,
  WorkerSdkProtocol,
  WorkflowType,
} from "./types/index.ts";

const logger = getLogger(["@pgfsm/compiler", "async-logic"]);

const BARREL_LANGS: ActorsBarrelLang[] = ["typescript", "python", "rust"];

/**
 * Writes actor files, the per-version `actors-manifest.json`, and each
 * language's per-version barrel/registry for one already-parsed fsm.json,
 * into `absVersionFolderPath`. Shared by
 * {@linkcode generateAsyncOperationLogicFromFolders} (one call per versioned
 * FSM folder it walks) and {@linkcode generateAsyncOperationLogicFromFsmJson}
 * (a single call for one fsm.json). Mutates `tsFiles`/`rustFiles` in place so
 * callers can batch-format everything written across a whole run.
 */
async function scaffoldAsyncLogicForVersion(
  absVersionFolderPath: string,
  fsmData: FsmMachineJson,
  tsFiles: string[],
  rustFiles: string[],
): Promise<RegisteredActor[]> {
  const { actors } = extractFsmPluginRefs(fsmData);

  // Dedupe by language + `<asyncOperationType>_<asyncOperationVersion>_<src>`
  // so identical invokes are written once, while actors that differ in
  // type/version/src get their own files.
  const seen = new Set<string>();
  const writtenActors: RegisteredActor[] = [];
  for (const actor of actors) {
    const asyncOperationType = actor.asyncOperationType ??
      "internalAsyncOperation";
    if (asyncOperationType !== "internalAsyncOperation") {
      logger.info(
        "Skipping actor {src}: asyncOperationType is {asyncOperationType}, not internalAsyncOperation",
        { src: actor.src, asyncOperationType },
      );
      continue;
    }
    const lang = actor.asyncOperationLanguage ?? "typescript";
    if (!isOperationLang(lang)) {
      logger.warning(
        "Skipping actor {src}: unsupported asyncOperationLanguage {lang}",
        {
          src: actor.src,
          lang,
        },
      );
      continue;
    }
    const key = `${lang}/${actorFileBaseName(actor)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const file = await writeActorFile(absVersionFolderPath, lang, actor);
    if (lang === "typescript") tsFiles.push(file);
    writtenActors.push(toRegisteredActor(absVersionFolderPath, lang, actor));
    logger.info("Wrote actor file {file}", { file });
  }

  logger.info("Wrote {count} actor file(s) in {path}", {
    count: writtenActors.length,
    path: absVersionFolderPath,
  });

  const manifestFile = await writeActorsManifest(
    absVersionFolderPath,
    writtenActors,
  );
  logger.info("Wrote actors manifest {file}", { file: manifestFile });

  for (const lang of BARREL_LANGS) {
    const barrelFile = await writeActorsBarrel(
      absVersionFolderPath,
      writtenActors,
      lang,
    );
    if (barrelFile) {
      if (lang === "typescript") tsFiles.push(barrelFile);
      logger.info("Wrote {lang} actors barrel {file}", {
        lang,
        file: barrelFile,
      });
    }

    const registryFile = await writeActorsRegistry(
      absVersionFolderPath,
      writtenActors,
      lang,
    );
    if (registryFile) {
      if (lang === "typescript") tsFiles.push(registryFile);
      if (lang === "rust") rustFiles.push(registryFile);
      logger.info("Wrote {lang} actors registry {file}", {
        lang,
        file: registryFile,
      });
    }
  }

  return writtenActors;
}

/**
 * Scaffolds async operation logic (actors / invoke objects) for every versioned
 * FSM under `folderPath`.
 *
 * Each invoke object gets its **own file** at
 * `<lang>/actors/<asyncOperationType>_<asyncOperationVersion>_<src>.<ext>`,
 * where `<lang>` is the actor's `asyncOperationLanguage` (defaulting to
 * typescript). The file exports one function named after the actor `src`
 * (Go: exported/capitalized, plus its own `go.mod` — see
 * {@linkcode writeActorFile}). Invokes that resolve to the same
 * `<asyncOperationType>_<asyncOperationVersion>_<src>` within a language are
 * written once.
 *
 * Per version folder: `actors-manifest.json` (every actor across all
 * languages — `{ src, asyncOperationLanguage, filePath, exportedName }`), a per-language
 * barrel (`typescript/actors/index.ts`, `python/actors/__init__.py`,
 * `rust/actors/mod.rs`) re-exporting each actor by name, and a per-language
 * generated registry (`generated-registry.ts`/`generated_registry.py`/
 * `generated_registry.rs`) carrying each actor's full activity-registration
 * identity + handler — written only when at least one actor exists for that
 * language. Go has neither — see {@linkcode ActorsBarrelLang}'s doc comment.
 *
 * Once, at `<appRoot>/worker-sdk-generated/<lang>/` (alongside that
 * language's compiler-generated worker SDK — see {@linkcode writeWorkerSdk}):
 * a per-language **aggregate** registry
 * (`typescript-actors-registry.generated.ts`/
 * `python_actors_registry_generated.py`/`rust-actors-registry.generated.rs`/
 * `go-actors-registry-generated/`) combining every FSM-version's registry —
 * what a worker SDK build imports, since a single worker process serves its
 * language's actors across every FSM, not just one (see
 * {@linkcode writeAggregateActorsRegistry}, {@linkcode writeAggregateGoRegistry}).
 *
 * `workerSdkProtocol` selects which sidecar wire protocol the generated
 * worker SDKs speak — see {@linkcode WorkerSdkProtocol}. Defaults to
 * `"grpc"`.
 *
 * Every `write*` call below only writes — nothing is formatted/tidied
 * per-file as it's written. Instead, every `.ts`/`.rs`/`.go` path and Go
 * module directory produced across the *whole* run is collected and
 * formatted once at the very end (one `deno fmt`, one `rustfmt`, one
 * `gofmt`, one `go mod tidy` per Go module) — see
 * {@linkcode formatTsFilesBestEffort} and friends.
 */
export async function generateAsyncOperationLogicFromFolders(
  folderPath: string,
  skipDirs: string[] = [],
  workerSdkProtocol: WorkerSdkProtocol = "grpc",
): Promise<void> {
  logger.info("Scaffolding async operation logic from {path}", {
    path: folderPath,
  });

  const allRegisteredActors: RegisteredActor[] = [];
  const tsFiles: string[] = [];
  const rustFiles: string[] = [];
  const goFiles: string[] = [];
  const goModDirs: string[] = [];

  await eachVersionedFsmFolder(
    folderPath,
    skipDirs,
    async (absFolderPath, fsmData) => {
      const writtenActors = await scaffoldAsyncLogicForVersion(
        absFolderPath,
        fsmData,
        tsFiles,
        rustFiles,
      );
      allRegisteredActors.push(...writtenActors);
    },
  );

  // One level above the plugin root (e.g. apps/fsm-core-example/fsm ->
  // apps/fsm-core-example) -- a sibling of every FSM name folder this run
  // processed, not nested inside any one of them.
  const pluginRootAbsPath = resolvePluginRootAbsPath(folderPath);
  const pluginRootDirName = pluginRootAbsPath.split("/").at(-1)!;
  const appRootAbsPath = pluginRootAbsPath.split("/").slice(0, -1).join("/");

  for (const lang of BARREL_LANGS) {
    const aggregateFile = await writeAggregateActorsRegistry(
      appRootAbsPath,
      pluginRootDirName,
      allRegisteredActors,
      lang,
    );
    if (aggregateFile) {
      if (lang === "typescript") tsFiles.push(aggregateFile);
      if (lang === "rust") rustFiles.push(aggregateFile);
      logger.info("Wrote {lang} aggregate actors registry {file}", {
        lang,
        file: aggregateFile,
      });
    }
  }

  const goRegistryFile = await writeAggregateGoRegistry(
    appRootAbsPath,
    pluginRootDirName,
    allRegisteredActors,
  );
  if (goRegistryFile) {
    goFiles.push(goRegistryFile);
    goModDirs.push(goRegistryFile.slice(0, goRegistryFile.lastIndexOf("/")));
    logger.info("Wrote go aggregate actors registry {file}", {
      file: goRegistryFile,
    });
  }

  const wrote = await writeWorkerSdk(
    appRootAbsPath,
    pluginRootDirName,
    allRegisteredActors,
    { protocol: workerSdkProtocol },
  );
  tsFiles.push(...wrote.tsFiles);
  rustFiles.push(...wrote.rustFiles);
  goFiles.push(...wrote.goFiles);
  if (wrote.goModDir) goModDirs.push(wrote.goModDir);
  logger.info(
    "Wrote worker-sdk-generated/ (typescript={ts}, python={py}, rust={rust}, go={go})",
    { ts: wrote.typescript, py: wrote.python, rust: wrote.rust, go: wrote.go },
  );

  await formatTsFilesBestEffort(tsFiles);
  await formatRustFilesBestEffort(rustFiles);
  await formatGoFilesBestEffort(goFiles);
  await goModTidyManyBestEffort(goModDirs);
}

/**
 * Scaffolds async operation logic for a single fsm.json file, for the CLI's
 * single-file `--folder` mode — used when the caller wants to target one
 * fsm.json directly instead of walking a plugin-root folder for every
 * versioned FSM under it. Writes actor files, the per-version
 * `actors-manifest.json`, and each language's per-version barrel/registry
 * into `absVersionFolderPath` (the CLI resolves it from `--output`,
 * independently of `fsmJsonPath`'s own location; it does not have to be
 * `fsmJsonPath`'s own containing directory).
 *
 * Unlike {@linkcode generateAsyncOperationLogicFromFolders}, this does
 * **not** write the once-per-app-root aggregate registry or worker SDK (see
 * {@linkcode writeAggregateActorsRegistry}, {@linkcode writeAggregateGoRegistry},
 * {@linkcode writeWorkerSdk}): those combine every FSM version's actors for a
 * language into one file, which isn't well-defined for a single arbitrary
 * fsm.json — running it here would silently overwrite that aggregate with
 * only this one file's actors, discarding every other FSM's entries. Run
 * `generate-async-logic` in folder mode over the whole plugin-root afterward
 * to refresh the aggregate registry / worker SDK.
 */
export async function generateAsyncOperationLogicFromFsmJson(
  fsmJsonPath: string,
  absVersionFolderPath: string,
): Promise<void> {
  logger.info(
    "Scaffolding async operation logic from {path} into {versionFolder}",
    { path: fsmJsonPath, versionFolder: absVersionFolderPath },
  );

  const fsmData: FsmMachineJson = JSON.parse(
    await Deno.readTextFile(fsmJsonPath),
  );
  const tsFiles: string[] = [];
  const rustFiles: string[] = [];
  await scaffoldAsyncLogicForVersion(
    absVersionFolderPath,
    fsmData,
    tsFiles,
    rustFiles,
  );

  await formatTsFilesBestEffort(tsFiles);
  await formatRustFilesBestEffort(rustFiles);
}
