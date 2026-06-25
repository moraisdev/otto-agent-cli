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

/**
 * True when a Bash command is the lead's blocking peer consult
 * (`otto sessions send <peer-companion-*> ... -w`). Used both to enforce the
 * converge gate and to surface "avaliando…" peer status during the consult.
 */
export function isPeerConsultCommand(command: string): boolean {
  return (
    /\botto\s+sessions\s+send\b/.test(command) &&
    /(^|\s)(-w|--wait)(\s|$)/.test(command) &&
    command.includes(COMPANION_AGENT_PREFIX)
  );
}
