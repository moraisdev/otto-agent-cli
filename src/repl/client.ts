/**
 * The clean inline REPL client (`otto code`).
 *
 * A thin window over the daemon-owned session: it reads a line, publishes it to
 * the session's prompt work-queue, and renders the session's output events
 * inline (Claude-Code-style) — NOT the full-screen opentui TUI. It is purely a
 * client: all execution (Claude/Codex CLIs) runs in the daemon.
 *
 * Rendering/classification logic lives in ./events + ./render (unit-tested);
 * this file is the I/O loop.
 */

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { closeNats, connectNats } from "../nats.js";
import { subscribe } from "../nats.js";
import { configStore } from "../config-store.js";
import { ensureFusionForTurn, leadAgentIdForSession, type FusionTurnPlan } from "../fusion/activate.js";
import { otherProvider } from "../fusion/state.js";
import { publishSessionPrompt } from "../omni/session-stream.js";
import { logger } from "../utils/logger.js";
import { classifySessionEvent, type SessionEventTopic } from "./events.js";
import { borderLine, formatToolLine, formatToolResult, inputPrompt, statusLine } from "./render.js";
import { cliSource } from "./source.js";

const log = logger.child("repl");

export interface ReplClientOptions {
  sessionName: string;
  /** Working directory the session is rooted in (informational; binding is set by the launcher). */
  cwd?: string;
}

export async function runReplClient(options: ReplClientOptions): Promise<void> {
  const { sessionName } = options;
  const base = `otto.session.${sessionName}`;

  await connectNats();

  let streaming = false;
  let stopped = false;
  const turn: { resolve: (() => void) | null } = { resolve: null };

  // Background: render the session's output stream inline.
  const renderLoop = (async () => {
    for await (const { topic, data } of subscribe(
      `${base}.stream`,
      `${base}.response`,
      `${base}.tool`,
      `${base}.runtime`,
      `${base}.claude`,
    )) {
      if (stopped) break;
      const suffix = topic.slice(base.length + 1) as SessionEventTopic;
      const event = classifySessionEvent(suffix, data);
      switch (event.kind) {
        case "stream":
          if (!streaming) {
            stdout.write("\n");
            streaming = true;
          }
          stdout.write(event.text);
          break;
        case "tool-start":
          stdout.write(`\n${formatToolLine(event.toolName, event.input)}\n`);
          streaming = false;
          break;
        case "tool-end": {
          const line = formatToolResult(typeof event.output === "string" ? event.output : "");
          if (line) stdout.write(`${line}\n`);
          break;
        }
        case "response":
          if (!streaming && event.text) {
            stdout.write(`\n${event.text}`);
          }
          stdout.write("\n");
          streaming = false;
          turn.resolve?.();
          break;
        default:
          break;
      }
    }
  })().catch((err) => log.warn("REPL render loop ended", { error: err }));

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const width = () => stdout.columns ?? 80;
  stdout.write(`\n${statusLine([`otto code`, `session ${sessionName}`, "fusion: claude+codex", "/exit to quit"])}\n`);

  try {
    while (true) {
      // Claude-Code-style input box: header border with a right-aligned session
      // label, the chevron prompt, then a dim footer under it. The reply streams
      // below the box; the next turn's header border separates the turns.
      stdout.write(`\n${borderLine(sessionName, width())}\n`);
      const line = (await rl.question(inputPrompt())).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;

      const turnDone = new Promise<void>((resolve) => {
        turn.resolve = resolve;
      });
      // Fusion is always on: every turn pairs Claude (editor) with the Codex
      // peer, with automatic failover when a provider hits its CLI quota.
      const config = configStore.getConfig();
      const leadAgentId = leadAgentIdForSession(sessionName, config.defaultAgent);
      const leadAgent = config.agents[leadAgentId];
      const fusion = await ensureFusionForTurn({
        leadAgent: { id: leadAgentId, cwd: options.cwd ?? process.cwd(), provider: leadAgent?.provider },
        leadSessionName: sessionName,
      });
      const promptText = fusion.playbookPrefix ? `${fusion.playbookPrefix}\n\n${line}` : line;
      await publishSessionPrompt(sessionName, {
        prompt: promptText,
        _displayText: line,
        source: cliSource(sessionName),
        ...(options.cwd ? { _projectCwd: options.cwd } : {}),
        ...(fusion.runtimeProviderId
          ? {
              _runtimeProviderId: fusion.runtimeProviderId,
              _fusion: { editor: fusion.editor ?? fusion.runtimeProviderId },
              ...(fusion.runtimeModel ? { _runtimeModel: fusion.runtimeModel } : {}),
            }
          : {}),
      });
      // Footer under the input, like Claude Code's bottom status bar.
      stdout.write(`${statusLine([options.cwd ? `cwd ${options.cwd}` : "", fusionStatusLabel(fusion)])}\n`);
      await turnDone;
    }
  } finally {
    stopped = true;
    rl.close();
    await renderLoop.catch(() => {});
    await closeNats();
  }
}

function providerName(p: "claude" | "codex"): string {
  return p === "codex" ? "Codex" : "Claude";
}

/** Short footer label describing the current fusion state for the REPL (symmetric). */
function fusionStatusLabel(plan: FusionTurnPlan): string {
  if (!plan.fused) return "";
  const editor = plan.editor;
  if (!editor) return "⚡ fusion on";
  switch (plan.mode) {
    case "failover":
      // editor = the peer that took over; the principal is the exhausted one.
      return `⚠ ${providerName(otherProvider(editor))} at quota — ${providerName(editor)} editing`;
    case "solo":
      // editor = the principal working alone; its peer is at quota.
      return `⚠ ${providerName(otherProvider(editor))} at quota — ${providerName(editor)} solo`;
    default:
      return `⚡ fusion on (${providerName(editor)}+${providerName(otherProvider(editor))})`;
  }
}
