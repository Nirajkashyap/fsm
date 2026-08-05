// AUTO-GENERATED from go-mod-actor.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile("module <%~ it.modulePath %>\n\ngo 1.19\n");

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
