// AUTO-GENERATED from actors.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile(
  '# <%~ it.label %>: <%~ it.name %>\ndef <%~ it.fnName %>(input):\n    # <%~ it.todo %>\n    return {"input": input, "msg": "<%~ it.name %> actor invoked by <%~ it.lang %>"}\n\n',
);

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
