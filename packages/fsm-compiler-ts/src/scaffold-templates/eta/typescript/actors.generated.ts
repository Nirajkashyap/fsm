// AUTO-GENERATED from actors.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile(
  '// <%~ it.label %>: <%~ it.name %>\nexport function <%~ it.fnName %>(input: unknown): unknown {\n  // <%~ it.todo %>\n  return { input, msg: "<%~ it.name %> actor invoked by <%~ it.lang %>" };\n}\n\n',
);

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
