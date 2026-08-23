import { getLogger } from "@logtape/logtape";
import { isVersionFolderName } from "./util.ts";
import {
  formatRustFilesBestEffort,
  formatTsFilesBestEffort,
  resolvePluginRootAbsPath,
  toWrittenActor,
  writeActorFile,
  writeActorsRegistry,
} from "./operation-logic-scaffold.ts";
import type {
  ActorReference,
  ActorsBarrelLang,
  OperationLang,
  RegisteredActor,
} from "./types/index.ts";

const logger = getLogger(["@pgfsm/compiler", "create-async-logic"]);

/**
 * Directory name (relative to the app root) holding actors that aren't
 * scoped to any one FSM's `invoke` list — hand-created via this command
 * rather than scaffolded in bulk from `fsm.json` by
 * {@linkcode generateAsyncOperationLogicFromFolders}.
 */
const SHARED_ASYNC_OP_DIR_NAME = "shared-async-op";

/**
 * Fixed `parentFsmName`/`fsmType` identity every shared-async-op actor
 * registers under — unlike FSM-scoped actors (whose `parentFsmName` is the
 * owning FSM and `fsmType` is `"internalAsyncOperation"`, derived from an
 * invoke object), shared-async-op actors have no owning FSM, so both are
 * constants.
 */
const SHARED_ASYNC_OP_FSM_TYPE = "standaloneAsyncOp" as const;
const SHARED_ASYNC_OP_PARENT_FSM_NAME = "standaloneAsyncOp";

/** Languages `create-async-logic` can also emit a `generated-registry.*` for — Go has no per-version registry (see {@linkcode ActorsBarrelLang}'s doc comment). */
const REGISTRY_LANGS: ActorsBarrelLang[] = ["typescript", "python", "rust"];

function isRegistryLang(lang: OperationLang): lang is ActorsBarrelLang {
  return (REGISTRY_LANGS as OperationLang[]).includes(lang);
}

/** Builds the {@linkcode RegisteredActor} identity for one shared-async-op actor. */
function toSharedAsyncOpRegisteredActor(
  lang: ActorsBarrelLang,
  version: string,
  src: string,
): RegisteredActor {
  return {
    ...toWrittenActor(lang, { src }),
    parentFsmName: SHARED_ASYNC_OP_PARENT_FSM_NAME,
    parentFsmVersion: version,
    fsmType: SHARED_ASYNC_OP_FSM_TYPE,
    fsmName: src,
    fsmVersion: version,
  };
}

/**
 * Lists every actor already scaffolded under `<absFolderPath>/<lang>/actors/`
 * (one subdirectory per actor — see {@linkcode writeActorFile}), by reading
 * the directory rather than a manifest, so the registry it feeds always
 * matches what's actually on disk even if a file was hand-removed. Excludes
 * the registry file itself (a sibling file, not a directory).
 */
async function listExistingActorSrcNames(
  absFolderPath: string,
  lang: OperationLang,
): Promise<string[]> {
  const actorsDir = `${absFolderPath}/${lang}/actors`;
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(actorsDir)) {
      if (entry.isDirectory) names.push(entry.name);
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  return names.sort();
}

/**
 * Rewrites `<absFolderPath>/<lang>/actors/<registry filename>` from every
 * actor currently on disk for `lang` (the one just written by
 * {@linkcode createAsyncOperationLogic} included) — so repeated
 * `create-async-logic` calls accumulate registry entries instead of each one
 * clobbering the last.
 */
async function rewriteSharedAsyncOpRegistry(
  absFolderPath: string,
  lang: OperationLang,
  version: string,
): Promise<string | undefined> {
  if (!isRegistryLang(lang)) return undefined;
  const srcNames = await listExistingActorSrcNames(absFolderPath, lang);
  const actors = srcNames.map((src) =>
    toSharedAsyncOpRegisteredActor(lang, version, src)
  );
  return await writeActorsRegistry(absFolderPath, actors, lang);
}

/**
 * Scaffolds a single new actor stub in the shared, non-FSM-scoped async
 * operation pool at `<appRootFolder>/shared-async-op/<version>/<lang>/actors/<name>/<name>.<ext>`,
 * via the same {@linkcode writeActorFile} helper
 * `generateAsyncOperationLogicFromFolders` uses per invoke object — so stub
 * content/formatting matches the rest of the actor-scaffolding pipeline. For
 * `typescript`/`python`/`rust` (see {@linkcode ActorsBarrelLang}), also
 * rewrites that language's `generated-registry.*` from every actor currently
 * on disk (see {@linkcode rewriteSharedAsyncOpRegistry}), each entry's
 * identity fixed to `parentFsmName`/`fsmType` `"standaloneAsyncOp"` since
 * these actors have no owning FSM. Returns the actor file's absolute path.
 */
export async function createAsyncOperationLogic(
  appRootFolder: string,
  lang: OperationLang,
  version: string,
  name: string,
): Promise<string> {
  if (!isVersionFolderName(version)) {
    throw new Error(
      `Invalid version: ${version}. Must match the "v\\d{2}" folder-name convention (e.g. "v01").`,
    );
  }

  const absAppRootPath = resolvePluginRootAbsPath(appRootFolder);
  const absFolderPath =
    `${absAppRootPath}/${SHARED_ASYNC_OP_DIR_NAME}/${version}`;
  const actor: ActorReference = { src: name, fsmLanguage: lang };

  // shared-async-op has no plugin-root layer between the app root and the
  // version folder (unlike fsm/), so writeActorFile's default path-offset
  // appRoot derivation for Go's go.mod would resolve one level too shallow —
  // pass the app root's own directory name explicitly.
  const appRootDirName = absAppRootPath.split("/").at(-1)!;
  const file = await writeActorFile(
    absFolderPath,
    lang,
    actor,
    appRootDirName,
  );
  logger.info("Wrote actor file {file}", { file });

  const registryFile = await rewriteSharedAsyncOpRegistry(
    absFolderPath,
    lang,
    version,
  );
  if (registryFile) {
    logger.info("Wrote actors registry {file}", { file: registryFile });
  }

  // One batched format call instead of per-file — see
  // generate-async-operation-logic.ts's doc comment for the same rationale
  // (only ever 1-2 files here, but keeps both scaffolding paths consistent).
  const tsFiles = [file, registryFile].filter(
    (f): f is string => f !== undefined && lang === "typescript",
  );
  const rustFiles = [registryFile].filter(
    (f): f is string => f !== undefined && lang === "rust",
  );
  await formatTsFilesBestEffort(tsFiles);
  await formatRustFilesBestEffort(rustFiles);

  return file;
}
