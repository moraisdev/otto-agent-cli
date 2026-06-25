/**
 * Fusion consult-nudge hook.
 *
 * Counts code-editing tool calls per session and, after the lead does
 * `NUDGE_THRESHOLD` consecutive edits without consulting the peer companion,
 * publishes a one-shot `[System] Inform` reminder back to the lead. The nudge is
 * delivered with the `after_tool` barrier so it lands in the *current* turn —
 * before the lead can keep editing — instead of as a post-mortem nag after the
 * whole turn already finished.
 *
 * The counter resets to zero whenever the lead actually consults the peer
 * (matched by `otto sessions send agent:peer-companion-...`), with or without
 * `-w`. A nudge fires at most once per threshold crossing; it cannot retrigger
 * until the lead consults again.
 *
 * The hook itself is registered globally for fusion-eligible sessions and only
 * acts when fusion is genuinely active for the lead agent:
 *   - the session is fusion-eligible (`shouldFuseSession`),
 *   - fusion is not turned off for the agent (`!isFusionDisabled`),
 *   - the peer companion exists in the router db.
 * Publishing the nudge is fire-and-forget so a NATS hiccup never delays a tool
 * call.
 */

import { companionAgentId } from "../fusion/companion-id.js";
import { shouldFuseSession } from "../fusion/policy.js";
import { isFusionDisabled } from "../fusion/state.js";
import { publishSessionPrompt } from "../omni/session-stream.js";
import { dbGetAgent } from "../router/router-db.js";
import type { RuntimeHookMatcher } from "../runtime/types.js";
import { logger } from "../utils/logger.js";

const log = logger.child("hooks:fusion-consult-nudge");

/** Tools that count as a "code edit" for the purposes of the nudge counter. */
const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

/** Number of unbroken edits the lead is allowed before the nudge fires. */
export const NUDGE_THRESHOLD = 3;

interface SessionNudgeState {
  editsSinceLastConsult: number;
  nudgeFired: boolean;
}

const stateBySession = new Map<string, SessionNudgeState>();

function getOrCreateState(sessionName: string): SessionNudgeState {
  let state = stateBySession.get(sessionName);
  if (!state) {
    state = { editsSinceLastConsult: 0, nudgeFired: false };
    stateBySession.set(sessionName, state);
  }
  return state;
}

/** Test seam: drop the in-memory counter so tests start from a clean slate. */
export function resetFusionNudgeState(sessionName?: string): void {
  if (sessionName) {
    stateBySession.delete(sessionName);
  } else {
    stateBySession.clear();
  }
}

/**
 * Detect a peer-companion consult in a Bash command (-w or fire-and-forget).
 * Matches both `agent:peer-companion-main:main` style keys and the bare
 * `peer-companion-*` prefix anywhere in the command.
 */
function isConsultBashCommand(command: string): boolean {
  return /\botto\s+sessions\s+(?:send|inform|ask|execute)\s+["']?(?:agent:)?peer-companion-/.test(command);
}

function buildNudgeMessage(agentId: string, count: number): string {
  return [
    `You have edited ${count} files in a row without consulting the peer.`,
    `Pause and consult before the next edit — the peer can see things you missed.`,
    `Example: otto sessions send agent:peer-companion-${agentId}:main "<lean question>" -w --timeout 90`,
  ].join(" ");
}

function isFusionActiveForAgent(agentId: string, sessionName: string): boolean {
  if (!shouldFuseSession({ sessionName, agentId })) return false;
  if (isFusionDisabled(agentId)) return false;
  // The companion row is what proves fusion was actually set up for this lead;
  // its absence means the lead never went through `ensurePeerCompanion`.
  return Boolean(dbGetAgent(companionAgentId(agentId)));
}

export function createFusionConsultNudgeHook(input: { agentId: string; sessionName: string }): RuntimeHookMatcher {
  return {
    hooks: [
      async (hookInput: Record<string, unknown>) => {
        if (!isFusionActiveForAgent(input.agentId, input.sessionName)) return {};

        const toolName = hookInput.tool_name as string | undefined;
        const toolInput = hookInput.tool_input as Record<string, unknown> | undefined;
        const command = toolInput?.command;
        const state = getOrCreateState(input.sessionName);

        if (toolName === "Bash" && typeof command === "string" && isConsultBashCommand(command)) {
          if (state.editsSinceLastConsult > 0 || state.nudgeFired) {
            log.debug("Consult detected — resetting nudge counter", {
              sessionName: input.sessionName,
              previousEdits: state.editsSinceLastConsult,
            });
          }
          state.editsSinceLastConsult = 0;
          state.nudgeFired = false;
          return {};
        }

        if (toolName && EDIT_TOOLS.has(toolName)) {
          state.editsSinceLastConsult += 1;
        }

        if (state.editsSinceLastConsult >= NUDGE_THRESHOLD && !state.nudgeFired) {
          state.nudgeFired = true;
          const message = buildNudgeMessage(input.agentId, state.editsSinceLastConsult);
          publishSessionPrompt(input.sessionName, {
            prompt: `[System] Inform: ${message}`,
            deliveryBarrier: "after_tool",
          }).catch((error) => {
            log.warn("Failed to publish fusion nudge", { sessionName: input.sessionName, error });
          });
          log.info("Fusion nudge published", {
            sessionName: input.sessionName,
            agentId: input.agentId,
            editsCount: state.editsSinceLastConsult,
          });
        }

        return {};
      },
    ],
  };
}
