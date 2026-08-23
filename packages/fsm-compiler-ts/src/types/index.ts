import type { Json } from "@pgfsm/db/database.types";
import type {
  ActionObject,
  FsmMachineJson,
  InvokeObject,
} from "../../../database-src/generated/fsm-machine-schema.types.ts";

/**
 * Re-exports only the schema-derived types this package actually imports
 * elsewhere (generated from `packages/database-src/fsm.machine.schema.v3.json`
 * — see `packages/database-src/CLAUDE.md`'s `generate:fsm-types`), so every
 * other file can pull them from `./types/index.ts` alongside this package's
 * own hand-written types, instead of reaching across the package boundary
 * into `../../database-src/generated/` itself. Deliberately not a blanket
 * `export type *` — add a type here only once something in this package
 * actually needs it (`InvokeObject` isn't re-exported for that reason: it's
 * only used internally above, for `FsmDraftInvoke`).
 */
export type {
  ActionObject,
  AtomicStateNode,
  CompoundStateNode,
  FinalStateNode,
  FsmMachineJson,
  HistoryStateNode,
  ParallelStateNode,
} from "../../../database-src/generated/fsm-machine-schema.types.ts";

export type WorkflowType =
  | "fsm"
  | "sharedAsyncOperation"
  | "internalAsyncOperation";

export type ActorReference = {
  src: string;
  fsmType?: string;
  fsmVersion?: string;
  fsmLanguage?: string;
};

export type FailedMethod = {
  method: string;
  moduleType: string;
  modulePath: string;
};

export type FsmPluginValidationResult = {
  src: string;
  fsmName: string;
  fsmVersion: string;
  fsmType: WorkflowType;
  fsmAbsFolderPath: string;
  fsmRelativeFolderPath: string;
  fsmParentDirName: string;
  fsmParentAbsFolderPath: string;
  fsmParentRelativeFolderPath: string;
  fsmJsonConfigData: FsmMachineJson | undefined;
  fsmJsonPresent: boolean;
  fsmJsonFollowSchema: boolean;
  isFsmModuleVerified: boolean;
  fsmModuleDefinition: Json;
  failedMethods: FailedMethod[];
  asyncOperationActors: ActorReference[];
  isAsyncOperationActorsVerified?: boolean;
};

export type ActorPluginValidationResult = {
  src: string;
  method: string;
  fsmName: string;
  fsmType: "internalAsyncOperation";
  fsmVersion: string;
  fsmLanguage: string;
  isVerified: boolean;
  fsmModulePath: string;
  parentFsmName: string;
  parentFsmVersion: string;
  comment: string;
  parentFsmPath: string;
  errorMessage: string | null;
};

/**
 * Languages an operation-logic module can be scaffolded in.
 * Aligns with the `fsmLanguage` enum on invoke objects and the actor folder
 * convention (`typescript/`, `python/`, `rust/`, `go/`).
 */
export type OperationLang = "typescript" | "python" | "rust" | "go";

/** The kind of operation logic being scaffolded. */
export type OperationKind = "actions" | "guards" | "delays" | "actors";

/** One actor file written by `writeActorFile` (`operation-logic-scaffold.ts`), recorded for the manifest/barrel. */
export type WrittenActor = {
  /** The actor's original `src` — its identity (invoke id), independent of language. */
  src: string;
  /** Sanitized filename component — the folder/file name on disk. */
  fileBaseName: string;
  fsmLanguage: OperationLang;
  /** Path relative to the version-folder root, e.g. `typescript/actors/checkBureau/checkBureau.ts`. */
  filePath: string;
  /** The callable/importable symbol name in `fsmLanguage` — equals `src` except for Go, which capitalizes it for cross-package export. */
  exportedName: string;
};

