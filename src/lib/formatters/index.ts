import { findLanguage } from "../languages";

/**
 * Formatting runs entirely in the browser.
 *
 * This is forced by the architecture rather than chosen: the server never holds plaintext, so it
 * cannot format anything. Every formatter here is therefore a browser-capable one, and each is
 * imported dynamically so a user who never presses Format never downloads any of them.
 */

export class FormatterUnavailableError extends Error {
  constructor(languageLabel: string) {
    super(`No formatter is available for ${languageLabel}.`);
    this.name = "FormatterUnavailableError";
  }
}

export class FormatFailedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "FormatFailedError";
  }
}

export function canFormat(languageId: string): boolean {
  return findLanguage(languageId)?.formatter != null;
}

export async function format(source: string, languageId: string): Promise<string> {
  const language = findLanguage(languageId);
  if (!language || language.formatter === null) {
    throw new FormatterUnavailableError(language?.label ?? languageId);
  }

  try {
    switch (language.formatter) {
      case "prettier": {
        const { formatWithPrettier } = await import("./prettier");
        return await formatWithPrettier(source, language);
      }
      case "sql": {
        const { formatSql } = await import("./sql");
        return formatSql(source);
      }
      case "xml": {
        const { formatXml } = await import("./xml");
        return formatXml(source);
      }
    }
  } catch (cause) {
    if (cause instanceof FormatterUnavailableError) throw cause;
    // Every formatter here rejects on a syntax error. That is useful information, so it is surfaced
    // rather than swallowed, but it must never lose the user's text — callers keep the original.
    throw new FormatFailedError(
      cause instanceof Error ? firstLine(cause.message) : "Could not format this text.",
    );
  }
}

/** Parser errors are often many lines of caret diagrams; the first line is the useful part. */
function firstLine(message: string): string {
  return message.split("\n")[0]?.trim() || "Could not format this text.";
}
