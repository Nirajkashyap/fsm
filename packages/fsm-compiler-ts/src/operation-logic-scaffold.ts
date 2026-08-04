import { getLogger } from "@logtape/logtape";
import {
  type ActorReference,
  isVersionFolderName,
  toGoExportedName,
} from "./util.ts";
import type { FsmMachineJson } from "./generated/fsm-machine-schema.types.ts";
import { deriveTemplateInput } from "./scaffold-templates/derive-template-input.ts";
import { getPreamble, getTemplate } from "./scaffold-templates/registry.ts";

const logger = getLogger(["@pgfsm/compiler", "scaffold"]);

/**
 * Languages an operation-logic module can be scaffolded in.
 * Aligns with the `fsmLanguage` enum on invoke objects and the actor folder
 * convention (`typescript/`, `python/`, `rust/`, `go/`).
 */
export type OperationLang = "typescript" | "python" | "rust" | "go";

export const SUPPORTED_OPERATION_LANGS: OperationLang[] = [
  "typescript",
  "python",
  "rust",
  "go",
];

export function isOperationLang(value: string): value is OperationLang {
  return (SUPPORTED_OPERATION_LANGS as string[]).includes(value);
}

/** The kind of operation logic being scaffolded. */
export type OperationKind = "actions" | "guards" | "delays" | "actors";

/** The index-module filename written for a given language. */
export function operationModuleFileName(lang: OperationLang): string {
  switch (lang) {
    case "typescript":
      return "index.ts";
    case "python":
      return "index.py";
    case "rust":
      return "mod.rs";
    case "go":
      return "index.go";
  }
}

/** The source-file extension for a given language. */
export function operationFileExtension(lang: OperationLang): string {
  switch (lang) {
    case "typescript":
      return "ts";
    case "python":
      return "py";
    case "rust":
      return "rs";
    case "go":
      return "go";
  }
}

