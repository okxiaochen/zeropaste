import type { Extension } from "@codemirror/state";

/**
 * CodeMirror grammar loaders, one per language id in src/lib/languages.ts.
 *
 * Every entry is a dynamic import. Loading all grammars eagerly would add well over a megabyte to
 * the create page, and a given user needs exactly one.
 *
 * Languages CodeMirror has no dedicated package for use `@codemirror/legacy-modes`, which wraps the
 * older CodeMirror 5 stream parsers. They highlight less precisely than the Lezer grammars but cover
 * the long tail; `null` means plain text with no highlighting at all.
 */

type Loader = () => Promise<Extension | null>;

async function legacy(name: keyof typeof legacyModes): Promise<Extension> {
  const [{ StreamLanguage }, mode] = await Promise.all([
    import("@codemirror/language"),
    legacyModes[name](),
  ]);
  return StreamLanguage.define(mode);
}

// Indirection so each legacy mode is still its own dynamic import.
const legacyModes = {
  ruby: async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby,
  swift: async () => (await import("@codemirror/legacy-modes/mode/swift")).swift,
  csharp: async () => (await import("@codemirror/legacy-modes/mode/clike")).csharp,
  kotlin: async () => (await import("@codemirror/legacy-modes/mode/clike")).kotlin,
  shell: async () => (await import("@codemirror/legacy-modes/mode/shell")).shell,
  powershell: async () => (await import("@codemirror/legacy-modes/mode/powershell")).powerShell,
  dockerfile: async () => (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile,
  toml: async () => (await import("@codemirror/legacy-modes/mode/toml")).toml,
  ini: async () => (await import("@codemirror/legacy-modes/mode/properties")).properties,
  diff: async () => (await import("@codemirror/legacy-modes/mode/diff")).diff,
} as const;

const LOADERS: Record<string, Loader> = {
  plaintext: async () => null,
  log: async () => null,

  javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
  jsx: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  tsx: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),

  json: async () => (await import("@codemirror/lang-json")).json(),
  jsonc: async () => (await import("@codemirror/lang-json")).json(),

  html: async () => (await import("@codemirror/lang-html")).html(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  scss: async () => (await import("@codemirror/lang-sass")).sass({ indented: false }),
  less: async () => (await import("@codemirror/lang-less")).less(),

  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),

  python: async () => (await import("@codemirror/lang-python")).python(),
  go: async () => (await import("@codemirror/lang-go")).go(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  java: async () => (await import("@codemirror/lang-java")).java(),
  c: async () => (await import("@codemirror/lang-cpp")).cpp(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  php: async () => (await import("@codemirror/lang-php")).php(),

  ruby: () => legacy("ruby"),
  swift: () => legacy("swift"),
  csharp: () => legacy("csharp"),
  kotlin: () => legacy("kotlin"),
  shell: () => legacy("shell"),
  powershell: () => legacy("powershell"),
  dockerfile: () => legacy("dockerfile"),
  toml: () => legacy("toml"),
  ini: () => legacy("ini"),
  diff: () => legacy("diff"),
};

/**
 * Resolves the editor extension for a language.
 *
 * A missing or failed grammar degrades to plain text rather than breaking the editor: being unable
 * to colour someone's text is not a reason to stop them pasting it.
 */
export async function loadEditorLanguage(languageId: string): Promise<Extension | null> {
  const loader = LOADERS[languageId];
  if (!loader) return null;

  try {
    return await loader();
  } catch (error) {
    console.warn(`zeropaste: could not load the ${languageId} grammar`, error);
    return null;
  }
}

/** GraphQL has no CodeMirror package in this dependency set; the registry still allows formatting. */
export function hasEditorGrammar(languageId: string): boolean {
  return languageId in LOADERS;
}
