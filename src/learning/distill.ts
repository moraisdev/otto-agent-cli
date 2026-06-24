import type { LearningClassifier, LearningDecision, LearningRoute } from "./types.js";
import { LEARNING_ROUTES } from "./types.js";

export const noopClassifier: LearningClassifier = async () => [];

export interface ProviderClassifierDeps {
  runPrompt: (prompt: string) => Promise<string>;
}

const ROUTE_SET = new Set<string>(LEARNING_ROUTES);

/**
 * Build the classification prompt for a batch of learning candidates.
 * Pure function: instructs the model to return a strict JSON array of
 * `{insightId, route, title, body, reason}` objects following the routing rules.
 */
export function buildClassificationPrompt(candidates: { id: string; summary: string; detail?: string }[]): string {
  const items = candidates
    .map((c) => {
      const detail = c.detail ? `\n  detail: ${c.detail}` : "";
      return `- id: ${c.id}\n  summary: ${c.summary}${detail}`;
    })
    .join("\n");

  return `You classify "learning candidates" — short observations or corrections captured from a conversation — and decide what to do with each one.

Routing rules. For each candidate choose exactly one route:
- "skill": a recurring procedure or multi-step correction that should become a reusable skill (e.g. "the steps to move a ClickUp card the right way").
- "command": a single reusable command or shortcut worth saving.
- "memory": a stable user preference or personal fact (e.g. "always reply in PT-BR", "user's company is Acme").
- "knowledge": reusable domain knowledge or a fact about the world/system that is broadly useful later.
- "no-op": noise, one-off, irrelevant, or not worth persisting.

For each candidate produce:
- insightId: the candidate id (copy it verbatim).
- route: one of no-op | memory | knowledge | skill | command.
- title: short human title (empty string for no-op).
- body: the content to persist (empty string for no-op).
- reason: one short sentence justifying the route.

Candidates:
${items}

Respond with ONLY a JSON array, no prose, no markdown fences. Example shape:
[{"insightId":"<id>","route":"memory","title":"...","body":"...","reason":"..."}]`;
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

function extractJsonArray(text: string): unknown {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to extracting the first balanced array substring.
  }
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toDecision(raw: unknown): LearningDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const insightId = obj.insightId;
  if (typeof insightId !== "string" || insightId.length === 0) return null;
  const route = obj.route;
  if (typeof route !== "string" || !ROUTE_SET.has(route)) return null;
  return {
    insightId,
    route: route as LearningRoute,
    title: coerceString(obj.title),
    body: coerceString(obj.body),
    reason: coerceString(obj.reason),
  };
}

/**
 * Parse a provider response into validated LearningDecision[].
 * Tolerates ```json fences```, discards invalid items (bad/missing route,
 * missing insightId), defaults missing string fields to "". Never throws.
 */
export function parseClassifierResponse(text: string): LearningDecision[] {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return [];
  const out: LearningDecision[] = [];
  for (const item of parsed) {
    const decision = toDecision(item);
    if (decision) out.push(decision);
  }
  return out;
}

/**
 * Provider-backed classifier. Builds a classification prompt, runs it through
 * the injected `runPrompt`, and parses the response into validated decisions.
 * Degrades to [] if the provider throws.
 */
export function createProviderClassifier(deps: ProviderClassifierDeps): LearningClassifier {
  return async (candidates) => {
    if (candidates.length === 0) return [];
    try {
      const response = await deps.runPrompt(buildClassificationPrompt(candidates));
      return parseClassifierResponse(response);
    } catch {
      return [];
    }
  };
}
