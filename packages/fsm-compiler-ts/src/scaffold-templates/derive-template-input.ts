import { DELAY_ACTION_NAME_PREFIX } from "../util.ts";
import type { OperationKind } from "../operation-logic-scaffold.ts";
import type { TemplateInput } from "./types.ts";

/**
 * Derives the values every template needs from a `(kind, name)` pair. Depends
 * only on `kind`, never on the target language.
 */
export function deriveTemplateInput(
  kind: OperationKind,
  name: string,
): TemplateInput {
  // Delays are exposed under a prefixed function name; the comment keeps the
  // original name for readability.
  const fnName = kind === "delays"
    ? `${DELAY_ACTION_NAME_PREFIX}${name}`
    : name;
  const label = kind.slice(0, 1).toUpperCase() + kind.slice(1, -1); // Action/Guard/Delay/Actor
  const todo = kind === "actors"
    ? "TODO: implement actor logic"
    : kind === "delays"
    ? "TODO: implement delay logic (return ms)"
    : "TODO: implement";

  return { name, fnName, label, todo };
}
