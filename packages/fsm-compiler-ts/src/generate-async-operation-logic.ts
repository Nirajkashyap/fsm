import { getLogger } from "@logtape/logtape";
import { extractFsmPluginRefs, type WorkflowType } from "./util.ts";
import {
  actorFileBaseName,
  type ActorsBarrelLang,
  eachVersionedFsmFolder,
  formatGoFilesBestEffort,
  formatRustFilesBestEffort,
  formatTsFilesBestEffort,
  goModTidyManyBestEffort,
  isOperationLang,
  type RegisteredActor,
  resolvePluginRootAbsPath,
  toRegisteredActor,
  type WorkerSdkProtocol,
  writeActorFile,
  writeActorsBarrel,
  writeActorsManifest,
  writeActorsRegistry,
  writeAggregateActorsRegistry,
  writeAggregateGoRegistry,
  writeWorkerSdk,
} from "./operation-logic-scaffold.ts";

const logger = getLogger(["@pgfsm/compiler", "async-logic"]);

const BARREL_LANGS: ActorsBarrelLang[] = ["typescript", "python", "rust"];

/**
 * Scaffolds async operation logic (actors / invoke objects) for every versioned
 * FSM under `folderPath`.
 *
 * Each invoke object gets its **own file** at
 * `<lang>/actors/<fsmType>_<fsmVersion>_<src>.<ext>`, where `<lang>` is the
 * actor's `fsmLanguage` (defaulting to typescript). The file exports one
 * function named after the actor `src` (Go: exported/capitalized, plus its
 * own `go.mod` — see {@linkcode writeActorFile}). Invokes that resolve to the
 * same `<fsmType>_<fsmVersion>_<src>` within a language are written once.
 *
 * Per version folder: `actors-manifest.json` (every actor across all
 * languages — `{ src, fsmLanguage, filePath, exportedName }`), a per-language
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
  _workflowType: WorkflowType,
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
      const { actors } = extractFsmPluginRefs(fsmData);

      // Dedupe by language + `<fsmType>_<fsmVersion>_<src>` so identical invokes
      // are written once, while actors that differ in type/version/src get
      // their own files.
      const seen = new Set<string>();
      const writtenActors: RegisteredActor[] = [];
      for (const actor of actors) {
        const fsmType = actor.fsmType ?? "internalAsyncOperation";
        if (fsmType !== "internalAsyncOperation") {
          logger.info(
            "Skipping actor {src}: fsmType is {fsmType}, not internalAsyncOperation",
            { src: actor.src, fsmType },
          );
          continue;
        }
        const lang = actor.fsmLanguage ?? "typescript";
        if (!isOperationLang(lang)) {
          logger.warning(
            "Skipping actor {src}: unsupported fsmLanguage {lang}",
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

        const file = await writeActorFile(absFolderPath, lang, actor);
        if (lang === "typescript") tsFiles.push(file);
        writtenActors.push(toRegisteredActor(absFolderPath, lang, actor));
        logger.info("Wrote actor file {file}", { file });
      }

      logger.info("Wrote {count} actor file(s) in {path}", {
        count: writtenActors.length,
        path: absFolderPath,
      });

      const manifestFile = await writeActorsManifest(
        absFolderPath,
        writtenActors,
      );
      logger.info("Wrote actors manifest {file}", { file: manifestFile });

      for (const lang of BARREL_LANGS) {
        const barrelFile = await writeActorsBarrel(
          absFolderPath,
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
          absFolderPath,
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
