/**
 * Inline ANSI rendering for the clean REPL client, in the Claude Code CLI style:
 * a minimal `>` input prompt, assistant text flowing directly (no "otto" label),
 * and tool calls as a green bullet `⏺ Tool(args)` with a `⎿` result line.
 *
 * Pure + colorless-testable (strings only); the client writes them to stdout.
 */

import { describeToolCall } from "./tool-describe.js";

const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

/** The input prompt — Claude-Code-style chevron. */
export function inputPrompt(): string {
  return `${BOLD}❯${RESET} `;
}

/**
 * A full-width separator line with a right-aligned label, like the top border
 * of the Claude Code input box: "──────────────── proj-otto ─".
 */
export function borderLine(label: string, width: number): string {
  const tail = label ? ` ${label} ─` : "";
  const fill = Math.max(0, width - tail.length);
  return `${DIM}${"─".repeat(fill)}${tail}${RESET}`;
}

/** The dim status line shown under the input, like Claude Code's footer. */
export function statusLine(parts: string[]): string {
  return `${DIM}  ${parts.filter(Boolean).join(" · ")}${RESET}`;
}

/** A tool call: "⏺ Edit src/foo.ts" (green bullet). */
export function formatToolLine(toolName: string, input: unknown): string {
  return `${GREEN}⏺${RESET} ${describeToolCall(toolName, input)}`;
}

/** A one-line, dimmed result under a tool call: "  ⎿  <first line>". */
export function formatToolResult(output: string): string {
  const firstLine = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return "";
  }
  const trimmed = firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine;
  return `${DIM}  ⎿  ${trimmed}${RESET}`;
}
