/**
 * Fusion activation — the single always-on entry point that pairs Claude
 * (sole editor) with the read-only Codex peer on every eligible turn, with
 * automatic failover when a provider hits its CLI quota.
 *
 * Shared by all entry points (omni consumer, REPL, TUI) so behavior is identical
 * everywhere. Any failure degrades gracefully to a plain solo turn.
 */

import { publishSessionPrompt } from "../omni/session-stream.js";
import { dbGetAgent } from "../router/router-db.js";
import type { RuntimeProviderId } from "../runtime/types.js";
import { logger } from "../utils/logger.js";
import { companionAgentId, companionSessionKey } from "./companion-id.js";
import { ensurePeerCompanion, peerModelFor } from "./companion.js";
import {
  buildBothExhaustedNotice,
  buildCompanionBrief,
  buildFusionLeadPlaybook,
  buildPeerEditorPlaybook,
  buildSoloNotice,
} from "./playbook.js";
import { shouldFuseSession } from "./policy.js";
import {
  type FusionEditor,
  type FusionProvider,
  getEffectiveFusionState,
  isFusionDisabled,
  otherProvider,
} from "./state.js";

const log = logger.child("fusion:activate");

export type FusionMode = "normal" | "solo" | "failover";

export interface FusionTurnPlan {
  /** False ⇒ session not eligible; caller behaves exactly as before fusion. */
  fused: boolean;
  mode?: FusionMode;
  editor?: FusionEditor;
  /** Instruction prefix to prepend to the user's prompt. */
  playbookPrefix?: string;
  /** Runtime provider override for this turn (`codex` on Claude-exhausted failover). */
  runtimeProviderId?: RuntimeProviderId;
  /** Runtime model override paired with the provider override (Codex 5.5 on failover). */
  runtimeModel?: string;
}

export interface EnsureFusionInput {
  leadAgent: { id: string; cwd: string; provider?: string | null };
  leadSessionName: string;
  mintId?: () => string;
  now?: number;
}

/**
 * Resolve the lead agent id a client should key fusion to, matching how the
 * daemon resolves the session's owning agent (`agent:<id>:...`). Clients must
 * use this so fusion state/companion key to the SAME agent the runtime records
 * failover against — otherwise an `otto code agent:<x>:...` session would read a
 * different row than the daemon writes.
 */
export function leadAgentIdForSession(sessionName: string, defaultAgentId: string): string {
  if (sessionName.startsWith("agent:")) {
    const id = sessionName.split(":")[1];
    if (id) return id;
  }
  return defaultAgentId;
}

/** Normalize the lead agent's provider to the principal (defaults to Claude). */
function normalizePrincipal(provider?: string | null): FusionProvider {
  return (provider ?? "").toLowerCase() === "codex" ? "codex" : "claude";
}

export async function ensureFusionForTurn(input: EnsureFusionInput): Promise<FusionTurnPlan> {
  if (!shouldFuseSession({ sessionName: input.leadSessionName, agentId: input.leadAgent.id })) {
    return { fused: false };
  }

  // Per-agent toggle: the user can turn fusion off (`/fusion` or `otto fusion off`).
  if (isFusionDisabled(input.leadAgent.id)) {
    return { fused: false };
  }

  const principal = normalizePrincipal(input.leadAgent.provider);
  const peer = otherProvider(principal);

  try {
    const state = getEffectiveFusionState(input.leadAgent.id, principal, input.now);
    const principalExhausted = principal === "claude" ? state.claudeExhausted : state.codexExhausted;
    const peerExhausted = peer === "claude" ? state.claudeExhausted : state.codexExhausted;

    // Failover: the principal is exhausted but the peer can edit — run this session
    // under the peer provider as the sole editor. No companion/observer (principal idle).
    if (state.editor === peer) {
      await trySetObserverEnabled(input.leadAgent.id, false);
      return {
        fused: true,
        mode: "failover",
        editor: peer,
        runtimeProviderId: peer,
        runtimeModel: peerModelFor(peer),
        playbookPrefix: buildPeerEditorPlaybook({ leadAgentId: input.leadAgent.id, principal, peer }),
      };
    }

    // Degraded solo: the peer is exhausted — the principal works alone this turn
    // (incl. the both-exhausted case: nothing left to fail over to).
    if (peerExhausted) {
      await trySetObserverEnabled(input.leadAgent.id, false);
      return {
        fused: true,
        mode: "solo",
        editor: principal,
        playbookPrefix: principalExhausted ? buildBothExhaustedNotice() : buildSoloNotice({ peer }),
      };
    }

    // Normal: the principal edits, the peer is the always-on read-only reviewer.
    // Stable per-agent collaboration id (NOT a per-turn UUID) so the playbook
    // prefix stays identical across turns and the prompt cache keeps hitting.
    const collaborationId = input.mintId ? input.mintId() : `fusion-${input.leadAgent.id}`;
    ensureFusionCompanion(input.leadAgent, principal, peer);
    await tryEnsureObserverRule(input.leadAgent.id, companionAgentId(input.leadAgent.id), peer);
    return {
      fused: true,
      mode: "normal",
      editor: principal,
      playbookPrefix: buildFusionLeadPlaybook({ leadAgentId: input.leadAgent.id, collaborationId, principal, peer }),
    };
  } catch (err) {
    // Never break a turn because fusion setup failed — fall back to solo.
    log.warn("Fusion activation failed; falling back to solo turn", { session: input.leadSessionName, error: err });
    return { fused: false };
  }
}

/**
 * Ensure the peer companion exists (running the non-principal provider) and warm
 * it with its consultant brief — on first creation AND whenever the principal
 * flips, so the brief always frames the current lead/peer roles.
 */
function ensureFusionCompanion(
  lead: { id: string; cwd: string },
  principal: FusionProvider,
  peer: FusionProvider,
): void {
  const compId = companionAgentId(lead.id);
  const existing = dbGetAgent(compId);
  const needsWarm = !existing || existing.provider !== peer;
  ensurePeerCompanion(lead, peer);

  if (needsWarm) {
    publishSessionPrompt(companionSessionKey(compId), {
      prompt: buildCompanionBrief({ leadSessionName: `agent:${lead.id}:main`, principal, peer }),
      _agentId: compId,
    }).catch((err) => log.warn("Failed to warm companion brief", { compId, error: err }));
  }
}

/**
 * The continuous-reviewer wiring lives behind a lazy import so the heavy
 * Observation-Plane module isn't pulled into every entry point's static import
 * graph (faster startup; simpler test mocking). Both helpers are best-effort.
 */
async function tryEnsureObserverRule(leadAgentId: string, companionId: string, peerProvider: string): Promise<void> {
  try {
    const mod = await import("./observer.js");
    mod.ensureFusionObserverRule({ leadAgentId, companionAgentId: companionId, peerProvider });
  } catch (err) {
    log.warn("Continuous-review observer setup skipped", { leadAgentId, error: err });
  }
}

async function trySetObserverEnabled(leadAgentId: string, enabled: boolean): Promise<void> {
  try {
    const mod = await import("./observer.js");
    mod.setFusionObserverEnabled(leadAgentId, enabled);
  } catch {
    // best-effort; observer is an enhancement, never required for a turn
  }
}
