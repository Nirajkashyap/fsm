// AUTO-GENERATED from delays.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile(
  "// <%~ it.label %>: <%~ it.name %>\nexport function <%~ it.fnName %>(context: any, event: any): number {\n  // <%~ it.todo %>\n  return 0;\n}\n\n",
);

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
