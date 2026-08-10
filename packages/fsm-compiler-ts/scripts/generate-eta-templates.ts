// Reads every `.eta` file under src/scaffold-templates/eta/ and writes a
// sibling `<name>.generated.ts` module that embeds the template source and
// compiles it once at module load via the shared Eta instance's `.compile()`.
// Regenerate after editing any `.eta` file: `deno task generate:templates`.
const ETA_DIR = new URL("../src/scaffold-templates/eta/", import.meta.url);

for await (const langEntry of Deno.readDir(ETA_DIR)) {
  if (!langEntry.isDirectory) continue;
  const langDir = new URL(`${langEntry.name}/`, ETA_DIR);

  for await (const fileEntry of Deno.readDir(langDir)) {
    if (!fileEntry.isFile || !fileEntry.name.endsWith(".eta")) continue;
    const kind = fileEntry.name.replace(/\.eta$/, "");
    const etaPath = new URL(fileEntry.name, langDir);
    const outPath = new URL(`${kind}.generated.ts`, langDir);

    const source = await Deno.readTextFile(etaPath);
    // Generic `unknown` input rather than the stub-specific `TemplateInput`:
    // this same script also generates whole-file/list-based templates
    // (registries, go.mod) whose input shape TemplateInput doesn't fit.
    // `(input: unknown) => string` is still assignable to `TemplateFn`
    // (contravariance), so existing per-stub consumers are unaffected.
    const out = `// AUTO-GENERATED from ${kind}.eta — do not edit directly.
// Run \`deno task generate:templates\` after editing the .eta source.
import { eta } from "../eta-instance.ts";

const compiled = eta.compile(${JSON.stringify(source)});

export const render: (input: unknown) => string = (input) =>
  compiled.call(eta, input as object);
`;
    await Deno.writeTextFile(outPath, out);
    console.log(`Wrote ${outPath.pathname}`);
  }
}
