import type { HighlighterCore } from "shiki/core";
import type { LanguageRegistration } from "shiki";

import { resolveLanguage } from "../languages";

/**
 * Shiki highlighting for the viewer.
 *
 * Built with `createHighlighterCore` and the JavaScript regex engine rather than the default bundle:
 * the full bundle carries all ~690 grammars Shiki ships. Here the engine loads once and each grammar
 * is fetched only when a paste actually uses it.
 *
 * Both themes are baked into the same markup via `themes`, and globals.css selects one with a media
 * query. The OS colour scheme is therefore honoured with no flash, no JavaScript, and no second
 * highlighting pass.
 */

/**
 * One entry per Shiki id in src/lib/languages.ts.
 *
 * Spelled out rather than built from a template string, because `import(\`…/${id}\`)` cannot be
 * statically analysed: a bundler either fails to resolve it or, worse, includes every grammar in the
 * directory to be safe. The `.mjs` suffix is required by Shiki's exports map.
 */
const GRAMMARS: Record<string, () => Promise<{ default: LanguageRegistration[] }>> = {
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  log: () => import("shiki/langs/log.mjs"),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] =
        await Promise.all([
          import("shiki/core"),
          import("shiki/engine/javascript"),
          import("shiki/themes/github-light.mjs"),
          import("shiki/themes/github-dark.mjs"),
        ]);

      return createHighlighterCore({
        themes: [light.default, dark.default],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    })();
  }
  return highlighterPromise;
}

/** Returns false when the grammar is unavailable, so the caller can fall back to plain text. */
async function ensureLanguage(highlighter: HighlighterCore, shikiId: string): Promise<boolean> {
  // Shiki treats "text" as plain text with no grammar to load.
  if (shikiId === "text") return false;
  if (loaded.has(shikiId)) return true;

  const load = GRAMMARS[shikiId];
  if (!load) return false;

  try {
    const grammar = await load();
    await highlighter.loadLanguage(grammar.default);
    loaded.add(shikiId);
    return true;
  } catch (error) {
    console.warn(`zeropaste: could not load the ${shikiId} grammar`, error);
    return false;
  }
}

/** One styled run of text. `style` is absent on the plain-text fallback path. */
export interface Token {
  content: string;
  style?: Record<string, string> | undefined;
}

export interface HighlightResult {
  /** One entry per source line, so the viewer can render a gutter and fold controls per line. */
  lines: Token[][];
  /** False when the content was rendered as plain text. */
  highlighted: boolean;
}

/**
 * Highlights content into per-line token arrays, or returns unstyled lines if that is not possible.
 *
 * Tokens rather than an HTML string, for two reasons. The viewer needs a real element per line to
 * hang a fold control and a gutter off, which a single blob of `innerHTML` cannot provide. And
 * rendering tokens through React means the decrypted content is escaped by the framework, so there is
 * no `dangerouslySetInnerHTML` anywhere in the path that displays attacker-supplied text.
 *
 * `limitBytes` matters because tokenising is synchronous: a multi-megabyte paste would block the main
 * thread long enough to look like a crash. Past the limit the content is shown unhighlighted, which
 * is far better than an unresponsive tab.
 */
export async function highlight(
  code: string,
  languageId: string,
  limitBytes: number,
): Promise<HighlightResult> {
  const language = resolveLanguage(languageId);

  if (limitBytes > 0 && new TextEncoder().encode(code).length > limitBytes) {
    return { lines: plainLines(code), highlighted: false };
  }

  try {
    const highlighter = await getHighlighter();
    if (!(await ensureLanguage(highlighter, language.shiki))) {
      return { lines: plainLines(code), highlighted: false };
    }

    const { tokens } = highlighter.codeToTokens(code, {
      lang: language.shiki,
      themes: { light: "github-light", dark: "github-dark" },
      // No default colour: each token carries CSS variables for both themes, and a media query in
      // globals.css picks one. No re-highlighting when the OS scheme changes.
      defaultColor: false,
      cssVariablePrefix: "--shiki-",
    });

    return {
      lines: tokens.map((line) =>
        line.map((token) => ({ content: token.content, style: token.htmlStyle })),
      ),
      highlighted: true,
    };
  } catch (error) {
    console.warn("zeropaste: highlighting failed, falling back to plain text", error);
    return { lines: plainLines(code), highlighted: false };
  }
}

/** The fallback: one unstyled token per line. React escapes the content on render. */
export function plainLines(code: string): Token[][] {
  return code.split("\n").map((line) => (line === "" ? [] : [{ content: line }]));
}