/**
 * A {@linkcode WrittenActor} plus the activity-registration identity a
 * worker SDK needs to register with the Activity Gateway (see
 * `actorKey()`/`RegisteredActor` in
 * `packages/fsm-core-async-op-worker/src/sidecar/protocol.ts`) — everything
 * `writeActorsRegistry`/`writeAggregateActorsRegistry`
 * (`operation-logic-scaffold.ts`) need to emit a self-describing
 * registration, not just a name -> callable map. Matches the flattened
 * identity model `fsm-compiler-ts`'s own `validateAsyncOperationFromFolders`
 * already used: `fsmName` is the actor's own `src` (not a separate sub-FSM
 * reference), `fsmVersion` is the parent FSM's version. `fsmType` is
 * `"internalAsyncOperation"` for actors scaffolded from an invoke object (the
 * only kind `toRegisteredActor` builds) or `"standaloneAsyncOp"` for the
 * standalone, non-FSM-scoped pool `create-async-logic.ts` writes into —
 * downstream, `fsmType` is an opaque string (used only inside `actorKey()`'s
 * composite key), so this is safe to extend.
 */
export type RegisteredActor = WrittenActor & {
  parentFsmName: string;
  parentFsmVersion: string;
  fsmType: "internalAsyncOperation" | "standaloneAsyncOp";
  fsmName: string;
  fsmVersion: string;
};

/**
 * Languages with a natural single-file "re-export everything" idiom directly
 * inside a version folder (`<lang>/actors/<barrel/registry filename>`). Go is
 * deliberately excluded here: each actor already lives in its own
 * subdirectory, which in Go makes it a separate package *and* its own Go
 * module (see `writeGoActorModule`) — there's no re-export syntax across
 * module boundaries, only `require`/`replace`. A per-version Go registry
 * would need its own `go.mod` requiring/replacing every sibling actor module
 * individually; `writeAggregateGoRegistry` already does exactly that, just
 * scoped to the whole app run rather than one version folder at a time — so
 * Go's generated registry lives there instead of here, not because it's
 * missing. (The two blockers an earlier version of this comment cited —
 * unexported Go stub names, and not knowing each actor's own Go module
 * import path — were resolved by #83/#84: see `toGoExportedName` and
 * `goActorModulePath`.)
 */
export type ActorsBarrelLang = "typescript" | "python" | "rust";

/**
 * Which sidecar wire protocol the generated worker SDKs speak. `"grpc"`
 * (default) is the proto-defined `SidecarGatewayService` from #100.
 * `"legacy"` restores the pre-#100 hand-rolled length-prefixed-JSON envelope
 * (`sidecar/protocol.ts`, hand-ported per language via
 * `worker-sdk-protocol.eta`) — kept available behind
 * `--worker-sdk-protocol legacy` for anyone not yet ready to move off it; has
 * no schema-drift protection across languages the way `"grpc"` does, which
 * is the whole reason #100 exists.
 */
export type WorkerSdkProtocol = "grpc" | "legacy";

export interface WriteWorkerSdkOptions {
  protocol?: WorkerSdkProtocol;
}

/**
 * Working shape for the compiler's internal transform pipeline (
 * `generate-fsm-json.ts`) — the space between raw XState `.toJSON()` output
 * and the fully-compiled `FsmMachineJson` (see
 * `../../database-src/generated/fsm-machine-schema.types.ts`, generated from
 * `../../database-src/fsm.machine.schema.v3.json`). Entry/exit items may
 * still be plain strings (XState 5 action shorthand, normalized to
 * actionObjects by `normalizeActionsToObjects`) or `null` placeholders left
 * by conditionally-skipped actions in `machine.ts` (stripped by
 * `removeNullActions`). By the time `generateFsmJSONFromMachineFile`
 * finishes the pipeline, the result should satisfy `FsmMachineJson` —
 * enforced at runtime by the AJV validation in the `showRecommendation` step.
 */
export type FsmDraftAction = string | ActionObject;

export type FsmDraftTransition = {
  actions?: FsmDraftAction[];
  eventType?: string;
  delay?: string | number;
  guard?: string;
  source?: string;
  target?: string[];
};

export type FsmDraftInvoke = Partial<InvokeObject> & { src?: string };

export type FsmDraftStateNode = {
  id?: string;
  key?: string;
  type?: string;
  entry?: FsmDraftAction[];
  exit?: FsmDraftAction[];
  initial?: { actions?: FsmDraftAction[]; source?: string; target?: string[] };
  on?: Record<string, FsmDraftTransition[]>;
  transitions?: FsmDraftTransition[];
  invoke?: FsmDraftInvoke[];
  states?: Record<string, FsmDraftStateNode>;
};
