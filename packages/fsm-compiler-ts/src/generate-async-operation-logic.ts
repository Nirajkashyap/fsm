import { getLogger } from "@logtape/logtape";
import { extractFsmPluginRefs, type WorkflowType } from "./util.ts";
import {
  actorFileBaseName,
  type ActorsBarrelLang,
  eachVersionedFsmFolder,
  isOperationLang,
  type RegisteredActor,
  resolvePluginRootAbsPath,
  toRegisteredActor,
  updateConsumerGoModActorRequires,
  writeActorFile,
  writeActorsBarrel,
  writeActorsManifest,
  writeActorsRegistry,
  writeAggregateActorsRegistry,
  writeAggregateGoRegistry,
} from "./operation-logic-scaffold.ts";

const logger = getLogger(["@pgfsm/compiler", "async-logic"]);

const BARREL_LANGS: ActorsBarrelLang[] = ["typescript", "python", "rust"];

/**
 * worker-sdk/go's own `go.mod`, relative to the app root (one level above
 * the plugin root, e.g. `apps/fsm-core-example`) — a hardcoded, known
 * consumer of the generated Go registry (see
 * {@linkcode updateConsumerGoModActorRequires}'s doc comment for why this
 * coupling exists at all: Go's `replace` directives aren't transitive, so
 * this file needs its own per-actor entries, not just the compiler's
 * generic, consumer-agnostic aggregate module).
 */
const WORKER_SDK_GO_GOMOD_RELATIVE_TO_APP_ROOT =
  "../../packages/fsm-core-async-op-worker/src/worker-sdk/go/go.mod";

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
 * Once, at the plugin root (one level above every FSM/version folder
 * processed in this run): a per-language **aggregate** registry
 * (`typescript-actors-registry.generated.ts`/
 * `python_actors_registry_generated.py`/`rust-actors-registry.generated.rs`)
 * combining every FSM-version's registry — what a worker SDK build imports,
 * since a single worker process serves its language's actors across every
 * FSM, not just one (see {@linkcode writeAggregateActorsRegistry}).
 */
export async function generateAsyncOperationLogicFromFolders(
  folderPath: string,
  _workflowType: WorkflowType,
  skipDirs: string[] = [],
): Promise<void> {
  logger.info("Scaffolding async operation logic from {path}", {
    path: folderPath,
  });

  const allRegisteredActors: RegisteredActor[] = [];

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
        const fsmType = actor.fsmType ?? "promise";
        if (fsmType !== "promise") {
          logger.info(
            "Skipping actor {src}: fsmType is {fsmType}, not promise",
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
    logger.info("Wrote go aggregate actors registry {file}", {
      file: goRegistryFile,
    });
  }

  const workerSdkGoModPath =
    `${appRootAbsPath}/${WORKER_SDK_GO_GOMOD_RELATIVE_TO_APP_ROOT}`;
  try {
    // 5 levels up from worker-sdk/go/ to the repo root, then back down into
    // <appRoot's parent dir name>/<appRoot name>/<pluginRootDirName> -- e.g.
    // apps/fsm-core-example/fsm -- derived from the real plugin-root path
    // rather than hardcoded, so a renamed app folder doesn't silently break.
    const pluginRootSuffix = pluginRootAbsPath.split("/").slice(-3).join("/");
    const relativePrefixToPluginRoot = `${"../".repeat(5)}${pluginRootSuffix}`;
    await updateConsumerGoModActorRequires(
      workerSdkGoModPath,
      allRegisteredActors,
      appRootAbsPath.split("/").at(-1)!,
      relativePrefixToPluginRoot,
    );
    logger.info("Updated go.mod generated actor requires in {path}", {
      path: workerSdkGoModPath,
    });
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      logger.info(
        "Skipping worker-sdk/go go.mod update: {path} not found",
        { path: workerSdkGoModPath },
      );
    } else {
      throw err;
    }
  }
}
