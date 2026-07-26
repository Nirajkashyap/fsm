// Discovers and verifies typescript promise-actor folders, mirroring
// packages/fsm-compiler-ts/src/validate-async-operation-logic.ts's
// validateAsyncOperationFromFolders — trimmed to typescript only: no
// `runtimeLanguages` argument, `lang` fixed to "typescript" instead of
// looped over, and no python/go/rust branches (the per-language `if`
// dropped along with them, since there's only one language left to check).
//
// The typescript check also skips the subprocess hop: the real compiler's
// validator shells out to `check_fn.ts` via `Deno.Command` because it must
// support checkers that aren't Deno/TS (python3, a compiled go/rust binary).
// This file only ever checks typescript, in a process that's already Deno —
// so it inlines check_fn.ts's own check (dynamic `import()` + `typeof
// mod[fnName] === "function"`) directly, in-process.

import { getLogger } from "@logtape/logtape";
import {
  type ActorPluginValidationResult,
  type ActorReference,
  isVersionFolderName,
  type OperationLang,
  type WorkflowType,
} from "@pgfsm/compiler";

const logger = getLogger([
  "@pgfsm/worker",
  "async-op-worker-gateway",
  "worker-sdk-ts",
  "validate",
]);

const lang: OperationLang = "typescript";

export async function validateAsyncOperationFromFoldersTypescript(
  folderPath: string,
  _workflowType: WorkflowType,
  skipDirs: string[] = [],
  _availableActors: ActorReference[] = [],
): Promise<ActorPluginValidationResult[]> {
  if (folderPath.startsWith(".")) {
    throw new Error(
      `Invalid folder path: ${folderPath}. Folder paths cannot start with '.'`,
    );
  }
  if (folderPath.endsWith("/")) {
    throw new Error(
      `Invalid folder path: ${folderPath}. Folder paths cannot end with '/'`,
    );
  }
  if (folderPath.startsWith("/")) {
    logger.info("Importing workflows from absolute path: {path}", {
      path: folderPath,
    });
  } else {
    logger.info("Importing workflows from relative path: {path} to {cwd}", {
      path: folderPath,
      cwd: Deno.cwd(),
    });
  }
  const absFolderPath = folderPath.startsWith("/")
    ? folderPath
    : `${Deno.cwd()}/${folderPath}`;

  const allFolderResults: ActorPluginValidationResult[] = [];
  try {
    const stat = await Deno.stat(absFolderPath);
    if (!stat.isDirectory) {
      logger.error("Provided path is not a directory: {path}", {
        path: absFolderPath,
      });
      throw new Error(`Provided path '${absFolderPath}' is not a directory.`);
    }
    for await (const dirEntry of Deno.readDir(absFolderPath)) {
      if (dirEntry.isDirectory) {
        if (skipDirs.includes(dirEntry.name)) continue;

        const fsmDirPath = `${absFolderPath}/${dirEntry.name}`;

        for await (const subEntry of Deno.readDir(fsmDirPath)) {
          if (subEntry.isDirectory) {
            if (isVersionFolderName(subEntry.name)) {
              const absVersionPath = `${fsmDirPath}/${subEntry.name}`;
              try {
                const langPath = `${absVersionPath}/${lang}`;
                try {
                  await Deno.stat(langPath);
                } catch {
                  logger.info(
                    "Lang folder {lang} not found in {path}, skipping",
                    { lang, path: absVersionPath },
                  );
                  continue;
                }

                const actorsPath = `${langPath}/actors`;
                try {
                  await Deno.stat(actorsPath);
                } catch {
                  logger.info(
                    "Actors folder not found for {lang} in {path}, skipping",
                    { lang, path: langPath },
                  );
                  continue;
                }

                for await (const actorDir of Deno.readDir(actorsPath)) {
                  if (!actorDir.isDirectory) continue;

                  const fnName = actorDir.name;
                  const modulePath = `${actorsPath}/${fnName}/${fnName}.ts`;

                  try {
                    await Deno.stat(modulePath);
                  } catch {
                    logger.warn(
                      "actors: expected file not found for actor {actor} in {path}, skipping",
                      { actor: fnName, path: modulePath },
                    );
                    continue;
                  }

                  let isVerified = false;
                  let errorMessage: string | null = null;

                  try {
                    const mod = await import(`file://${modulePath}`);
                    if (typeof mod[fnName] === "function") {
                      isVerified = true;
                      logger.info(
                        "actors/typescript: function {src} found in {path}",
                        { src: fnName, path: modulePath },
                      );
                    } else {
                      errorMessage =
                        `'${fnName}' is not exported as a function from ${modulePath}`;
                      logger.error(
                        "actors/typescript: function {src} not found in {path}: {err}",
                        { src: fnName, path: modulePath, err: errorMessage },
                      );
                    }
                  } catch (err) {
                    errorMessage = `Failed to import ${modulePath}: ${err}`;
                    logger.error(
                      "actors/typescript: function {src} not found in {path}: {err}",
                      { src: fnName, path: modulePath, err: errorMessage },
                    );
                  }

                  allFolderResults.push({
                    src: fnName,
                    method: fnName,
                    fsmName: fnName,
                    fsmType: "promise",
                    fsmVersion: subEntry.name,
                    fsmLanguage: lang,
                    isVerified,
                    fsmModulePath: modulePath,
                    parentFsmName: dirEntry.name,
                    parentFsmVersion: subEntry.name,
                    comment:
                      "for fsmType promise fsmVersion will be its parentFsmVersion value",
                    parentFsmPath: fsmDirPath,
                    errorMessage,
                  });
                }
              } catch (err) {
                logger.error("Failed to validate {path}: {error}", {
                  path: absVersionPath,
                  error: err,
                });
              }
            } else {
              logger.info(
                "Skipping non-versioned folder: {name} in {dir}",
                { name: subEntry.name, dir: fsmDirPath },
              );
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error(
      "Error occurred while reading directory {path}: {error}",
      { path: absFolderPath, error: err },
    );
  }

  return allFolderResults;
}
