/**
 * Fusion eligibility policy.
 *
 * Fusion (always-on principal editor + read-only peer reviewer) applies to
 * interactive sessions whose lead is either Claude or Codex (symmetric — whoever
 * is the configured principal leads). It must NOT apply to:
 *  - the peer companion's own session (would recursively spawn a companion),
 *  - observer-plane sessions (`obs:*`),
 *  - isolated automation sessions (cron / triggers), which run unattended.
 */

import { COMPANION_AGENT_PREFIX } from "./companion-id.js";

export interface FusionEligibilityInput {
  sessionName: string;
  agentId: string;
}

export function shouldFuseSession(input: FusionEligibilityInput): boolean {
  const { sessionName, agentId } = input;

  // The companion itself never gets its own companion.
  if (agentId.startsWith(COMPANION_AGENT_PREFIX)) return false;

  // Observer-plane sessions are excluded to avoid observation loops.
  if (/^obs:/i.test(sessionName)) return false;

  // Isolated automation sessions run unattended; fusion is for interactive work.
  if (/:(cron|trigger):/i.test(sessionName)) return false;

  return true;
}
