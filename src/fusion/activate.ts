/**
 * Fusion activation — the single always-on entry point that pairs Claude
 * (sole editor) with the read-only Codex peer on every eligible turn, with
 * automatic failover when a provider hits its CLI quota.
 *
 * Shared by all entry points (omni consumer, REPL, TUI) so behavior is identical
 * everywhere. Any failure degrades gracefully to a plain solo turn.
 */

import type { RuntimeProviderId } from "../runtime/types.js";
import { logger } from "../utils/logger.js";
import { ensurePeerCompanion, peerModelFor } from "./companion.js";
import {
  buildBothExhaustedNotice,
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
    // under the peer provider as the sole editor. No companion (principal idle).
    if (state.editor === peer) {
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
      return {
        fused: true,
        mode: "solo",
        editor: principal,
        playbookPrefix: principalExhausted ? buildBothExhaustedNotice() : buildSoloNotice({ peer }),
      };
    }

    // Normal: the principal edits, the peer is the read-only reviewer. The review
    // runs as a SYNCHRONOUS gate at the end of each turn (see runtime/fusion-gate),
    // so there is no async observer to wire up here — only the companion session.
    // Stable per-agent collaboration id (NOT a per-turn UUID) so the playbook
    // prefix stays identical across turns and the prompt cache keeps hitting.
    const collaborationId = `fusion-${input.leadAgent.id}`;
    ensurePeerCompanion(input.leadAgent, peer, principal);
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
