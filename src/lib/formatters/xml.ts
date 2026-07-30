import xmlFormat from "xml-formatter";

/**
 * XML formatting.
 *
 * `xml-formatter` is lenient in a way that matters here: given `<a><b></a>` it does not fail, even
 * with `throwOnFailure`, but silently emits `<a><b></b></a>`. Quietly rewriting a user's content
 * into something structurally different is worse than refusing to format it, so mismatched tags are
 * rejected before the formatter runs.
 *
 * The check below is a well-formedness scan over tag structure, not a validating XML parser. It
 * catches the realistic mistakes — an unclosed or mismatched tag — and deliberately runs identically
 * in Node and the browser rather than depending on DOMParser, so it is directly testable.
 */

interface OpenTag {
  name: string;
  index: number;
}

export function assertWellFormed(source: string): void {
  const stack: OpenTag[] = [];
  let i = 0;

  while (i < source.length) {
    const next = source.indexOf("<", i);
    if (next === -1) break;

    // Skip constructs whose contents are not markup.
    if (source.startsWith("<!--", next)) {
      i = skipPast(source, next, "-->", "comment");
      continue;
    }
    if (source.startsWith("<![CDATA[", next)) {
      i = skipPast(source, next, "]]>", "CDATA section");
      continue;
    }
    if (source.startsWith("<?", next)) {
      i = skipPast(source, next, "?>", "processing instruction");
      continue;
    }
    if (source.startsWith("<!", next)) {
      i = skipPast(source, next, ">", "declaration");
      continue;
    }

    const end = source.indexOf(">", next);
    if (end === -1) {
      throw new Error(`Unterminated tag at character ${next + 1}`);
    }

    const body = source.slice(next + 1, end);

    if (body.startsWith("/")) {
      const name = body.slice(1).trim();
      const open = stack.pop();
      if (!open) {
        throw new Error(`Closing tag </${name}> has no matching opening tag`);
      }
      if (open.name !== name) {
        throw new Error(`Closing tag </${name}> does not match <${open.name}>`);
      }
    } else if (!body.endsWith("/")) {
      const name = body.split(/[\s/>]/)[0] ?? "";
      if (name === "") {
        throw new Error(`Malformed tag at character ${next + 1}`);
      }
      stack.push({ name, index: next });
    }

    i = end + 1;
  }

  const unclosed = stack[stack.length - 1];
  if (unclosed) {
    throw new Error(`Tag <${unclosed.name}> is never closed`);
  }
}

function skipPast(source: string, from: number, terminator: string, what: string): number {
  const end = source.indexOf(terminator, from);
  if (end === -1) {
    throw new Error(`Unterminated ${what} at character ${from + 1}`);
  }
  return end + terminator.length;
}

export function formatXml(source: string): string {
  assertWellFormed(source);

  return xmlFormat(source, {
    indentation: "  ",
    collapseContent: true,
    lineSeparator: "\n",
    throwOnFailure: true,
  });
}