/** Sanitizes a value for use as a filename component (keeps identifier chars). */
function sanitizeFileComponent(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function renderStub(
  lang: OperationLang,
  kind: OperationKind,
  name: string,
): string {
  return getTemplate(lang, kind)(deriveTemplateInput(kind, name, lang));
}

/**
 * Each stub template ends in a blank line so consecutive stubs concatenated
 * into one module read with a separator between them — but that leaves a
 * stray trailing blank line at the true end of the file, which `deno fmt`
 * doesn't consider canonical (and silently strips on format-on-save/commit).
 * Collapses that down to a single trailing newline.
 */
function withSingleTrailingNewline(content: string): string {
  return content.replace(/\n+$/, "\n");
}

/**
 * Renders the full index-module content for a set of operation-logic names in a
 * given language. Names are deduplicated. Go modules get a package header named
 * after the kind.
 */
export function renderOperationModule(
  lang: OperationLang,
  kind: OperationKind,
  names: string[],
): string {
  const unique = [...new Set(names)];
  let out = getPreamble(lang, kind);
  for (const name of unique) {
    out += renderStub(lang, kind, name);
  }
  return withSingleTrailingNewline(out);
}

/**
 * Writes one operation-logic index module to `<absFolderPath>/<lang>/<kind>/`.
 */
export async function writeOperationModule(
  absFolderPath: string,
  lang: OperationLang,
  kind: OperationKind,
  names: string[],
): Promise<void> {
  const dir = `${absFolderPath}/${lang}/${kind}`;
  await Deno.mkdir(dir, { recursive: true });
  const file = `${dir}/${operationModuleFileName(lang)}`;
  await Deno.writeTextFile(file, renderOperationModule(lang, kind, names));
}

/**
 * Base filename (without extension) for a per-actor file: the sanitized `src`.
 */
export function actorFileBaseName(actor: ActorReference): string {
  return sanitizeFileComponent(actor.src);
}

/**
 * Derives the Go module path for a single actor's own `go.mod`, matching the
 * convention already established by hand for `apps/fsm-core-example`'s Go
 * actors (see `CheckReportsTable/go.mod`):
 * `<appRoot>/<fsmName>/<version>/go/actors/<actorDir>`, lowercased.
 * `<appRoot>` is the directory name two levels above the FSM's plugin root
 * (e.g. `apps/fsm-core-example/fsm/creditCheck/v01` -> appRoot
 * `fsm-core-example`). Each Go actor is its own Go module so a consumer in a
 * different module (e.g. a worker-sdk/go build) can pull it in via a
 * `require`/`replace` directive — Go has no dynamic-loading equivalent to
 * TS/Python's `import()`/`importlib`.
 */
function goActorModulePath(
  absFolderPath: string,
  actorDirName: string,
): string {
  const parts = absFolderPath.split("/");
  const version = parts.at(-1)!;
  const fsmName = parts.at(-2)!;
  const appRoot = parts.at(-4)!; // .../<appRoot>/fsm/<fsmName>/<version>
  return `${appRoot}/${fsmName.toLowerCase()}/${version}/go/actors/${actorDirName.toLowerCase()}`;
}

/** Writes the `go.mod` for a single Go actor's own module (see {@linkcode goActorModulePath}). */
async function writeGoActorModule(
  absFolderPath: string,
  actorDirName: string,
): Promise<void> {
  const modulePath = goActorModulePath(absFolderPath, actorDirName);
  const dir = `${absFolderPath}/go/actors/${actorDirName}`;
  await Deno.writeTextFile(
    `${dir}/go.mod`,
    `module ${modulePath}\n\ngo 1.19\n`,
  );
}

/**
 * Writes a single actor to its own file at
 * `<absFolderPath>/<lang>/actors/<src>/<src>.<ext>`.
 * The file exports one function named after the actor `src` — except Go,
 * whose function is exported (capitalized) instead, and which also gets its
 * own `go.mod` (see {@linkcode writeGoActorModule}), since Go enforces
 * exports and module boundaries at compile time.
 * Returns the absolute path written.
 */
export async function writeActorFile(
  absFolderPath: string,
  lang: OperationLang,
  actor: ActorReference,
): Promise<string> {
  const name = actorFileBaseName(actor);
  const dir = `${absFolderPath}/${lang}/actors/${name}`;
  await Deno.mkdir(dir, { recursive: true });
  const file = `${dir}/${name}.${operationFileExtension(lang)}`;
  const header = getPreamble(lang, "actors");
  await Deno.writeTextFile(
    file,
    withSingleTrailingNewline(header + renderStub(lang, "actors", actor.src)),
  );
  if (lang === "go") {
    await writeGoActorModule(absFolderPath, name);
  }
  return file;
}

/** One actor file written by {@linkcode writeActorFile}, recorded for the manifest/barrel. */
export type WrittenActor = {
  /** The actor's original `src` — its identity (invoke id), independent of language. */
  src: string;
  /** Sanitized filename component (see {@linkcode actorFileBaseName}) — the folder/file name on disk. */
  fileBaseName: string;
  fsmLanguage: OperationLang;
  /** Path relative to the version-folder root, e.g. `typescript/actors/checkBureau/checkBureau.ts`. */
  filePath: string;
  /** The callable/importable symbol name in `fsmLanguage` — equals `src` except for Go (see {@linkcode toGoExportedName}). */
  exportedName: string;
};

/** Builds the {@linkcode WrittenActor} record for the file a {@linkcode writeActorFile} call for this actor produces. */
export function toWrittenActor(
  lang: OperationLang,
  actor: ActorReference,
): WrittenActor {
  const fileBaseName = actorFileBaseName(actor);
  return {
    src: actor.src,
    fileBaseName,
    fsmLanguage: lang,
    filePath: `${lang}/actors/${fileBaseName}/${fileBaseName}.${
      operationFileExtension(lang)
    }`,
    exportedName: lang === "go" ? toGoExportedName(actor.src) : actor.src,
  };
}

/**
 * Writes a single JSON manifest listing every actor written across all
 * languages, at `<absFolderPath>/actors-manifest.json`. Always written, even
 * when `actors` is empty, so a consumer always knows where to look.
 */
export async function writeActorsManifest(
  absFolderPath: string,
  actors: WrittenActor[],
): Promise<string> {
  const file = `${absFolderPath}/actors-manifest.json`;
  const manifest = {
    actors: actors.map(({ src, fsmLanguage, filePath, exportedName }) => ({
      src,
      fsmLanguage,
      filePath,
      exportedName,
    })),
  };
  await Deno.writeTextFile(file, JSON.stringify(manifest, null, 2) + "\n");
  return file;
}

/**
 * Languages with a natural single-file "re-export everything" idiom. Go is
 * deliberately excluded: each actor already lives in its own subdirectory,
 * which in Go makes it a separate package — there's no re-export syntax, and
 * a working registry file would need every actor function to be exported
 * (capitalized; not yet true, see #78) plus the consuming project's Go module
 * import path (which this compiler has no way to know).
 */
export type ActorsBarrelLang = "typescript" | "python" | "rust";

const ACTORS_BARREL_FILE_NAME: Record<ActorsBarrelLang, string> = {
  typescript: "index.ts",
  python: "__init__.py",
  rust: "mod.rs",
};

/** Renders the barrel entry for one actor. Rust needs `#[path]` since the actor file isn't at Rust's default module location. */
function actorsBarrelEntry(
  lang: ActorsBarrelLang,
  actor: WrittenActor,
): string {
  const { src, fileBaseName } = actor;
  switch (lang) {
    case "typescript":
      return `export { ${src} } from "./${fileBaseName}/${fileBaseName}.ts";`;
    case "python":
      return `from .${fileBaseName}.${fileBaseName} import ${src}`;
    case "rust":
      return `#[path = "${fileBaseName}/${fileBaseName}.rs"]\n#[allow(non_snake_case)]\nmod ${fileBaseName};\npub use ${fileBaseName}::${src};`;
  }
}

/**
 * Writes a barrel module re-exporting every actor for one language, at
 * `<absFolderPath>/<lang>/actors/<barrel filename>` (`index.ts`/`__init__.py`/
 * `mod.rs`). Returns `undefined` (writes nothing) when there are no actors
 * for that language.
 */
export async function writeActorsBarrel(
  absFolderPath: string,
  actors: WrittenActor[],
  lang: ActorsBarrelLang,
): Promise<string | undefined> {
  const langActors = actors.filter((a) => a.fsmLanguage === lang);
  if (langActors.length === 0) return undefined;

  const dir = `${absFolderPath}/${lang}/actors`;
  await Deno.mkdir(dir, { recursive: true });
  const file = `${dir}/${ACTORS_BARREL_FILE_NAME[lang]}`;
  // Rust entries are 3 lines each — a blank line between actors keeps it readable.
  const separator = lang === "rust" ? "\n\n" : "\n";
  const content = langActors.map((a) => actorsBarrelEntry(lang, a)).join(
    separator,
  ) + "\n";
  await Deno.writeTextFile(file, content);
  return file;
}

const ACTORS_REGISTRY_FILE_NAME: Record<ActorsBarrelLang, string> = {
  typescript: "generated-registry.ts",
  python: "generated_registry.py",
  rust: "generated_registry.rs",
};

/**
 * Writes a key -> callable lookup registry re-exporting every actor for one
 * language, at `<absFolderPath>/<lang>/actors/<registry filename>`. Unlike
 * {@linkcode writeActorsBarrel} (named exports, for consumers who know the
 * actor name at compile time), this is for runtime dispatch by string key —
 * what a worker SDK needs to route an invocation to the right function
 * without a folder scan or dynamic `import()`/`importlib`. Returns
 * `undefined` (writes nothing) when there are no actors for that language.
 *
 * Rust's registry reuses the barrel's `#[path]` module declarations
 * (`#[path = "mod.rs"] mod actors;`) instead of redeclaring them, since Rust
 * treats a duplicate `#[path]`/`mod` pair for the same file as a compile
 * error if both the barrel and the registry declared it independently.
 */
export async function writeActorsRegistry(
  absFolderPath: string,
  actors: WrittenActor[],
  lang: ActorsBarrelLang,
): Promise<string | undefined> {
  const langActors = actors.filter((a) => a.fsmLanguage === lang);
  if (langActors.length === 0) return undefined;

  const dir = `${absFolderPath}/${lang}/actors`;
  await Deno.mkdir(dir, { recursive: true });
  const file = `${dir}/${ACTORS_REGISTRY_FILE_NAME[lang]}`;

  let content: string;
  switch (lang) {
    case "typescript": {
      const imports = langActors.map((a) =>
        `import { ${a.src} } from "./${a.fileBaseName}/${a.fileBaseName}.ts";`
      ).join("\n");
      const entries = langActors.map((a) => `  ${a.src},`).join("\n");
      content =
        `${imports}\n\nexport const ACTOR_REGISTRY: Record<string, (input: unknown) => unknown> = {\n${entries}\n};\n`;
      break;
    }
    case "python": {
      const imports = langActors.map((a) =>
        `from .${a.fileBaseName}.${a.fileBaseName} import ${a.src}`
      ).join("\n");
      const entries = langActors.map((a) => `    "${a.src}": ${a.src},`)
        .join("\n");
      content = `${imports}\n\nACTOR_REGISTRY = {\n${entries}\n}\n`;
      break;
    }
    case "rust": {
      const entries = langActors.map((a) =>
        `        "${a.src}" => Some(actors::${a.src}),`
      ).join("\n");
      content =
        `#[path = "mod.rs"]\nmod actors;\n\npub type ActorFn = fn(serde_json::Value) -> serde_json::Value;\n\npub fn actor_registry(name: &str) -> Option<ActorFn> {\n    match name {\n${entries}\n        _ => None,\n    }\n}\n`;
      break;
    }
  }

  await Deno.writeTextFile(file, content);
  return file;
}

/**
 * Walks a plugin-root folder, finds every versioned FSM subdirectory (e.g.
 * `creditCheck/v01/`) that contains an `fsm.json`, and invokes `handler` with
 * the absolute version-folder path and the parsed fsm.json.
 */
export async function eachVersionedFsmFolder(
  folderPath: string,
  skipDirs: string[],
  handler: (absFolderPath: string, fsmData: FsmMachineJson) => Promise<void>,
): Promise<void> {
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

  const absFolderPath = folderPath.startsWith("/")
    ? folderPath
    : `${Deno.cwd()}/${folderPath}`;

  for await (const dirEntry of Deno.readDir(absFolderPath)) {
    if (!dirEntry.isDirectory || skipDirs.includes(dirEntry.name)) continue;

    const fsmDirPath = `${absFolderPath}/${dirEntry.name}`;
    for await (const subEntry of Deno.readDir(fsmDirPath)) {
      if (!subEntry.isDirectory) continue;
      if (!isVersionFolderName(subEntry.name)) {
        logger.info("Skipping non-versioned folder: {name} in {dir}", {
          name: subEntry.name,
          dir: fsmDirPath,
        });
        continue;
      }

      const versionFolderPath = `${fsmDirPath}/${subEntry.name}`;
      const fsmJsonPath = `${versionFolderPath}/fsm.json`;
      try {
        const fsmData: FsmMachineJson = JSON.parse(
          await Deno.readTextFile(fsmJsonPath),
        );
        await handler(versionFolderPath, fsmData);
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          logger.info("fsm.json is missing in {path}", {
            path: versionFolderPath,
          });
        } else {
          logger.error("Failed to process {path}: {error}", {
            path: fsmJsonPath,
            error: err,
          });
        }
      }
    }
  }
}
