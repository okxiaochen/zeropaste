/**
 * Fold ranges for the viewer, derived from indentation.
 *
 * The viewer highlights with Shiki, which produces styled tokens but no syntax tree, so there is no
 * language-aware block structure to fold on. Indentation is the alternative, and it is a better fit
 * here than it first appears: it works identically for JSON, YAML, Python, and every brace language
 * written in a conventional style, with no per-language grammar to download. Content that defeats it
 * — minified or single-line — has nothing worth folding anyway.
 *
 * The editor takes the other route: CodeMirror already has the grammar loaded, so it folds using the
 * real syntax tree.
 */

/** Maps the index of a foldable header line to the index of the last line inside its block. */
export type FoldRanges = ReadonlyMap<number, number>;

const TAB_WIDTH = 4;

/** Visual indent width, expanding tabs to the next tab stop the way an editor renders them. */
function indentWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += TAB_WIDTH - (width % TAB_WIDTH);
    else break;
  }
  return width;
}

/**
 * A line is a fold header when the next non-blank line is indented further. Its block runs to the
 * last line more deeply indented than it.
 *
 * Blank lines are transparent: they neither open nor close a block, so a blank line between two
 * nested entries does not split the block in two, and trailing blank lines are not swallowed into it.
 */
export function computeFoldRanges(lines: readonly string[]): FoldRanges {
  const indents = lines.map((line) => (line.trim() === "" ? null : indentWidth(line)));
  const ranges = new Map<number, number>();

  for (let i = 0; i < lines.length; i += 1) {
    const current = indents[i];
    if (current === null || current === undefined) continue;

    let next = i + 1;
    while (next < lines.length && indents[next] === null) next += 1;
    if (next >= lines.length) continue;

    const nextIndent = indents[next];
    if (nextIndent === null || nextIndent === undefined || nextIndent <= current) continue;

    let end = next;
    for (let k = next; k < lines.length; k += 1) {
      const indent = indents[k];
      if (indent === null || indent === undefined) continue;
      if (indent <= current) break;
      end = k;
    }

    ranges.set(i, end);
  }

  return ranges;
}

/**
 * Which lines are hidden, given a set of collapsed headers.
 *
 * Nesting needs no special handling: hidden regions are a union, so collapsing an outer block hides
 * inner headers whether or not they are themselves collapsed, and expanding it restores their own
 * state rather than resetting it.
 */
export function hiddenLines(
  totalLines: number,
  collapsed: ReadonlySet<number>,
  ranges: FoldRanges,
): boolean[] {
  const hidden = new Array<boolean>(totalLines).fill(false);

  for (const start of collapsed) {
    const end = ranges.get(start);
    if (end === undefined) continue;
    for (let i = start + 1; i <= end && i < totalLines; i += 1) {
      hidden[i] = true;
    }
  }

  return hidden;
}

/** Every foldable header, for a fold-all control. */
export function allFoldableLines(ranges: FoldRanges): number[] {
  return [...ranges.keys()].sort((a, b) => a - b);
}

/**
 * Headers whose block is not inside another block — the outermost level.
 *
 * Folding these rather than everything is what a "collapse all" usually means: one keystroke to an
 * overview, rather than every leaf object collapsed into noise.
 */
export function topLevelFoldableLines(ranges: FoldRanges): number[] {
  const headers = allFoldableLines(ranges);

  return headers.filter(
    (header) =>
      !headers.some((other) => {
        if (other === header) return false;
        const end = ranges.get(other);
        return end !== undefined && other < header && header <= end;
      }),
  );
}
