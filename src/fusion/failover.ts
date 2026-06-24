/**
 * Failover bridge between the runtime event loop and fusion state.
 *
 * On a terminal turn failure, classify whether it was a provider quota/limit and,
 * if so, mark that provider exhausted so the next turn fails over to the other
 * CLI. On a successful turn, clear the provider's exhaustion (it's healthy again).
 *
 * Best-effort and side-effect-isolated so the hot event loop never breaks.
 */

import { nats } from "../nats.js";
import { logger } from "../utils/logger.js";
import { COMPANION_AGENT_PREFIX } from "./companion-id.js";
import { classifyProviderLimit } from "./limit-detect.js";
import {
  clearProviderExhausted,
  DEFAULT_EXHAUSTION_TTL_MS,
  markProviderExhausted,
  type FusionProvider,
} from "./state.js";

const log = logger.child("fusion:failover");

/**
 * Fusion state is keyed by the LEAD agent. A peer turn may run under the companion
 * agent (`peer-companion-<lead>`) — its consult and review turns — so map a
 * companion's failures back to the lead's row, since they share the same provider
 * CLI quota. This is what makes the lead's "peer exhausted -> principal solo" arm
 * actually fire when the always-on peer hits its cap. The companion's failure
 * carries the peer's provider, so it lands in the correct per-provider column.
 */
function leadKeyFor(agentId: string): string {
  return agentId.startsWith(COMPANION_AGENT_PREFIX) ? agentId.slice(COMPANION_AGENT_PREFIX.length) : agentId;
}

/**
 * Classify only the focused failure text — the error string plus a narrow set of
 * known error fields — never the whole serialized event, which would amplify
 * every regex into a false positive on unrelated payload content.
 */
function failureText(error: string | undefined, rawEvent: unknown): Array<string | undefined> {
  const parts: Array<string | undefined> = [error];
  if (rawEvent && typeof rawEvent === "object") {
    const ev = rawEvent as Record<string, unknown>;
    const err = ev.error;
    if (typeof ev.message === "string") parts.push(ev.message);
    if (typeof err === "string") parts.push(err);
    else if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      if (typeof e.message === "string") parts.push(e.message);
      if (typeof e.type === "string") parts.push(e.type);
      if (typeof e.code === "string") parts.push(e.code);
    }
    if (typeof ev.type === "string") parts.push(ev.type);
  }
  return parts;
}

type FusionEmitter = (subject: string, data: Record<string, unknown>) => Promise<void>;

let emitFusionEvent: FusionEmitter = (subject, data) => nats.emit(subject, data);

/** Swap the NATS emitter (tests inject a no-op/spy to avoid a live connection). */
export function setFusionEmitterForTests(fn: FusionEmitter | null): void {
  emitFusionEvent = fn ?? ((subject, data) => nats.emit(subject, data));
}

function asFusionProvider(provider: string): FusionProvider | null {
  return provider === "claude" || provider === "codex" ? provider : null;
}

/**
 * Inspect a failed turn for a provider limit. If detected, mark the provider
 * exhausted (keyed by the lead agent) and announce it. Returns true when a limit
 * was detected and recorded.
 */
export function recordTurnFailureForFusion(input: {
  agentId: string;
  provider: string;
  error?: string;
  rawEvent?: unknown;
  now?: number;
}): boolean {
  const provider = asFusionProvider(input.provider);
  if (!provider) return false;

  const classification = classifyProviderLimit(...failureText(input.error, input.rawEvent));
  if (!classification.limited) return false;

  const leadId = leadKeyFor(input.agentId);
  const ttlMs = classification.retryAfterMs ?? DEFAULT_EXHAUSTION_TTL_MS;
  try {
    markProviderExhausted(leadId, provider, ttlMs, input.now);
  } catch (err) {
    log.warn("Failed to persist provider exhaustion", { agentId: leadId, provider, error: err });
  }

  log.warn("Provider hit its CLI limit — failing over", {
    agentId: leadId,
    provider,
    kind: classification.kind,
    ttlMs,
  });
  emitFusionEvent(`otto.fusion.limit.${provider}`, {
    agentId: leadId,
    provider,
    kind: classification.kind ?? "rate_limit",
    ttlMs,
  }).catch(() => {});
  return true;
}

/** A successful turn means the provider is healthy — clear any exhaustion flag. */
export function recordTurnSuccessForFusion(input: { agentId: string; provider: string; now?: number }): void {
  const provider = asFusionProvider(input.provider);
  if (!provider) return;
  try {
    clearProviderExhausted(leadKeyFor(input.agentId), provider, input.now);
  } catch {
    // best-effort
  }
}
