// AUTO-GENERATED from worker-sdk-gitignore.eta — do not edit directly.
// Run `deno task generate:templates` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile("/async-op-worker-sdk\n");

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
