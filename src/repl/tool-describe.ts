/**
 * Human-readable one-line description of a tool call, for the inline REPL client.
 *
 * The opentui TUI renders tool calls as full-screen boxes; the clean REPL shows
 * a single legible line ("Edit src/foo.ts", "Bash bun test") inline in normal
 * scrollback. Pure + colorless so it is trivially testable; the REPL applies ANSI.
 */

const MAX_ARG_LEN = 80;

/** Per-tool: which input field carries the most useful one-line argument. */
const ARG_FIELD_BY_TOOL: Record<string, string> = {
  Edit: "file_path",
  Write: "file_path",
  Read: "file_path",
  NotebookEdit: "notebook_path",
  Bash: "command",
  Grep: "pattern",
  Glob: "pattern",
  WebFetch: "url",
  WebSearch: "query",
};

function truncate(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_ARG_LEN) {
    return oneLine;
  }
  return `${oneLine.slice(0, MAX_ARG_LEN - 1)}…`;
}

export function describeToolCall(toolName: string, input: unknown): string {
  const field = ARG_FIELD_BY_TOOL[toolName];
  if (field && input && typeof input === "object") {
    const raw = (input as Record<string, unknown>)[field];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return `${toolName} ${truncate(raw)}`;
    }
  }
  return toolName;
}
