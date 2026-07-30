import { format } from "sql-formatter";

/**
 * SQL formatting.
 *
 * The dialect is left at the default rather than exposed as another control. Guessing wrong on a
 * dialect mangles nothing — sql-formatter only reflows whitespace and casing — and the paste's own
 * language selector is already the granularity users care about.
 */
export function formatSql(source: string): string {
  return format(source, {
    keywordCase: "upper",
    tabWidth: 2,
  });
}
