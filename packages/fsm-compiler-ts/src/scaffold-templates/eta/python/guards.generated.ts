// AUTO-GENERATED from guards.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";
import type { TemplateFn } from "../../types.ts";

const compiled = eta.compile(
  "# <%~ it.label %>: <%~ it.name %>\ndef <%~ it.fnName %>(context, event):\n    # <%~ it.todo %>\n    return True\n\n",
);

export const render: TemplateFn = (input) => compiled.call(eta, input);
