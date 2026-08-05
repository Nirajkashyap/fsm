import { getLogger } from "@logtape/logtape";
import {
  type ActorReference,
  isVersionFolderName,
  toGoExportedName,
} from "./util.ts";
import type { FsmMachineJson } from "./generated/fsm-machine-schema.types.ts";
import { deriveTemplateInput } from "./scaffold-templates/derive-template-input.ts";
import { getPreamble, getTemplate } from "./scaffold-templates/registry.ts";
import { render as renderTsActorsRegistry } from "./scaffold-templates/eta/typescript/actors-registry.generated.ts";
import { render as renderTsActorsRegistryAggregate } from "./scaffold-templates/eta/typescript/actors-registry-aggregate.generated.ts";
import { render as renderPyActorsRegistry } from "./scaffold-templates/eta/python/actors-registry.generated.ts";
import { render as renderPyActorsRegistryAggregate } from "./scaffold-templates/eta/python/actors-registry-aggregate.generated.ts";
import { render as renderRustActorsRegistry } from "./scaffold-templates/eta/rust/actors-registry.generated.ts";
import { render as renderRustActorsRegistryAggregate } from "./scaffold-templates/eta/rust/actors-registry-aggregate.generated.ts";
import { render as renderGoActorsRegistryAggregate } from "./scaffold-templates/eta/go/actors-registry-aggregate.generated.ts";
import { render as renderGoModActor } from "./scaffold-templates/eta/go/go-mod-actor.generated.ts";
import { render as renderGoModAggregate } from "./scaffold-templates/eta/go/go-mod-aggregate.generated.ts";
import { render as renderGoModConsumerSection } from "./scaffold-templates/eta/go/go-mod-consumer-section.generated.ts";

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
  const { fsmName, fsmVersion } = fsmIdentityFromVersionFolderPath(
    absFolderPath,
  );
  const appRoot = absFolderPath.split("/").at(-4)!; // .../<appRoot>/fsm/<fsmName>/<version>
  return `${appRoot}/${fsmName.toLowerCase()}/${fsmVersion}/go/actors/${actorDirName.toLowerCase()}`;
}

/**
 * Extracts `{ fsmName, fsmVersion }` from a version-folder absolute path
 * (e.g. `.../apps/fsm-core-example/fsm/creditCheck/v01` ->
 * `{ fsmName: "creditCheck", fsmVersion: "v01" }`), matching the
 * `<pluginRoot>/<fsmName>/<version>` convention {@linkcode eachVersionedFsmFolder}
 * walks.
 */
function fsmIdentityFromVersionFolderPath(
  absFolderPath: string,
): { fsmName: string; fsmVersion: string } {
  const parts = absFolderPath.split("/");
  return { fsmVersion: parts.at(-1)!, fsmName: parts.at(-2)! };
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
    renderGoModActor({ modulePath }),
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
 * A {@linkcode WrittenActor} plus the activity-registration identity a
 * worker SDK needs to register with the Activity Gateway (see
 * `actorKey()`/`RegisteredActor` in
 * `packages/fsm-core-async-op-worker/src/sidecar/protocol.ts`) — everything
 * {@linkcode writeActorsRegistry}/{@linkcode writeAggregateActorsRegistry}
 * need to emit a self-describing registration, not just a name -> callable
 * map. Matches the flattened identity model `fsm-compiler-ts`'s own
 * `validateAsyncOperationFromFolders` already used: `fsmName` is the actor's
 * own `src` (not a separate sub-FSM reference), `fsmVersion` is the parent
 * FSM's version, and `fsmType` is always `"promise"` (the only kind this
 * scaffolds).
 */
export type RegisteredActor = WrittenActor & {
  parentFsmName: string;
  parentFsmVersion: string;
  fsmType: "promise";
  fsmName: string;
  fsmVersion: string;
};

/**
 * Builds the {@linkcode RegisteredActor} record for the file a
 * {@linkcode writeActorFile} call for this actor produces, given the
 * version-folder path it was written under.
 */
