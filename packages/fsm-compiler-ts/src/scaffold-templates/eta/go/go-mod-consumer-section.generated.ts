// AUTO-GENERATED from go-mod-consumer-section.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile(
  "<% for (const r of it.requires) { -%>\nrequire <%~ r.modulePath %> v0.0.0\nreplace <%~ r.modulePath %> => <%~ r.target %>\n<% } -%>\n",
);

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
