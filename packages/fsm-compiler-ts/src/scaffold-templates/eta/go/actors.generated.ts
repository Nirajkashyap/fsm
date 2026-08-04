// AUTO-GENERATED from actors.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";
import type { TemplateFn } from "../../types.ts";

const compiled = eta.compile(
  "// <%~ it.label %>: <%~ it.name %>\nfunc <%~ it.fnName %>(input any) (any, error) {\n\t// <%~ it.todo %>\n\treturn map[string]any{}, nil\n}\n\n",
);

export const render: TemplateFn = (input) => compiled.call(eta, input);
