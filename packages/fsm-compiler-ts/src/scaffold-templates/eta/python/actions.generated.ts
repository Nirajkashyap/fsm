// AUTO-GENERATED from actions.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile(
  "# <%~ it.label %>: <%~ it.name %>\ndef <%~ it.fnName %>(context, event):\n    # <%~ it.todo %>\n    pass\n\n",
);

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
