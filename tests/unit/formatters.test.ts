import { describe, expect, it } from "vitest";

import { FormatFailedError, FormatterUnavailableError, canFormat, format } from "@/lib/formatters";

describe("canFormat", () => {
  it("reports the languages that have a formatter", () => {
    expect(canFormat("typescript")).toBe(true);
    expect(canFormat("sql")).toBe(true);
    expect(canFormat("xml")).toBe(true);
  });

  it("reports the languages that do not", () => {
    // Not a gap to fix casually: these formatters exist only as native binaries, and the work cannot
    // move to the server because the server has no plaintext.
    expect(canFormat("python")).toBe(false);
    expect(canFormat("go")).toBe(false);
    expect(canFormat("rust")).toBe(false);
    expect(canFormat("plaintext")).toBe(false);
  });

  it("reports false for an unknown language", () => {
    expect(canFormat("klingon")).toBe(false);
  });
});

describe("format", () => {
  it("formats TypeScript", async () => {
    const output = await format("const x   =    {a:1,b:2}", "typescript");
    expect(output).toBe("const x = { a: 1, b: 2 };\n");
  });

  it("fully expands JSON rather than leaving it on one line", async () => {
    // Prettier's default would keep this inline because it fits printWidth. Nobody presses "Format"
    // on JSON wanting it to stay on one line.
    expect(await format('{"b":2,"a":[1,2]}', "json")).toBe(
      '{\n  "b": 2,\n  "a": [\n    1,\n    2\n  ]\n}\n',
    );
  });

  it("expands nested JSON at every level", async () => {
    const output = await format('{"a":{"b":{"c":1}}}', "json");
    expect(output.split("\n").filter((line) => line.trim() !== "")).toHaveLength(7);
  });

  it("does not lose precision on large JSON integers", async () => {
    // The reason formatting goes through Prettier instead of JSON.parse/stringify, which would
    // silently return 12345678901234567000.
    expect(await format('{"id":12345678901234567890}', "json")).toContain("12345678901234567890");
  });

  it("does not reorder integer-like JSON keys", async () => {
    // JSON.parse/stringify would sort these numerically. Prettier preserves source order.
    const output = await format('{"2":"two","1":"one"}', "json");
    expect(output.indexOf('"2"')).toBeLessThan(output.indexOf('"1"'));
  });

  it("keeps normal width behaviour for source code", async () => {
    // The always-expand rule must not leak into JavaScript, where inline objects are correct style.
    expect(await format("const x = {a:1,b:2}", "typescript")).toBe("const x = { a: 1, b: 2 };\n");
  });

  it("formats CSS", async () => {
    expect(await format("a{color:red}", "css")).toBe("a {\n  color: red;\n}\n");
  });

  it("formats YAML", async () => {
    expect(await format("a:   1\nb:  2", "yaml")).toBe("a: 1\nb: 2\n");
  });

  it("formats Markdown", async () => {
    expect(await format("#   Title", "markdown")).toBe("# Title\n");
  });

  it("formats SQL and upcases keywords", async () => {
    const output = await format("select a,b from t where a=1", "sql");
    expect(output).toContain("SELECT");
    expect(output).toContain("FROM");
    expect(output).toContain("WHERE");
  });

  it("formats XML", async () => {
    const output = await format("<a><b>1</b></a>", "xml");
    expect(output).toBe("<a>\n  <b>1</b>\n</a>");
  });

  it("refuses a language with no formatter", async () => {
    await expect(format("print(1)", "python")).rejects.toThrow(FormatterUnavailableError);
  });

  it("reports a syntax error without losing the input", async () => {
    // The editor keeps the original text on failure; this asserts the error type it branches on.
    await expect(format("const = = =", "typescript")).rejects.toThrow(FormatFailedError);
  });

  it("refuses to silently repair mismatched XML tags", async () => {
    // xml-formatter would happily turn this into <a><b></b></a>. Rewriting a user's content into
    // something structurally different is worse than declining to format it.
    await expect(format("<a><b></a>", "xml")).rejects.toThrow(/does not match/);
  });

  it("refuses unclosed XML tags", async () => {
    await expect(format("<a><b>1</b>", "xml")).rejects.toThrow(/never closed/);
    await expect(format("<a", "xml")).rejects.toThrow(/Unterminated tag/);
  });

  it("accepts XML with a declaration, comments, CDATA, and self-closing tags", async () => {
    const source = '<?xml version="1.0"?><r><!-- c --><s/><t><![CDATA[<not a tag>]]></t></r>';
    await expect(format(source, "xml")).resolves.toContain("<s/>");
  });

  it("does not mistake markup inside CDATA or comments for tags", async () => {
    // The well-formedness scan must skip these regions, or a `<` inside them unbalances the stack.
    const { assertWellFormed } = await import("@/lib/formatters/xml");
    expect(() => assertWellFormed("<r><![CDATA[</unbalanced>]]></r>")).not.toThrow();
    expect(() => assertWellFormed("<r><!-- </unbalanced> --></r>")).not.toThrow();
    expect(() => assertWellFormed("<!DOCTYPE r><r/>")).not.toThrow();
  });

  it("condenses multi-line parser errors to one line", async () => {
    try {
      await format("{invalid json", "json");
      expect.unreachable("should have thrown");
    } catch (cause) {
      expect(cause).toBeInstanceOf(FormatFailedError);
      expect((cause as Error).message).not.toContain("\n");
    }
  });
});
