import { describe, expect, it } from "vitest";

import { highlight, plainLines, type Token } from "@/lib/highlight/shiki";

/** Reassembles the source text from tokens, which must be lossless in both directions. */
function textOf(lines: Token[][]): string {
  return lines.map((tokens) => tokens.map((token) => token.content).join("")).join("\n");
}

describe("plainLines", () => {
  it("produces one line per source line", () => {
    expect(plainLines("a\nb\nc")).toHaveLength(3);
  });

  it("round-trips content exactly", () => {
    const source = `<script>alert('x')</script> & "quoted"\n\tindented\n`;
    expect(textOf(plainLines(source))).toBe(source);
  });

  it("represents a blank line as an empty token list", () => {
    expect(plainLines("a\n\nb")[1]).toEqual([]);
  });

  it("does not escape, because React does", () => {
    // Escaping here would double-encode. The security property now comes from rendering tokens as
    // React children rather than from string manipulation, so there is no innerHTML in this path.
    expect(plainLines("<img>")[0]?.[0]?.content).toBe("<img>");
  });
});

describe("highlight", () => {
  it("highlights a known language with both theme variables per token", async () => {
    const result = await highlight("const x = 1;", "typescript", 0);
    expect(result.highlighted).toBe(true);

    const styles = result.lines.flat().map((token) => token.style);
    expect(styles.some((style) => style?.["--shiki-light"])).toBe(true);
    expect(styles.some((style) => style?.["--shiki-dark"])).toBe(true);
  });

  it("preserves the source exactly through tokenisation", async () => {
    const source = "const a = 1;\n\nif (a) {\n  b();\n}";
    const result = await highlight(source, "typescript", 0);
    expect(textOf(result.lines)).toBe(source);
  });

  it("preserves multibyte content through tokenisation", async () => {
    const source = 'const s = "日本語 🔐";';
    expect(textOf((await highlight(source, "typescript", 0)).lines)).toBe(source);
  });

  it("falls back to plain text for plaintext", async () => {
    const result = await highlight("just words", "plaintext", 0);
    expect(result.highlighted).toBe(false);
    expect(textOf(result.lines)).toBe("just words");
  });

  it("falls back to plain text above the byte limit", async () => {
    // Guards the case that would otherwise freeze the tab for minutes.
    const big = "x".repeat(5000);
    const result = await highlight(big, "typescript", 1000);
    expect(result.highlighted).toBe(false);
    expect(textOf(result.lines)).toBe(big);
  });

  it("measures the limit in bytes, not characters", async () => {
    // 400 multibyte characters are well under a 1000-character budget but over a 1000-byte one.
    expect((await highlight("日".repeat(400), "typescript", 1000)).highlighted).toBe(false);
  });

  it("treats a limit of 0 as unlimited", async () => {
    expect((await highlight("const x = 1;".repeat(500), "typescript", 0)).highlighted).toBe(true);
  });

  it("falls back rather than throwing for an unknown language", async () => {
    const result = await highlight("content", "klingon", 0);
    expect(result.highlighted).toBe(false);
    expect(textOf(result.lines)).toBe("content");
  });
});
