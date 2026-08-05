// AUTO-GENERATED from actions.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile(
  "// <%~ it.label %>: <%~ it.name %>\nfunc <%~ it.fnName %>(context map[string]any, event map[string]any) {\n\t// <%~ it.todo %>\n}\n\n",
);

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
