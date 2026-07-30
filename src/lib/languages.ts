/**
 * The single language registry.
 *
 * One entry per supported language, mapping to the Shiki grammar used by the viewer and the
 * formatter (if any) offered by the editor. Phase 2 adds the CodeMirror loader and wires
 * `formatter` up to real implementations; the shape is settled now so both sides agree.
 *
 * `formatter: null` is a deliberate statement, not a gap. Python, Go, and Rust formatters exist
 * only as native binaries, and the work cannot be moved to the server because the server never has
 * plaintext. Supporting them means shipping multi-megabyte WASM builds, which is a Phase 3 call.
 */

export type FormatterId = "prettier" | "sql" | "xml";

export interface LanguageDefinition {
  /** Stable id stored inside the encrypted payload. Never change these. */
  id: string;
  label: string;
  /** Shiki grammar name. */
  shiki: string;
  formatter: FormatterId | null;
  /** Prettier parser name, when formatter is "prettier". */
  prettierParser?: string;
}

export const LANGUAGES: readonly LanguageDefinition[] = [
  { id: "plaintext", label: "Plain text", shiki: "text", formatter: null },

  // Prettier-formattable
  { id: "javascript", label: "JavaScript", shiki: "javascript", formatter: "prettier", prettierParser: "babel" },
  { id: "jsx", label: "JSX", shiki: "jsx", formatter: "prettier", prettierParser: "babel" },
  { id: "typescript", label: "TypeScript", shiki: "typescript", formatter: "prettier", prettierParser: "typescript" },
  { id: "tsx", label: "TSX", shiki: "tsx", formatter: "prettier", prettierParser: "typescript" },
  { id: "json", label: "JSON", shiki: "json", formatter: "prettier", prettierParser: "json" },
  { id: "jsonc", label: "JSON with comments", shiki: "jsonc", formatter: "prettier", prettierParser: "json5" },
  { id: "html", label: "HTML", shiki: "html", formatter: "prettier", prettierParser: "html" },
  { id: "css", label: "CSS", shiki: "css", formatter: "prettier", prettierParser: "css" },
  { id: "scss", label: "SCSS", shiki: "scss", formatter: "prettier", prettierParser: "scss" },
  { id: "less", label: "Less", shiki: "less", formatter: "prettier", prettierParser: "less" },
  { id: "markdown", label: "Markdown", shiki: "markdown", formatter: "prettier", prettierParser: "markdown" },
  { id: "yaml", label: "YAML", shiki: "yaml", formatter: "prettier", prettierParser: "yaml" },
  { id: "graphql", label: "GraphQL", shiki: "graphql", formatter: "prettier", prettierParser: "graphql" },

  // Other formatters
  { id: "sql", label: "SQL", shiki: "sql", formatter: "sql" },
  { id: "xml", label: "XML", shiki: "xml", formatter: "xml" },

  // Highlight only
  { id: "python", label: "Python", shiki: "python", formatter: null },
  { id: "go", label: "Go", shiki: "go", formatter: null },
  { id: "rust", label: "Rust", shiki: "rust", formatter: null },
  { id: "java", label: "Java", shiki: "java", formatter: null },
  { id: "kotlin", label: "Kotlin", shiki: "kotlin", formatter: null },
  { id: "swift", label: "Swift", shiki: "swift", formatter: null },
  { id: "c", label: "C", shiki: "c", formatter: null },
  { id: "cpp", label: "C++", shiki: "cpp", formatter: null },
  { id: "csharp", label: "C#", shiki: "csharp", formatter: null },
  { id: "php", label: "PHP", shiki: "php", formatter: null },
  { id: "ruby", label: "Ruby", shiki: "ruby", formatter: null },
  { id: "shell", label: "Shell", shiki: "shellscript", formatter: null },
  { id: "powershell", label: "PowerShell", shiki: "powershell", formatter: null },
  { id: "dockerfile", label: "Dockerfile", shiki: "dockerfile", formatter: null },
  { id: "toml", label: "TOML", shiki: "toml", formatter: null },
  { id: "ini", label: "INI", shiki: "ini", formatter: null },
  { id: "diff", label: "Diff", shiki: "diff", formatter: null },
  { id: "log", label: "Log", shiki: "log", formatter: null },
] as const;

export const DEFAULT_LANGUAGE_ID = "plaintext";

const byId = new Map(LANGUAGES.map((language) => [language.id, language]));

export function findLanguage(id: string): LanguageDefinition | undefined {
  return byId.get(id);
}

/**
 * Resolves a language id that came out of a decrypted payload.
 *
 * Falls back to plain text rather than throwing: an old paste referencing a language that has since
 * been removed should still be readable.
 */
export function resolveLanguage(id: string): LanguageDefinition {
  return byId.get(id) ?? byId.get(DEFAULT_LANGUAGE_ID)!;
}
