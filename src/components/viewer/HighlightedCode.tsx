"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { CodeBlock } from "@/components/viewer/CodeBlock";
import { computeFoldRanges, topLevelFoldableLines } from "@/lib/highlight/folding";
import { highlight, plainLines, type Token } from "@/lib/highlight/shiki";

/**
 * The paste, and the small set of controls the viewer offers.
 *
 * Everything interactive lives in one cluster that fades out at rest, so opening a link shows the
 * content with nothing competing with it — while still leaving the theme, folding, and copying
 * reachable by pointer or keyboard.
 */
export function HighlightedCode({
  content,
  languageId,
  highlightLimitBytes,
}: {
  content: string;
  languageId: string;
  highlightLimitBytes: number;
}) {
  const sourceLines = useMemo(() => content.split("\n"), [content]);
  const ranges = useMemo(() => computeFoldRanges(sourceLines), [sourceLines]);

  // Start unstyled so the text is readable on first paint, before the grammar has loaded.
  const [lines, setLines] = useState<Token[][]>(() => plainLines(content));
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void highlight(content, languageId, highlightLimitBytes).then((result) => {
      if (!cancelled) setLines(result.lines);
    });

    return () => {
      cancelled = true;
    };
  }, [content, languageId, highlightLimitBytes]);

  const toggle = useCallback((index: number) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  async function copy() {
    // Always the full content, never what is currently visible: a folded block must not silently
    // truncate what the user copies.
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const anyCollapsed = collapsed.size > 0;

  return (
    <main className="group relative min-h-screen">
      <div className="fixed right-4 top-4 z-10 flex items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <ThemeToggle />

        {ranges.size > 0 && (
          <button
            type="button"
            onClick={() =>
              setCollapsed(anyCollapsed ? new Set() : new Set(topLevelFoldableLines(ranges)))
            }
            className="inline-flex items-center rounded-md border bg-card/90 px-2.5 py-1.5 text-xs backdrop-blur transition-colors hover:bg-accent"
          >
            {anyCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}

        <button
          type="button"
          onClick={copy}
          aria-label="Copy to clipboard"
          className="inline-flex items-center gap-1.5 rounded-md border bg-card/90 px-2.5 py-1.5 text-xs backdrop-blur transition-colors hover:bg-accent"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <CodeBlock lines={lines} ranges={ranges} collapsed={collapsed} onToggle={toggle} />
    </main>
  );
}
