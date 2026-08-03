// AUTO-GENERATED from actors.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";
import type { TemplateFn } from "../../types.ts";

const compiled = eta.compile(
  "// <%~ it.label %>: <%~ it.name %>\n#[allow(non_snake_case)]\npub fn <%~ it.fnName %>(context: &serde_json::Value, event: &serde_json::Value) {\n    // <%~ it.todo %>\n}\n\n",
);

export const render: TemplateFn = (input) => compiled.call(eta, input);
