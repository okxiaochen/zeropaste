import { describe, expect, it } from "vitest";

import {
  computeFoldRanges,
  hiddenLines,
  topLevelFoldableLines,
} from "@/lib/highlight/folding";

/** Reads a fixture written as a template literal, dropping the leading newline. */
function lines(text: string): string[] {
  return text.replace(/^\n/, "").split("\n");
}

describe("computeFoldRanges", () => {
  it("finds a block in expanded JSON", () => {
    const source = lines(`
{
  "a": 1,
  "b": {
    "c": 2
  }
}`);
    const ranges = computeFoldRanges(source);
    // Line 0 `{` opens a block running to line 5 `}` — the last line indented deeper is line 4.
    expect(ranges.get(0)).toBe(4);
    // Line 2 `"b": {` runs to line 3.
    expect(ranges.get(2)).toBe(3);
    expect(ranges.has(1)).toBe(false);
  });

  it("nests arbitrarily deeply", () => {
    const ranges = computeFoldRanges(lines(`
a
  b
    c
      d`));
    expect(ranges.get(0)).toBe(3);
    expect(ranges.get(1)).toBe(3);
    expect(ranges.get(2)).toBe(3);
    expect(ranges.has(3)).toBe(false);
  });

  it("treats blank lines as transparent inside a block", () => {
    const ranges = computeFoldRanges(lines(`
def f():
    a = 1

    b = 2
c = 3`));
    expect(ranges.get(0)).toBe(3);
  });

  it("does not swallow trailing blank lines into a block", () => {
    const ranges = computeFoldRanges(lines(`
a
  b


`));
    expect(ranges.get(0)).toBe(1);
  });

  it("expands tabs to a tab stop so mixed indentation still nests", () => {
    const ranges = computeFoldRanges(["a", "\tb", "        c"]);
    // A tab is 4 columns, so 8 spaces is deeper and line 1 is a header.
    expect(ranges.get(0)).toBe(2);
    expect(ranges.get(1)).toBe(2);
  });

  it("finds nothing to fold in flat content", () => {
    expect(computeFoldRanges(lines(`
one
two
three`)).size).toBe(0);
  });

  it("finds nothing to fold in minified content", () => {
    // The case indentation-based folding cannot serve — and where there is nothing to fold anyway.
    expect(computeFoldRanges(['{"a":1,"b":{"c":2}}']).size).toBe(0);
  });

  it("handles an empty document and a single line", () => {
    expect(computeFoldRanges([]).size).toBe(0);
    expect(computeFoldRanges(["only"]).size).toBe(0);
  });

  it("closes a block when indentation returns to the header's level", () => {
    const ranges = computeFoldRanges(lines(`
if a:
    x
else:
    y`));
    expect(ranges.get(0)).toBe(1);
    expect(ranges.get(2)).toBe(3);
  });
});

describe("hiddenLines", () => {
  const source = lines(`
{
  "a": {
    "b": 1
  },
  "c": 2
}`);
  const ranges = computeFoldRanges(source);

  it("hides a block's body but not its header", () => {
    const hidden = hiddenLines(source.length, new Set([1]), ranges);
    expect(hidden[1]).toBe(false);
    expect(hidden[2]).toBe(true);
    expect(hidden[3]).toBe(false);
  });

  it("hides everything under a collapsed outer block", () => {
    const hidden = hiddenLines(source.length, new Set([0]), ranges);
    expect(hidden[0]).toBe(false);
    expect(hidden.slice(1, 5).every(Boolean)).toBe(true);
  });

  it("keeps an inner collapse independent of an outer one", () => {
    // Collapsing then expanding the outer block must not reset the inner block's state.
    const both = hiddenLines(source.length, new Set([0, 1]), ranges);
    expect(both.slice(1, 5).every(Boolean)).toBe(true);

    const innerOnly = hiddenLines(source.length, new Set([1]), ranges);
    expect(innerOnly[2]).toBe(true);
    expect(innerOnly[4]).toBe(false);
  });

  it("ignores a collapsed line that is not a header", () => {
    expect(hiddenLines(source.length, new Set([99]), ranges).some(Boolean)).toBe(false);
  });

  it("hides nothing when nothing is collapsed", () => {
    expect(hiddenLines(source.length, new Set(), ranges).some(Boolean)).toBe(false);
  });
});

describe("topLevelFoldableLines", () => {
  it("returns only the outermost headers", () => {
    const source = lines(`
{
  "a": {
    "b": 1
  }
}
[
  1
]`);
    const ranges = computeFoldRanges(source);
    expect(topLevelFoldableLines(ranges)).toEqual([0, 5]);
  });

  it("returns an empty list when there is nothing to fold", () => {
    expect(topLevelFoldableLines(computeFoldRanges(["flat"]))).toEqual([]);
  });
});
