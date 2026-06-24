/**
 * Tool Safety Hook
 *
 * Classifies tool calls as "safe" (interruptible) or "unsafe" (has side effects).
 * Used by the abort logic to decide whether to wait for a tool to finish.
 *
 * Safe tools: read-only, no side effects — can be interrupted without harm.
 * Unsafe tools: may have side effects (write files, run commands, send messages)
 *   — must complete before the session can be safely aborted.
 */

import { logger } from "../utils/logger.js";

const log = logger.child("hooks:tool-safety");

/**
 * Tools classified as safe to interrupt (read-only, no side effects).
 * Everything NOT in this set is considered unsafe by default.
 */
const SAFE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "TodoRead",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "mcp__spec__enter_spec_mode",
  "mcp__spec__update_spec",
  "mcp__spec__exit_spec_mode",
]);

export type ToolSafety = "safe" | "unsafe";

/**
 * Check if a Bash command is a sleep (always safe to interrupt).
 */
function isBashSleep(command: string): boolean {
  return /^\s*sleep\s+/.test(command.trim());
}

/**
 * Check if a Bash command is a blocking cross-session consult
 * (`otto sessions send ... -w/--wait`, e.g. the fusion peer consult). From the
 * caller's side this only WAITS for another session's reply — interrupting it has
 * no side effect on the caller, so it must be interruptible. Otherwise a stalled
 * peer would freeze the lead for the whole send timeout with Ctrl+C deferred.
 */
function isBlockingSessionConsult(command: string): boolean {
  return /\botto\s+sessions\s+send\b/.test(command) && /(^|\s)(-w|--wait)(\s|$)/.test(command);
}

/**
 * Classify a tool call as safe or unsafe.
 * For Bash, inspects the command — sleep and blocking session consults are safe.
 */
export function getToolSafety(toolName: string, toolInput?: Record<string, unknown>): ToolSafety {
  if (SAFE_TOOLS.has(toolName)) {
    log.debug("Tool classified", { toolName, safety: "safe" });
    return "safe";
  }

  if (toolName === "Bash" && toolInput?.command) {
    const command = toolInput.command as string;
    if (isBashSleep(command)) {
      log.debug("Bash sleep classified as safe", { command: command.slice(0, 50) });
      return "safe";
    }
    if (isBlockingSessionConsult(command)) {
      log.debug("Bash session-consult classified as safe (interruptible wait)", { command: command.slice(0, 60) });
      return "safe";
    }
  }

  log.debug("Tool classified", { toolName, safety: "unsafe" });
  return "unsafe";
}
