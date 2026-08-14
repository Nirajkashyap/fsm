import type {
  OperationKind,
  OperationLang,
} from "../operation-logic-scaffold.ts";

/** Values derived from a `(kind, name, lang)` triple, passed to every template function. */
export type TemplateInput = {
  name: string;
  fnName: string;
  label: string;
  todo: string;
  lang: OperationLang;
};

/** Renders one operation-logic stub for a given kind. */
export type TemplateFn = (input: TemplateInput) => string;

/** Renders a file-level header (e.g. a package declaration) for a given kind. */
export type PreambleFn = (kind: OperationKind) => string;

/** All templates for a single language. `preamble` defaults to `""` when absent. */
export type LanguageTemplateSet = {
  stubs: Record<OperationKind, TemplateFn>;
  preamble?: PreambleFn;
};
