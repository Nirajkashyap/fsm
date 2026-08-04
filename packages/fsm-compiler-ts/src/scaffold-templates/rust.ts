import type { LanguageTemplateSet } from "./types.ts";
import { render as actions } from "./eta/rust/actions.generated.ts";
import { render as guards } from "./eta/rust/guards.generated.ts";
import { render as delays } from "./eta/rust/delays.generated.ts";
import { render as actors } from "./eta/rust/actors.generated.ts";

/** Rust operation-logic stub templates. Sourced from eta/rust/*.eta. */
export const rustTemplates: LanguageTemplateSet = {
  stubs: { actions, guards, delays, actors },
};
