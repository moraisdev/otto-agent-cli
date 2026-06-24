/**
 * Provider quota/limit detection.
 *
 * When a CLI provider (Claude Code or Codex) hits its rate/usage limit, the
 * failure surfaces as a terminal `turn.failed` with a provider-specific error
 * message (Anthropic RateLimitError / 429, Codex stderr, subscription "usage
 * limit reached", etc.). This module turns that free-form text into a normalized
 * classification so the fusion engine can fail over to the other CLI.
 *
 * Pure functions only — trivially unit-testable, no side effects.
 */

export type ProviderLimitKind = "rate_limit" | "quota" | "usage_limit" | "overloaded";

export interface ProviderLimitClassification {
  limited: boolean;
  kind: ProviderLimitKind | null;
  /** Suggested retry delay in ms when the provider hinted one (Retry-After), else undefined. */
  retryAfterMs?: number;
}

const NEGATIVE: ProviderLimitClassification = { limited: false, kind: null };

// Ordered most-specific first. Each entry maps a signature to a normalized kind.
// Patterns are deliberately tight: a false positive triggers a wrongful failover
// to the other CLI on an ordinary error, so each alternative must clearly denote
// a quota/limit condition (qualified phrases, word-boundaried status codes).
const SIGNATURES: Array<{ re: RegExp; kind: ProviderLimitKind }> = [
  // Subscription / plan usage limits (Claude Code "5-hour limit", Codex plan caps).
  {
    re: /usage\s*limit|reached your (?:usage|plan) limit|weekly limit|5-?hour limit|(?:usage|plan|rate|weekly)\s*limit (?:will )?resets?|your limit (?:will )?resets? (?:at|in)/i,
    kind: "usage_limit",
  },
  // Hard quota / billing exhaustion.
  {
    re: /insufficient[_\s]?quota|quota (?:exceeded|exhausted)|out of (?:credits|quota)|billing (?:hard )?limit|credit balance is too low/i,
    kind: "quota",
  },
  // Server overload (Anthropic 529 / "overloaded").
  { re: /overloaded|\b529\b|server is (?:temporarily )?overloaded/i, kind: "overloaded" },
  // Generic rate limiting (429 / too many requests / rate_limit_error).
  { re: /rate[_\s]?limit|too many requests|\b429\b|rate_limit_error/i, kind: "rate_limit" },
];

/**
 * Classify an error message / raw event text as a provider limit, or not.
 * Accepts any combination of strings (message, error.type, stderr, JSON blob).
 */
export function classifyProviderLimit(...parts: Array<string | null | undefined>): ProviderLimitClassification {
  const text = parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n");
  if (!text) return NEGATIVE;

  let matched: ProviderLimitKind | null = null;
  for (const sig of SIGNATURES) {
    if (sig.re.test(text)) {
      matched = sig.kind;
      break;
    }
  }
  if (!matched) return NEGATIVE;

  return { limited: true, kind: matched, ...extractRetryAfterMs(text) };
}

/** Extract a Retry-After hint (seconds or "retry after N s/ms") from the text. */
function extractRetryAfterMs(text: string): { retryAfterMs?: number } {
  // "retry-after: 30" (seconds) or "retry after 30s" or "try again in 12 seconds"
  const sec = text.match(/(?:retry[-\s]?after|try again in|retry in)[^\d]{0,12}(\d{1,5})\s*(s|sec|seconds)?\b/i);
  if (sec) {
    const n = Number.parseInt(sec[1] ?? "", 10);
    if (Number.isFinite(n) && n > 0) return { retryAfterMs: n * 1000 };
  }
  const ms = text.match(/(\d{3,7})\s*ms\b/i);
  if (ms) {
    const n = Number.parseInt(ms[1] ?? "", 10);
    if (Number.isFinite(n) && n > 0) return { retryAfterMs: n };
  }
  return {};
}

/** Convenience predicate. */
export function isProviderLimit(...parts: Array<string | null | undefined>): boolean {
  return classifyProviderLimit(...parts).limited;
}
