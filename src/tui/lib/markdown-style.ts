/**
 * Shared SyntaxStyle for the opentui <markdown> element.
 *
 * Without an explicit syntaxStyle, opentui's markdown falls back to a default
 * that throws `syntaxStyle.getStyle is undefined` during highlight/conceal and
 * renders the RAW source (literal `**bold**`, list markers, etc.). Passing a
 * real SyntaxStyle fixes concealment and gives the markup actual styling.
 * (Verified headlessly: with this style `**` is concealed and bold applied.)
 */

import { SyntaxStyle } from "@opentui/core";
import { THEME } from "./theme.js";

export const MARKDOWN_SYNTAX_STYLE = SyntaxStyle.fromStyles({
  default: { fg: THEME.text },
  "markup.heading": { fg: THEME.text, bold: true },
  // opentui's inline renderer emits bold as `markup.strong` (NOT `markup.bold`).
  "markup.strong": { bold: true },
  "markup.italic": { italic: true },
  "markup.strikethrough": { fg: THEME.faint },
  "markup.raw": { fg: THEME.codex },
  "markup.raw.block": { fg: THEME.codex },
  "markup.link.label": { fg: THEME.codex, underline: true },
  "markup.link.url": { fg: THEME.dim, underline: true },
  "markup.list": { fg: THEME.dim },
  "markup.quote": { fg: THEME.dim, italic: true },
  "punctuation.delimiter": { fg: THEME.faint },
});
