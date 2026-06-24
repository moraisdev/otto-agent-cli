/**
 * Pure display formatters for tool steps, shared by the step-tree renderer.
 * (Originally lived inline in the now-removed ToolBlock component.)
 */

/** Short one-line summary for a collapsed tool step. */
export function formatToolSummary(toolName: string, input: unknown): string {
  if (!input) return "";
  const obj = input as Record<string, unknown>;
  if (toolName === "Bash" && typeof obj.command === "string") {
    const cmd = obj.command.replace(/\s+/g, " ").trim();
    return cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd;
  }
  for (const key of ["file_path", "pattern", "path", "url"]) {
    if (typeof obj[key] === "string") return obj[key] as string;
  }
  return "";
}

/** Full input line for an expanded tool step. */
export function formatToolInput(toolName: string, input: unknown): string {
  if (!input) return "";
  if (typeof input === "string") return input;
  const obj = input as Record<string, unknown>;
  if (toolName === "Bash" && typeof obj.command === "string") return `$ ${obj.command}`;
  for (const key of ["file_path", "path"]) {
    if (typeof obj[key] === "string") return `file: ${obj[key]}`;
  }
  for (const key of ["pattern", "url"]) {
    if (typeof obj[key] === "string") return `${key}: ${obj[key]}`;
  }
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 117)}...` : json;
}

/** Truncated output block for an expanded tool step. */
export function formatToolOutput(output: unknown): string {
  if (!output) return "";
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text;
}
