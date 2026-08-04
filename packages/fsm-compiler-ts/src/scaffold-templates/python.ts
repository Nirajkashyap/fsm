import type { LanguageTemplateSet } from "./types.ts";
import { render as actions } from "./eta/python/actions.generated.ts";
import { render as guards } from "./eta/python/guards.generated.ts";
import { render as delays } from "./eta/python/delays.generated.ts";
import { render as actors } from "./eta/python/actors.generated.ts";

/** Python operation-logic stub templates. Sourced from eta/python/*.eta. */
export const pythonTemplates: LanguageTemplateSet = {
  stubs: { actions, guards, delays, actors },
};
