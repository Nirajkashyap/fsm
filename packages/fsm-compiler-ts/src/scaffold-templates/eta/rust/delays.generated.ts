// AUTO-GENERATED from delays.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile(
  "// <%~ it.label %>: <%~ it.name %>\n#[allow(non_snake_case)]\npub fn <%~ it.fnName %>(context: &serde_json::Value, event: &serde_json::Value) -> u64 {\n    // <%~ it.todo %>\n    0\n}\n\n",
);

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
