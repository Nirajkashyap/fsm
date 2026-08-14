import { getLogger } from "@logtape/logtape";
import { isVersionFolderName } from "./util.ts";
import type { ActorReference } from "./util.ts";
import {
  type OperationLang,
  resolvePluginRootAbsPath,
  writeActorFile,
} from "./operation-logic-scaffold.ts";

const logger = getLogger(["@pgfsm/compiler", "create-async-logic"]);

/**
 * Directory name (relative to the app root) holding actors that aren't
 * scoped to any one FSM's `invoke` list — hand-created via this command
 * rather than scaffolded in bulk from `fsm.json` by
 * {@linkcode generateAsyncOperationLogicFromFolders}.
 */
const SHARED_ASYNC_OP_DIR_NAME = "shared-async-op";

/**
 * Scaffolds a single new actor stub in the shared, non-FSM-scoped async
 * operation pool at `<appRootFolder>/shared-async-op/<version>/<lang>/actors/<name>/<name>.<ext>`,
 * via the same {@linkcode writeActorFile} helper
 * `generateAsyncOperationLogicFromFolders` uses per invoke object — so stub
 * content/formatting matches the rest of the actor-scaffolding pipeline.
 * Returns the absolute path written.
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
  // version folder (unlike fsm/sharedFSM), so writeActorFile's default
  // path-offset appRoot derivation for Go's go.mod would resolve one level
  // too shallow — pass the app root's own directory name explicitly.
  const appRootDirName = absAppRootPath.split("/").at(-1)!;
  const file = await writeActorFile(
    absFolderPath,
    lang,
    actor,
    appRootDirName,
  );
  logger.info("Wrote actor file {file}", { file });
  return file;
}
