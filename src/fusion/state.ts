/**
 * Per-agent fusion state — who is the active editor right now, and which CLI
 * providers are currently exhausted (rate/usage-limited).
 *
 * Persisted in `~/.otto/otto.db` so a failover survives a daemon restart.
 * The effective editor is *derived* from the exhaustion flags (with TTLs), never
 * stored independently, so it can never drift out of sync.
 */

import { getDb } from "../router/router-db.js";

export type FusionEditor = "claude" | "codex";
export type FusionProvider = "claude" | "codex";

/** Default cooldown before an exhausted provider is retried (15 minutes). */
export const DEFAULT_EXHAUSTION_TTL_MS = 15 * 60 * 1000;

export interface FusionStateRow {
  agentId: string;
  /** Epoch ms until which Claude is considered exhausted (0 = available). */
  claudeExhaustedUntil: number;
  /** Epoch ms until which Codex is considered exhausted (0 = available). */
  codexExhaustedUntil: number;
  updatedAt: number;
}

export interface EffectiveFusionState {
  editor: FusionEditor;
  claudeExhausted: boolean;
  codexExhausted: boolean;
}

function ensureFusionSchema(): void {
  // Idempotent and cheap; run every call so it survives db swaps (tests, the
  // daemon reconnecting) rather than caching a stale "ready" flag against a db
  // instance that may have changed underneath us.
  const db = getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS fusion_state (
      agent_id TEXT PRIMARY KEY,
      claude_exhausted_until INTEGER NOT NULL DEFAULT 0,
      codex_exhausted_until INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `);
  // Migrate rows that predate the `disabled` toggle column.
  try {
    db.run("ALTER TABLE fusion_state ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  } catch {
    // column already exists
  }
}

/** Whether fusion is turned OFF for an agent (default: on). */
export function isFusionDisabled(agentId: string): boolean {
  ensureFusionSchema();
  const row = getDb().prepare("SELECT disabled FROM fusion_state WHERE agent_id = ?").get(agentId) as
    | { disabled?: number }
    | undefined;
  return (row?.disabled ?? 0) === 1;
}

/** Turn fusion on/off for an agent (persists; daemon reads it per turn). */
export function setFusionDisabled(agentId: string, disabled: boolean, now: number = Date.now()): void {
  ensureFusionSchema();
  getDb()
    .prepare(`
      INSERT INTO fusion_state (agent_id, disabled, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET disabled = excluded.disabled, updated_at = excluded.updated_at
    `)
    .run(agentId, disabled ? 1 : 0, now);
}

interface FusionStateDbRow {
  agent_id: string;
  claude_exhausted_until: number;
  codex_exhausted_until: number;
  updated_at: number;
}

export function dbGetFusionState(agentId: string): FusionStateRow {
  ensureFusionSchema();
  const row = getDb().prepare("SELECT * FROM fusion_state WHERE agent_id = ?").get(agentId) as
    | FusionStateDbRow
    | undefined;
  if (!row) {
    return { agentId, claudeExhaustedUntil: 0, codexExhaustedUntil: 0, updatedAt: 0 };
  }
  return {
    agentId: row.agent_id,
    claudeExhaustedUntil: row.claude_exhausted_until,
    codexExhaustedUntil: row.codex_exhausted_until,
    updatedAt: row.updated_at,
  };
}

function writeFusionState(state: FusionStateRow, now: number): void {
  ensureFusionSchema();
  getDb()
    .prepare(`
      INSERT INTO fusion_state (agent_id, claude_exhausted_until, codex_exhausted_until, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        claude_exhausted_until = excluded.claude_exhausted_until,
        codex_exhausted_until = excluded.codex_exhausted_until,
        updated_at = excluded.updated_at
    `)
    .run(state.agentId, state.claudeExhaustedUntil, state.codexExhaustedUntil, now);
}

/** Mark a provider exhausted for `ttlMs` from `now`. */
export function markProviderExhausted(
  agentId: string,
  provider: FusionProvider,
  ttlMs: number = DEFAULT_EXHAUSTION_TTL_MS,
  now: number = Date.now(),
): FusionStateRow {
  const current = dbGetFusionState(agentId);
  const until = now + Math.max(0, ttlMs);
  const next: FusionStateRow = {
    ...current,
    claudeExhaustedUntil: provider === "claude" ? until : current.claudeExhaustedUntil,
    codexExhaustedUntil: provider === "codex" ? until : current.codexExhaustedUntil,
    updatedAt: now,
  };
  writeFusionState(next, now);
  return next;
}

/** Clear a provider's exhaustion (e.g., after a successful turn from it). */
export function clearProviderExhausted(
  agentId: string,
  provider: FusionProvider,
  now: number = Date.now(),
): FusionStateRow {
  const current = dbGetFusionState(agentId);
  const next: FusionStateRow = {
    ...current,
    claudeExhaustedUntil: provider === "claude" ? 0 : current.claudeExhaustedUntil,
    codexExhaustedUntil: provider === "codex" ? 0 : current.codexExhaustedUntil,
    updatedAt: now,
  };
  writeFusionState(next, now);
  return next;
}

/** The other provider in the Claude/Codex pair. */
export function otherProvider(provider: FusionProvider): FusionProvider {
  return provider === "claude" ? "codex" : "claude";
}

/**
 * Pure: derive the effective editor + exhaustion booleans from a state row, given
 * which provider is the configured *principal* (lead). The principal is the editor
 * unless it is exhausted and the peer can take over (failover).
 */
export function computeEffectiveState(
  state: FusionStateRow,
  principal: FusionProvider = "claude",
  now: number = Date.now(),
): EffectiveFusionState {
  const claudeExhausted = state.claudeExhaustedUntil > now;
  const codexExhausted = state.codexExhaustedUntil > now;
  const peer = otherProvider(principal);
  const principalExhausted = principal === "claude" ? claudeExhausted : codexExhausted;
  const peerExhausted = peer === "claude" ? claudeExhausted : codexExhausted;
  const editor: FusionEditor = principalExhausted && !peerExhausted ? peer : principal;
  return { editor, claudeExhausted, codexExhausted };
}

/** Convenience: load + derive in one call (principal defaults to Claude). */
export function getEffectiveFusionState(
  agentId: string,
  principal: FusionProvider = "claude",
  now: number = Date.now(),
): EffectiveFusionState {
  return computeEffectiveState(dbGetFusionState(agentId), principal, now);
}
