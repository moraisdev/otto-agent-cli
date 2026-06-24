/**
 * Ensure-or-reuse the read-only peer companion agent for a lead.
 *
 * The companion is a normal Otto agent whose provider is the NON-principal one
 * (Codex when Claude leads, Claude when Codex leads), bound to the lead's working
 * directory, in `sentinel` mode (it never auto-replies in chat; it only answers
 * the lead over sessions). It is granted a read-only tool set; the hard non-edit
 * guarantee comes from REBAC + the brief (and, for Codex, the read-only sandbox).
 */

import { clearRelations, grantRelation } from "../permissions/relations.js";
import { dbCreateAgent, dbDeleteAgent, dbGetAgent, dbUpdateAgent } from "../router/router-db.js";
import { resetSession } from "../router/sessions.js";
import { logger } from "../utils/logger.js";
import { companionAgentId, companionSessionKey, LEGACY_COMPANION_AGENT_PREFIX } from "./companion-id.js";
import { buildCompanionReadOnlyGrants } from "./companion-permissions.js";
import { buildCompanionBrief } from "./playbook.js";
import type { FusionProvider } from "./state.js";

const log = logger.child("fusion:companion");

/** Codex model the fusion peer runs on when Codex is the peer — most advanced Codex. */
export const FUSION_CODEX_MODEL = "gpt-5.5";
/** Claude model the fusion peer runs on when Claude is the peer — most capable Claude. */
export const FUSION_CLAUDE_MODEL = "opus";

/** The model the peer companion should run, given its provider. */
export function peerModelFor(peerProvider: FusionProvider): string {
  return peerProvider === "codex" ? FUSION_CODEX_MODEL : FUSION_CLAUDE_MODEL;
}

export { companionAgentId } from "./companion-id.js";

export function ensurePeerCompanion(
  lead: { id: string; cwd: string },
  peerProvider: FusionProvider,
  principalProvider: FusionProvider,
): { agentId: string } {
  const agentId = companionAgentId(lead.id);
  const model = peerModelFor(peerProvider);
  // The brief is the peer's identity — inject it as the agent's system prompt
  // append so it survives every turn (including context compaction and session
  // restarts). The lead session name is deterministic, so the brief is stable
  // for a given principal/peer pair and stays prompt-cache friendly.
  const brief = buildCompanionBrief({
    leadSessionName: `agent:${lead.id}:main`,
    principal: principalProvider,
    peer: peerProvider,
  });

  // Drop any leftover Codex-only companion from before fusion became symmetric.
  removeLegacyCodexCompanion(lead.id);

  const existing = dbGetAgent(agentId);
  if (!existing) {
    dbCreateAgent({
      id: agentId,
      cwd: lead.cwd,
      provider: peerProvider,
      model,
      name: `${peerProvider} consultant for ${lead.id}`,
      mode: "sentinel",
      systemPromptAppend: brief,
    });
    log.info("Created read-only peer companion", { agentId, cwd: lead.cwd, lead: lead.id, peerProvider });
  } else if (existing.provider !== peerProvider || existing.model !== model || existing.systemPromptAppend !== brief) {
    // Re-point the companion: provider/model drift (principal flipped) or brief
    // drift (playbook text changed across deploys). Updating in one shot keeps
    // the peer's identity in sync with the current fusion configuration.
    dbUpdateAgent(agentId, { provider: peerProvider, model, systemPromptAppend: brief });
    // The system prompt is composed at session start and never re-read mid-run,
    // so a live companion session would keep serving consults under its old
    // brief until the next cold start. Reset it here so the next turn rebuilds
    // the prompt with the new brief.
    if (existing.systemPromptAppend !== brief) {
      resetSession(companionSessionKey(agentId));
    }
    log.info("Re-pointed peer companion to new peer", { agentId, peerProvider });
  }

  for (const grant of buildCompanionReadOnlyGrants(peerProvider)) {
    grantRelation("agent", agentId, grant.relation, grant.objectType, grant.objectId, "fusion");
  }

  // Let the companion read the lead's work and proactively `otto sessions inform`
  // it — without this REBAC grant the peer is blind to the lead and can't speak.
  for (const sessionObj of [`agent:${lead.id}:main`, `agent:${lead.id}:*`]) {
    grantRelation("agent", agentId, "access", "session", sessionObj, "fusion");
  }

  return { agentId };
}

/**
 * Remove a legacy `codex-companion-<lead>` agent left over from before fusion
 * became symmetric. Best-effort: drop the agent row and its fusion-sourced REBAC
 * grants so no dead companion lingers in the router db.
 */
function removeLegacyCodexCompanion(leadId: string): void {
  const legacyId = `${LEGACY_COMPANION_AGENT_PREFIX}${leadId}`;
  try {
    if (!dbGetAgent(legacyId)) return;
    clearRelations({ subjectType: "agent", subjectId: legacyId });
    dbDeleteAgent(legacyId);
    log.info("Removed legacy codex-companion agent", { legacyId });
  } catch (err) {
    log.warn("Failed to remove legacy codex companion", { legacyId, error: err });
  }
}
