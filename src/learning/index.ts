export * from "./types.js";
export * from "./apply-memory.js";
export * from "./distill.js";
export * from "./detect-correction.js";
export * from "./staging.js";
export * from "./apply-skill.js";
export * from "./notify.js";
export * from "./nl-to-rebac.js";
export * from "./provisioning.js";

import type { LearningClassifier, LearningCycleError, LearningCycleResult, LearningDecision } from "./types.js";
import { applyMemoryDecision } from "./apply-memory.js";
import { stagePending } from "./staging.js";

export interface RunLearningCycleInput {
  cwd: string;
  candidates: { id: string; summary: string; detail?: string }[];
  classifier: LearningClassifier;
  onApplied?: (decision: LearningDecision, filePath: string) => Promise<void>;
  onDeferred?: (decision: LearningDecision, stagedId: string) => Promise<void>;
}

function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "skill";
}

export async function runLearningCycle(input: RunLearningCycleInput): Promise<LearningCycleResult> {
  const decisions = await input.classifier(input.candidates);
  const applied: LearningDecision[] = [];
  const deferred: LearningDecision[] = [];
  const skipped: string[] = [];
  const errors: LearningCycleError[] = [];
  for (const d of decisions) {
    try {
      if (d.route === "memory" || d.route === "knowledge") {
        const file = await applyMemoryDecision(input.cwd, d);
        if (input.onApplied) await input.onApplied(d, file);
        applied.push(d);
      } else if (d.route === "skill" || d.route === "command") {
        if (input.onDeferred) {
          const stagedId = stagePending(input.cwd, {
            kind: d.route,
            name: slugifyTitle(d.title),
            insightId: d.insightId,
            summary: d.title,
            files: { "SKILL.md": d.body },
          });
          await input.onDeferred(d, stagedId);
        }
        deferred.push(d);
      } else {
        skipped.push(d.insightId);
      }
    } catch (err) {
      errors.push({ insightId: d.insightId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { applied, deferred, skipped, errors };
}
