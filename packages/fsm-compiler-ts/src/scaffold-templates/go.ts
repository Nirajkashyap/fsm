import type { LanguageTemplateSet } from "./types.ts";
import { render as actions } from "./eta/go/actions.generated.ts";
import { render as guards } from "./eta/go/guards.generated.ts";
import { render as delays } from "./eta/go/delays.generated.ts";
import { render as actors } from "./eta/go/actors.generated.ts";

/** Go operation-logic stub templates. Sourced from eta/go/*.eta. Every generated module gets a package header. */
export const goTemplates: LanguageTemplateSet = {
  stubs: { actions, guards, delays, actors },
  preamble: (kind) => `package ${kind}\n\n`,
};
