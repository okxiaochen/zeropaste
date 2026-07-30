"use client";

import { useMemo } from "react";

import { hiddenLines, type FoldRanges } from "@/lib/highlight/folding";
import type { Token } from "@/lib/highlight/shiki";

/**
 * The rendered paste: a gutter with line numbers and fold arrows, plus the highlighted code.
 *
 * Presentational only — fold state is owned by the parent, which also owns the control cluster, so
 * "collapse all" and the per-line arrows cannot disagree about what is folded.
 *
 * Line numbers are drawn by a CSS counter and the fold arrow is an SVG. Both choices exist so that
 * selecting the page and copying yields the code alone: `user-select: none` over real text is
 * respected inconsistently across browsers for clipboard purposes, whereas generated content and SVG
 * are never part of a text selection anywhere.
 */
export function CodeBlock({
  lines,
  ranges,
  collapsed,
  onToggle,
}: {
  lines: Token[][];
  ranges: FoldRanges;
  collapsed: ReadonlySet<number>;
  onToggle: (lineIndex: number) => void;
}) {
  const hidden = useMemo(
    () => hiddenLines(lines.length, collapsed, ranges),
    [lines.length, collapsed, ranges],
  );

  return (
    <pre className="zeropaste-code">
      <code>
        {lines.map((tokens, index) => {
          if (hidden[index]) return null;

          const end = ranges.get(index);
          const isCollapsed = collapsed.has(index);
          const hiddenCount = end === undefined ? 0 : end - index;

          return (
            // counter-reset per row, from the line index: numbering must stay correct even though
            // folded rows are removed from the DOM rather than merely hidden.
            <span key={index} className="zp-row" style={{ counterReset: `zp-line ${index}` }}>
              {/*
               * Not aria-hidden: the fold button lives here, and hiding the subtree would leave it
               * keyboard-focusable but unannounced — worse than either alternative. Only the line
               * number itself is hidden from assistive technology.
               */}
              <span className="zp-gutter">
                {end !== undefined && (
                  <button
                    type="button"
                    className="zp-fold"
                    onClick={() => onToggle(index)}
                    aria-label={isCollapsed ? "Expand block" : "Collapse block"}
                    aria-expanded={!isCollapsed}
                  >
                    <Chevron open={!isCollapsed} />
                  </button>
                )}
                <span className="zp-linenumber" aria-hidden />
              </span>

              <span className="zp-code">
                {tokens.map((token, tokenIndex) => (
                  <span key={tokenIndex} style={token.style}>
                    {token.content}
                  </span>
                ))}
                {isCollapsed && (
                  // The label is drawn from a data attribute by CSS, so it never lands in a manual
                  // text selection of a partly folded document.
                  <button
                    type="button"
                    className="zp-collapsed-hint"
                    onClick={() => onToggle(index)}
                    aria-label={`Expand ${hiddenCount} hidden line${hiddenCount === 1 ? "" : "s"}`}
                    data-hidden-count={`⋯ ${hiddenCount} line${hiddenCount === 1 ? "" : "s"}`}
                  />
                )}
              </span>
            </span>
          );
        })}
      </code>
    </pre>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={open ? "zp-chevron zp-chevron-open" : "zp-chevron"}
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