export function toRegisteredActor(
  absFolderPath: string,
  lang: OperationLang,
  actor: ActorReference,
): RegisteredActor {
  const written = toWrittenActor(lang, actor);
  const { fsmName: parentFsmName, fsmVersion: parentFsmVersion } =
    fsmIdentityFromVersionFolderPath(absFolderPath);
  return {
    ...written,
    parentFsmName,
    parentFsmVersion,
    fsmType: "promise",
    fsmName: written.src,
    fsmVersion: parentFsmVersion,
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
 * Renders one FSM-version's registry file content via the language's Eta
 * template (`scaffold-templates/eta/<lang>/actors-registry.eta`): actors
 * here are always siblings of the file being written (same `<lang>/actors/`
 * directory), so imports/`#[path]`s never need to reach outside it. Used by
 * {@linkcode writeActorsRegistry} only — the aggregate
 * ({@linkcode writeAggregateActorsRegistry}) re-uses these per-version files
 * rather than re-deriving entries itself (see its own doc comment for why).
 */
function buildActorsRegistryContent(
  langActors: RegisteredActor[],
  lang: ActorsBarrelLang,
): string {
  switch (lang) {
    case "typescript":
      return renderTsActorsRegistry({ actors: langActors });
    case "python":
      return renderPyActorsRegistry({ actors: langActors });
    case "rust":
      return renderRustActorsRegistry({ actors: langActors });
  }
}

/**
 * Writes a registration registry re-exporting every actor for one language,
 * at `<absFolderPath>/<lang>/actors/<registry filename>`. Unlike
 * {@linkcode writeActorsBarrel} (named exports, for consumers who know the
 * actor name at compile time), this is for runtime dispatch — what a worker
 * SDK needs to register with the Activity Gateway and route an invocation to
 * the right function, without a folder scan or dynamic
 * `import()`/`importlib`. Returns `undefined` (writes nothing) when there are
 * no actors for that language.
 */
export async function writeActorsRegistry(
  absFolderPath: string,
  actors: RegisteredActor[],
  lang: ActorsBarrelLang,
): Promise<string | undefined> {
  const langActors = actors.filter((a) => a.fsmLanguage === lang);
  if (langActors.length === 0) return undefined;

  const dir = `${absFolderPath}/${lang}/actors`;
  await Deno.mkdir(dir, { recursive: true });
  const file = `${dir}/${ACTORS_REGISTRY_FILE_NAME[lang]}`;
  await Deno.writeTextFile(file, buildActorsRegistryContent(langActors, lang));
  if (lang === "rust") await formatRustFileBestEffort(file);
  return file;
}

/**
 * Runs `rustfmt` on a generated `.rs` file so it matches what `cargo fmt
 * --check` expects — needed once a generated registry is actually
 * `#[path]`-included into a real crate (e.g. worker-sdk/rust), since our own
 * codegen doesn't hand-replicate rustfmt's line-wrapping rules. Best-effort:
 * silently does nothing if `rustfmt` isn't on `PATH`, matching this file's
 * existing tolerance for missing toolchains elsewhere (see
 * `validate-async-operation-logic.ts`'s checker compilation).
 */
async function formatRustFileBestEffort(path: string): Promise<void> {
  try {
    await new Deno.Command("rustfmt", { args: [path], stderr: "null" })
      .output();
  } catch {
    // rustfmt not installed — leave the file as generated.
  }
}

const AGGREGATE_ACTORS_REGISTRY_FILE_NAME: Record<ActorsBarrelLang, string> = {
  typescript: "typescript-actors-registry.generated.ts",
  // Must be a valid Python module identifier (no dashes).
  python: "python_actors_registry_generated.py",
  rust: "rust-actors-registry.generated.rs",
};

/** Groups actors by their parent `<fsmName>/<fsmVersion>`, preserving first-seen order. */
function groupByParentFsm(
  actors: RegisteredActor[],
): Map<string, RegisteredActor[]> {
  const groups = new Map<string, RegisteredActor[]>();
  for (const a of actors) {
    const key = `${a.parentFsmName}/${a.parentFsmVersion}`;
    const group = groups.get(key);
    if (group) {
      group.push(a);
    } else {
      groups.set(key, [a]);
    }
  }
  return groups;
}

/** A `<fsmName>/<fsmVersion>` group key turned into a valid TS/Python/Rust identifier. */
function groupKeyToIdentifier(key: string): string {
  return key.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
}

/**
 * Renders the aggregate registry content for one language, combining every
 * FSM-version group's actors, via the language's Eta template
 * (`scaffold-templates/eta/<lang>/actors-registry-aggregate.eta`). TS/Python
 * re-import each FSM-version's already-generated
 * {@linkcode writeActorsRegistry} output and flatten it — simpler and avoids
 * re-deriving every entry, since both languages can statically import an
 * arbitrarily-nested sibling file. Rust can't do the equivalent (each
 * per-version `generated_registry.rs` defines its own nominally distinct
 * `ActorRegistration` type, so `Vec`s of them can't be concatenated) —
 * instead it `#[path]`-includes each FSM-version's actor barrel (`mod.rs`,
 * functions only, no competing type) under a unique per-group module alias,
 * and re-derives entries against one `ActorRegistration` type defined once
 * in the template.
 */
function buildAggregateRegistryContent(
  langActors: RegisteredActor[],
  lang: ActorsBarrelLang,
  pluginRootDirName: string,
): string {
  const groups = groupByParentFsm(langActors);
  const groupList = [...groups.keys()].map((key) => ({
    key,
    alias: groupKeyToIdentifier(key),
  }));

  switch (lang) {
    case "typescript":
      return renderTsActorsRegistryAggregate({
        groups: groupList,
        pluginRootDirName,
      });
    case "python":
      return renderPyActorsRegistryAggregate({
        groups: groupList,
        pluginRootDirName,
      });
    case "rust": {
      const actorsWithAlias = langActors.map((a) => ({
        ...a,
        alias: groupKeyToIdentifier(`${a.parentFsmName}/${a.parentFsmVersion}`),
      }));
      return renderRustActorsRegistryAggregate({
        groups: groupList,
        actors: actorsWithAlias,
        pluginRootDirName,
      });
    }
  }
}

/**
 * Writes ONE aggregate registration registry per language at
 * `<appRootAbsPath>/<aggregate filename>` — one level above the plugin root
 * (e.g. `apps/fsm-core-example/`, sibling to the `fsm/` folder
 * {@linkcode eachVersionedFsmFolder} walks) — combining actors across every
 * FSM/version processed in a single such run (see
 * `generateAsyncOperationLogicFromFolders`). This is the fixed, known file a
 * worker SDK build imports — a worker process serves every actor for its
 * language across the whole plugin root, so its build has exactly one thing
 * to import, not a per-FSM-version file it would have to discover. Returns
 * `undefined` (writes nothing) when there are no actors for that language
 * across the whole run.
 *
 * `pluginRootDirName` is the plugin root's own directory name (e.g. `"fsm"`)
 * — every generated import/`#[path]` re-descends into it by name, since the
 * aggregate lives one level above.
 */
export async function writeAggregateActorsRegistry(
  appRootAbsPath: string,
  pluginRootDirName: string,
  actors: RegisteredActor[],
  lang: ActorsBarrelLang,
): Promise<string | undefined> {
  const langActors = actors.filter((a) => a.fsmLanguage === lang);
  if (langActors.length === 0) return undefined;

  const file = `${appRootAbsPath}/${AGGREGATE_ACTORS_REGISTRY_FILE_NAME[lang]}`;
  await Deno.writeTextFile(
    file,
    buildAggregateRegistryContent(langActors, lang, pluginRootDirName),
  );
  if (lang === "rust") await formatRustFileBestEffort(file);
  return file;
}

/** Go module path for one actor, given the aggregate's app-root name (see {@linkcode goActorModulePath}, which this mirrors for a `RegisteredActor` rather than a version-folder path). */
function goActorModulePathFromRegisteredActor(
  appRoot: string,
  a: RegisteredActor,
): string {
  return `${appRoot}/${a.parentFsmName.toLowerCase()}/${a.parentFsmVersion}/go/actors/${a.fileBaseName.toLowerCase()}`;
}

/** A valid Go import alias derived from an actor's identity — unique per actor, since (unlike TS/Python/Rust barrels) each Go actor is its own separate module/import. */
function goImportAlias(a: RegisteredActor): string {
  return `${a.parentFsmName}_${a.parentFsmVersion}_${a.fileBaseName}`
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
}

const GO_AGGREGATE_DIR_NAME = "go-actors-registry-generated";

/** Runs `gofmt -w` on a generated `.go` file. Best-effort, mirrors {@linkcode formatRustFileBestEffort}. */
async function formatGoFileBestEffort(path: string): Promise<void> {
  try {
    await new Deno.Command("gofmt", { args: ["-w", path], stderr: "null" })
      .output();
  } catch {
    // gofmt not installed — leave the file as generated.
  }
}

/**
 * Writes a standalone Go module aggregating every Go actor across the whole
 * run into one `ActorRegistrations()` function, at
 * `<appRootAbsPath>/go-actors-registry-generated/` (`go.mod` + `registry.go`).
 * Returns `undefined` (writes nothing) when there are no Go actors.
 *
 * Go actors are each their own module (see {@linkcode writeGoActorModule}) —
 * pulling one into a consumer requires a `require`/`replace` directive per
 * actor, which can't live in a single flat file the way TS/Python/Rust's
 * aggregate does (they need no module-boundary bookkeeping). Generating that
 * wiring here means a *consumer's* `go.mod` (e.g. worker-sdk/go) only ever
 * needs ONE `require`/`replace`, pointing at this module, instead of being
 * hand-edited every time a Go actor is added or removed.
 */
export async function writeAggregateGoRegistry(
  appRootAbsPath: string,
  pluginRootDirName: string,
  actors: RegisteredActor[],
): Promise<string | undefined> {
  const goActors = actors.filter((a) => a.fsmLanguage === "go");
  if (goActors.length === 0) return undefined;

  const appRoot = appRootAbsPath.split("/").at(-1)!;
  const dir = `${appRootAbsPath}/${GO_AGGREGATE_DIR_NAME}`;
  await Deno.mkdir(dir, { recursive: true });

  const withMeta = goActors.map((a) => ({
    ...a,
    modulePath: goActorModulePathFromRegisteredActor(appRoot, a),
    alias: goImportAlias(a),
  }));

  const goModContent = renderGoModAggregate({
    moduleName: `${appRoot}/${GO_AGGREGATE_DIR_NAME}`,
    requires: withMeta.map((a) => ({ modulePath: a.modulePath })),
    replaces: withMeta.map((a) => ({
      modulePath: a.modulePath,
      target:
        `../${pluginRootDirName}/${a.parentFsmName}/${a.parentFsmVersion}/go/actors/${a.fileBaseName}`,
    })),
  });
  await Deno.writeTextFile(`${dir}/go.mod`, goModContent);

  const registryContent = renderGoActorsRegistryAggregate({
    imports: withMeta.map((a) => ({
      alias: a.alias,
      modulePath: a.modulePath,
    })),
    actors: withMeta,
  });
  const registryFile = `${dir}/registry.go`;
  await Deno.writeTextFile(registryFile, registryContent);
  await formatGoFileBestEffort(registryFile);
  return registryFile;
}

const GO_MOD_GENERATED_SECTION_BEGIN =
  "// --- BEGIN fsm-compiler-ts generated actor requires ---";
const GO_MOD_GENERATED_SECTION_END =
  "// --- END fsm-compiler-ts generated actor requires ---";

/**
 * Rewrites the fsm-compiler-ts-managed section of a Go consumer's own
 * `go.mod` (e.g. worker-sdk/go) with one `require`+`replace` per Go actor
 * across the whole run.
 *
 * Go's `replace` directives are only honored in the module actually being
 * built, not in a dependency's own `go.mod` — they don't propagate
 * transitively. So even though {@linkcode writeAggregateGoRegistry}'s
 * generated module is what logically imports each actor module, a *consumer*
 * of that aggregate (e.g. worker-sdk/go, which imports the aggregate) still
 * needs its own `require`+`replace` for every individual actor module the
 * aggregate pulls in, or its build can't resolve them.
 *
 * The section markers must already exist in `goModAbsPath` — bootstrap them
 * once by hand (alongside the consumer's own stable `require`+`replace` for
 * the aggregate module itself, which this never touches). This only rewrites
 * what's between the markers.
 */
export async function updateConsumerGoModActorRequires(
  goModAbsPath: string,
  actors: RegisteredActor[],
  appRoot: string,
  relativePrefixToPluginRoot: string,
): Promise<void> {
  const goActors = actors.filter((a) => a.fsmLanguage === "go");
  const existing = await Deno.readTextFile(goModAbsPath);
  const beginIdx = existing.indexOf(GO_MOD_GENERATED_SECTION_BEGIN);
  const endIdx = existing.indexOf(GO_MOD_GENERATED_SECTION_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `${goModAbsPath} is missing the generated-actor-requires markers (${GO_MOD_GENERATED_SECTION_BEGIN} / ${GO_MOD_GENERATED_SECTION_END}) — bootstrap them once by hand before running this.`,
    );
  }

  const requires = goActors.map((a) => ({
    modulePath: goActorModulePathFromRegisteredActor(appRoot, a),
    target:
      `${relativePrefixToPluginRoot}/${a.parentFsmName}/${a.parentFsmVersion}/go/actors/${a.fileBaseName}`,
  }));

  const before = existing.slice(
    0,
    beginIdx + GO_MOD_GENERATED_SECTION_BEGIN.length,
  );
  const after = existing.slice(endIdx);
  const middle = `\n${renderGoModConsumerSection({ requires })}`;
  await Deno.writeTextFile(goModAbsPath, `${before}${middle}${after}`);
}

/**
 * Resolves a plugin-root folder path (relative to `Deno.cwd()`, or already
 * absolute) to an absolute path, and validates it's neither dot-relative nor
 * trailing-slashed. Shared by {@linkcode eachVersionedFsmFolder} and callers
 * that need the plugin root itself (e.g. `generateAsyncOperationLogicFromFolders`'s
 * aggregate registry, written one level above every FSM/version it processes).
 */
export function resolvePluginRootAbsPath(folderPath: string): string {
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
  return folderPath.startsWith("/")
    ? folderPath
    : `${Deno.cwd()}/${folderPath}`;
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
  const absFolderPath = resolvePluginRootAbsPath(folderPath);

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
