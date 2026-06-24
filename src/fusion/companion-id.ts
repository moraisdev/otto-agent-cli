/**
 * Companion identity helpers, shared across the fusion engine.
 *
 * The read-only peer companion is a normal Otto agent named
 * `peer-companion-<leadId>`, bound to the lead's cwd. Its provider is whichever
 * one is NOT the principal (Codex when Claude leads, Claude when Codex leads),
 * so the naming is provider-neutral. This module is the single source of that
 * convention.
 */

/** Prefix used for the read-only peer companion agent id. */
export const COMPANION_AGENT_PREFIX = "peer-companion-";

/**
 * Legacy prefix from before fusion became symmetric (the peer was always Codex).
 * Kept only so stale `codex-companion-*` agents can be detected and cleaned up.
 */
export const LEGACY_COMPANION_AGENT_PREFIX = "codex-companion-";

/** Derive the companion agent id for a lead agent. */
export function companionAgentId(leadId: string): string {
  return `${COMPANION_AGENT_PREFIX}${leadId}`;
}

/** Session key for a companion agent's main session. */
export function companionSessionKey(companionId: string): string {
  return `agent:${companionId}:main`;
}
