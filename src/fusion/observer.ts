/**
 * Continuous-review observer wiring.
 *
 * Registers an idempotent Observation-Plane rule so the peer companion watches
 * the lead agent's sessions and reviews each completed turn — the "the peer
 * follows what the principal is doing" requirement. The companion receives a
 * rendered summary of the lead's turn and can proactively `otto sessions inform`
 * the lead with findings (see the companion brief).
 *
 * Best-effort: if the observation plane rejects the rule, fusion still works via
 * the playbook (Claude consults Codex; Codex is briefed to be proactive).
 */

import { getDb } from "../router/router-db.js";
import { dbGetObserverRule, dbSetObserverRuleEnabled, dbUpsertObserverRule } from "../runtime/observation-plane.js";
import { logger } from "../utils/logger.js";

const log = logger.child("fusion:observer");

/** Turn-level events the peer reviewer sees (one review per lead turn). */
const REVIEW_EVENT_TYPES = ["message.assistant", "turn.complete"];

/**
 * Debounce window for reviews. Delivery is rate-limited rather than fired on
 * every turn so a Codex review -> inform -> Claude reacts -> review cycle can't
 * tight-loop (each round is capped to one review per window).
 */
const REVIEW_DEBOUNCE_MS = 45_000;

export function fusionObserverRuleId(leadAgentId: string): string {
  return `fusion-obs-${leadAgentId}`;
}

/**
 * Ensure the peer companion observes the lead agent's sessions. Idempotent and
 * best-effort. Returns the rule id when registered, else null.
 */
export function ensureFusionObserverRule(input: {
  leadAgentId: string;
  companionAgentId: string;
  peerProvider: string;
}): string | null {
  const id = fusionObserverRuleId(input.leadAgentId);
  try {
    dbUpsertObserverRule({
      id,
      enabled: true,
      scope: "agent",
      sourceAgentId: input.leadAgentId,
      observerAgentId: input.companionAgentId,
      observerRuntimeProviderId: input.peerProvider,
      observerRole: "fusion-reviewer",
      observerMode: "report",
      deliveryPolicy: "debounce",
      debounceMs: REVIEW_DEBOUNCE_MS,
      eventTypes: REVIEW_EVENT_TYPES,
      metadata: { source: "fusion", leadAgentId: input.leadAgentId },
    });
    setFusionBindingsEnabled(id, true);
    return id;
  } catch (err) {
    log.warn("Failed to register fusion observer rule (continuing without continuous review)", {
      leadAgentId: input.leadAgentId,
      error: err,
    });
    return null;
  }
}

/**
 * Enable/disable the continuous reviewer (e.g., pause when Codex is exhausted or
 * during failover). Toggling the rule alone is not enough: delivery is gated on
 * the *binding* flag, and bindings are created per-session at launch — so we must
 * also flip the existing bindings, or already-bound sessions keep getting reviews.
 */
export function setFusionObserverEnabled(leadAgentId: string, enabled: boolean): void {
  const id = fusionObserverRuleId(leadAgentId);
  try {
    if (!dbGetObserverRule(id)) return;
    dbSetObserverRuleEnabled(id, enabled);
    setFusionBindingsEnabled(id, enabled);
  } catch (err) {
    log.warn("Failed to toggle fusion observer rule", { leadAgentId, enabled, error: err });
  }
}

/** Flip the enabled flag on all bindings instantiated from a fusion rule. */
function setFusionBindingsEnabled(ruleId: string, enabled: boolean): void {
  try {
    getDb()
      .prepare("UPDATE observer_bindings SET enabled = ?, updated_at = ? WHERE rule_id = ?")
      .run(enabled ? 1 : 0, Date.now(), ruleId);
  } catch (err) {
    log.warn("Failed to toggle fusion observer bindings", { ruleId, enabled, error: err });
  }
}
