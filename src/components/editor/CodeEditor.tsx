"use client";

import { syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";

import { loadEditorLanguage } from "@/lib/editor/codemirror-languages";
import { editorSyntaxHighlighting } from "@/lib/editor/syntax-theme";

/**
 * The editing surface.
 *
 * CodeMirror rather than Monaco: roughly 100KB against 2MB, per-language grammars that load on
 * demand, and it actually works on a phone.
 */

/**
 * Theme overrides so the editor inherits the page's tokens instead of shipping its own palette.
 * Colours come from globals.css, so light and dark follow the OS with no extra work here.
 */
const themeExtension = EditorView.theme({
  "&": {
    fontSize: "13px",
    backgroundColor: "transparent",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    padding: "12px 0",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklab, var(--muted) 60%, transparent)",
  },
  ".cm-foldGutter span": {
    color: "var(--muted-foreground)",
    padding: "0 2px",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    border: "none",
    color: "var(--muted-foreground)",
    borderRadius: "0.25rem",
    padding: "0 4px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    lineHeight: "1.6",
  },
});

export function CodeEditor({
  value,
  onChange,
  languageId,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  languageId: string;
  placeholder?: string;
}) {
  const [languageExtension, setLanguageExtension] = useState<Extension | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Drop the previous grammar immediately so a slow import cannot apply stale highlighting to the
    // newly selected language.
    setLanguageExtension(null);

    void loadEditorLanguage(languageId).then((extension) => {
      if (!cancelled) setLanguageExtension(extension);
    });

    return () => {
      cancelled = true;
    };
  }, [languageId]);

  const extensions = useMemo(() => {
    const base = [themeExtension, syntaxHighlighting(editorSyntaxHighlighting, { fallback: true })];
    return languageExtension ? [...base, languageExtension] : base;
  }, [languageExtension]);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        placeholder={placeholder}
        minHeight="420px"
        maxHeight="70vh"
        basicSetup={{
          lineNumbers: true,
          // Folding uses the loaded Lezer grammar, so blocks are language-aware rather than
          // indentation-guessed the way the viewer has to be.
          foldGutter: true,
          highlightActiveLine: true,
          // Off, so CodeMirror's own light-only palette does not compete with the themed one above.
          syntaxHighlighting: false,
          // Bracket and quote auto-closing gets in the way when pasting existing code, which is the
          // dominant use of this editor.
          closeBrackets: false,
          autocompletion: false,
        }}
      />
    </div>
  );
}
