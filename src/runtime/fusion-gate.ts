/**
 * Fusion review gate — the synchronous "windshield" review.
 *
 * At the end of a fused lead turn the gate consults the read-only peer over the
 * lead's REAL diff BEFORE the turn closes, so the peer's review is a gate, not a
 * rearview mirror. The consult runs in the peer companion's MAIN session
 * (`agent:peer-companion-<lead>:main`) — the session the TUI already watches —
 * so the user sees the peer reviewing live.
 *
 * The gate fails OPEN: a slow, absent, or exhausted peer never wedges the lead's
 * reply. On timeout/error the outcome is `unavailable` and the caller ships solo.
 */

import { companionAgentId, companionSessionKey } from "../fusion/companion-id.js";
import type { FusionProvider } from "../fusion/state.js";
import { subscribe } from "../nats.js";
import { publishSessionPrompt } from "../omni/session-stream.js";
import { logger } from "../utils/logger.js";

const log = logger.child("fusion:gate");

/** How long the lead blocks on the peer review before shipping solo (5 min default). */
export const FUSION_REVIEW_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.OTTO_FUSION_REVIEW_TIMEOUT_MS) || 5 * 60 * 1000,
);

/**
 * Max review passes per turn (draft + up to N-1 revisions) before shipping. The
 * loop runs peer-review → lead-revise → re-review until the peer approves, capped
 * here so a stubborn disagreement can't wedge the turn forever.
 */
export const FUSION_REVIEW_MAX_ROUNDS = Math.max(1, Number(process.env.OTTO_FUSION_REVIEW_MAX_ROUNDS) || 4);

export type FusionReviewOutcome = "approved" | "changes" | "unavailable";

export interface FusionReviewVerdict {
  outcome: FusionReviewOutcome;
  /** One-line summary for the `✦ peer: N ajustes` affordance (CHANGES only). */
  summary?: string;
  /** Full actionable findings fed back to the lead for revision (CHANGES only). */
  findings?: string;
}

export interface FusionReviewRequest {
  leadSessionName: string;
  leadAgentId: string;
  peerProvider: FusionProvider;
  /** The lead's draft reply that the peer reviews. */
  draft: string;
  /** 0-based review round (0 = first review of the turn). */
  round: number;
  timeoutMs?: number;
}

export interface FusionReviewDeps {
  publishPrompt?: (sessionName: string, payload: Record<string, unknown>) => Promise<void>;
  subscribeResponses?: (pattern: string) => AsyncIterable<unknown>;
}

const REVIEW_TAG = "[Fusion Review Request]";

/** The review request the peer companion answers (restates the reply protocol). */
export function buildReviewRequestPrompt(req: FusionReviewRequest): string {
  return [
    `${REVIEW_TAG} — round ${req.round + 1}`,
    `The lead just finished a turn. This is a GATE: your verdict decides whether the lead's`,
    `reply ships as-is or gets revised first. Review the REAL changes in this shared working`,
    `tree (run \`git diff\`, read the touched files) against the user's intent and the lead's`,
    `draft reply below. Be fast and specific; only block for genuine correctness / safety /`,
    `scope problems — never for style nits.`,
    ``,
    `Lead's draft reply:`,
    `"""`,
    req.draft.trim(),
    `"""`,
    ``,
    `Reply in EXACTLY this format:`,
    `- First line: \`VERDICT: APPROVED\` (ship as-is) or \`VERDICT: CHANGES\`.`,
    `- If CHANGES, second line: \`SUMMARY: <one short line, e.g. "2 ajustes: erro X, edge case Y">\`.`,
    `- Then the specific, actionable findings the lead must fix.`,
  ].join("\n");
}

/** Parse the peer's free-form reply into a verdict. Fails OPEN to `approved`. */
export function parseReviewVerdict(text: string): FusionReviewVerdict {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { outcome: "approved" };
  if (!/VERDICT:\s*CHANGES/i.test(trimmed)) {
    // Explicit APPROVED, or a reply with no block marker → ship as-is.
    return { outcome: "approved" };
  }
  const summary = trimmed.match(/SUMMARY:\s*(.+)/i)?.[1]?.trim();
  const findings = trimmed
    .replace(/^.*VERDICT:\s*CHANGES.*$/im, "")
    .replace(/^\s*SUMMARY:.*$/im, "")
    .trim();
  return {
    outcome: "changes",
    summary: summary || "ajustes solicitados",
    findings: findings || trimmed,
  };
}

function extractResponseText(value: unknown): string | undefined {
  if (value && typeof value === "object" && "response" in value) {
    const response = (value as { response?: unknown }).response;
    if (typeof response === "string" && response.trim()) return response;
  }
  return undefined;
}

/**
 * Consult the peer companion over the lead's draft and block until it returns a
 * verdict (or the timeout fires). Routed through the companion's MAIN session so
 * the review is visible in the TUI. Never throws — returns `unavailable` instead.
 */
export async function runFusionReviewGate(
  req: FusionReviewRequest,
  deps: FusionReviewDeps = {},
): Promise<FusionReviewVerdict> {
  const publishPrompt = deps.publishPrompt ?? publishSessionPrompt;
  const subscribeResponses = deps.subscribeResponses ?? ((pattern: string) => subscribe(pattern));
  const companionKey = companionSessionKey(companionAgentId(req.leadAgentId));
  const timeoutMs = req.timeoutMs ?? FUSION_REVIEW_TIMEOUT_MS;

  const iterator = subscribeResponses(`otto.session.${companionKey}.response`)[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    await publishPrompt(companionKey, {
      prompt: buildReviewRequestPrompt(req),
      _fusionReview: true,
    });
    for (;;) {
      const next = await Promise.race([iterator.next(), timeout]);
      if (next === "timeout") {
        log.warn("Fusion review timed out — shipping solo", { companionKey, timeoutMs });
        return { outcome: "unavailable" };
      }
      if (next.done) return { outcome: "unavailable" };
      const text = extractResponseText(next.value);
      if (text) return parseReviewVerdict(text);
    }
  } catch (error) {
    log.warn("Fusion review gate errored — shipping solo", { companionKey, error });
    return { outcome: "unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
    await iterator.return?.(undefined);
  }
}
