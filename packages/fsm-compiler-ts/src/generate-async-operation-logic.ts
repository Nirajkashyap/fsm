import { getLogger } from "@logtape/logtape";
import { extractFsmPluginRefs, type WorkflowType } from "./util.ts";
import {
  actorFileBaseName,
  type ActorsBarrelLang,
  eachVersionedFsmFolder,
  isOperationLang,
  toWrittenActor,
  writeActorFile,
  writeActorsBarrel,
  writeActorsManifest,
  type WrittenActor,
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
 * function named after the actor `src`. Invokes that resolve to the same
 * `<fsmType>_<fsmVersion>_<src>` within a language are written once.
 *
 * Two kinds of additional files are written per version folder:
 * `actors-manifest.json` (every actor across all languages — `{ src,
 * fsmLanguage, filePath }`), and a per-language barrel
 * (`typescript/actors/index.ts`, `python/actors/__init__.py`,
 * `rust/actors/mod.rs`) re-exporting each actor for that language, written
 * only when at least one actor exists in it. Go has no barrel — see
 * {@linkcode ActorsBarrelLang}'s doc comment.
 */
export async function generateAsyncOperationLogicFromFolders(
  folderPath: string,
  _workflowType: WorkflowType,
  skipDirs: string[] = [],
): Promise<void> {
  logger.info("Scaffolding async operation logic from {path}", {
    path: folderPath,
  });

  await eachVersionedFsmFolder(
    folderPath,
    skipDirs,
    async (absFolderPath, fsmData) => {
      const { actors } = extractFsmPluginRefs(fsmData);

      // Dedupe by language + `<fsmType>_<fsmVersion>_<src>` so identical invokes
      // are written once, while actors that differ in type/version/src get
      // their own files.
      const seen = new Set<string>();
      const writtenActors: WrittenActor[] = [];
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
        writtenActors.push(toWrittenActor(lang, actor));
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
      }
    },
  );
}
