import type { Plugin } from "prettier";
import * as prettier from "prettier/standalone";

import type { LanguageDefinition } from "../languages";

/**
 * Prettier in the browser.
 *
 * `prettier/standalone` carries no plugins, so each parser has to be requested explicitly. Loading
 * them per parser rather than all at once keeps the cost proportional to what the user actually
 * formats — the full set is several hundred kilobytes.
 */

async function loadPlugins(parser: string): Promise<Plugin[]> {
  switch (parser) {
    case "babel":
    case "json":
    case "json5": {
      // The babel parser needs estree for printing.
      const [babel, estree] = await Promise.all([
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
      ]);
      return [babel.default as Plugin, estree.default as unknown as Plugin];
    }
    case "typescript": {
      const [typescript, estree] = await Promise.all([
        import("prettier/plugins/typescript"),
        import("prettier/plugins/estree"),
      ]);
      return [typescript.default as Plugin, estree.default as unknown as Plugin];
    }
    case "html": {
      const html = await import("prettier/plugins/html");
      return [html.default as Plugin];
    }
    case "css":
    case "scss":
    case "less": {
      const postcss = await import("prettier/plugins/postcss");
      return [postcss.default as Plugin];
    }
    case "markdown": {
      const markdown = await import("prettier/plugins/markdown");
      return [markdown.default as Plugin];
    }
    case "yaml": {
      const yaml = await import("prettier/plugins/yaml");
      return [yaml.default as Plugin];
    }
    case "graphql": {
      const graphql = await import("prettier/plugins/graphql");
      return [graphql.default as Plugin];
    }
    default:
      throw new Error(`No Prettier plugin is wired up for parser "${parser}"`);
  }
}

/**
 * Data formats are always fully expanded, one value per line.
 *
 * Prettier's default for JSON is width-based with an "objectWrap: preserve" heuristic: an object
 * written on a single line stays on a single line as long as it fits in printWidth. That is
 * reasonable for source code but wrong for what people mean by "format this JSON" — they want it
 * exploded so it can be read and folded. A printWidth of 1 makes every object and array break.
 *
 * Worth noting why this is done through Prettier rather than the obvious
 * `JSON.stringify(JSON.parse(source), null, 2)`: that round-trip silently corrupts data. Integer
 * literals beyond Number.MAX_SAFE_INTEGER lose precision — `12345678901234567890` comes back as
 * `12345678901234567000` — and integer-like keys get reordered. Prettier reprints the original
 * literal verbatim.
 */
const ALWAYS_EXPAND_PARSERS = new Set(["json", "json5"]);

export async function formatWithPrettier(
  source: string,
  language: LanguageDefinition,
): Promise<string> {
  const parser = language.prettierParser;
  if (!parser) {
    throw new Error(`${language.label} has no Prettier parser configured`);
  }

  return prettier.format(source, {
    parser,
    plugins: await loadPlugins(parser),
    ...(ALWAYS_EXPAND_PARSERS.has(parser) ? { printWidth: 1 } : {}),
  });
}
