import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Syntax colours for the editor, expressed as CSS variables.
 *
 * CodeMirror's bundled `defaultHighlightStyle` hard-codes colours chosen for a light background, so on
 * a dark one keywords and strings drop to unreadable contrast. Routing every colour through a variable
 * means the palette in globals.css decides, and toggling the theme recolours the editor with no
 * extension reconfiguration and no editor remount.
 *
 * The token set below mirrors the one the viewer's Shiki theme covers, so the same code does not look
 * meaningfully different before and after sharing it.
 */
export const editorSyntaxHighlighting = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--cm-keyword)" },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: "var(--cm-keyword)" },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: "var(--cm-name)" },
  { tag: [tags.propertyName], color: "var(--cm-property)" },
  { tag: [tags.variableName, tags.labelName], color: "var(--cm-name)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--cm-function)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--cm-type)" },
  { tag: [tags.tagName], color: "var(--cm-tag)" },
  { tag: [tags.attributeName], color: "var(--cm-attribute)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--cm-number)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--cm-string)" },
  { tag: [tags.escape], color: "var(--cm-escape)" },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: "var(--cm-punctuation)" },
  { tag: [tags.meta, tags.processingInstruction, tags.documentMeta], color: "var(--cm-comment)" },
  { tag: tags.invalid, color: "var(--destructive)" },
  { tag: tags.link, color: "var(--cm-link)", textDecoration: "underline" },
  { tag: tags.heading, color: "var(--cm-keyword)", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.inserted, color: "var(--cm-inserted)" },
  { tag: tags.changed, color: "var(--cm-changed)" },
]);
