// AUTO-GENERATED from actors.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";
import type { TemplateFn } from "../../types.ts";

const compiled = eta.compile(
  "# <%~ it.label %>: <%~ it.name %>\ndef <%~ it.fnName %>(input):\n    # <%~ it.todo %>\n    return {}\n\n",
);

export const render: TemplateFn = (input) => compiled.call(eta, input);
