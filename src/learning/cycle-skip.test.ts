/**
 * Regression test for the learning-candidate accumulation bug.
 *
 * Candidates that the classifier does not act on (no-op decisions, or an
 * empty classifier response) must still leave the 'candidate' state at the
 * end of a cycle, otherwise they accumulate forever and are re-read every run.
 *
 * This exercises the exact reconciliation the heartbeat runner performs after
 * runLearningCycle: every candidate read this cycle that is not in
 * applied ∪ deferred ∪ skipped is marked 'skipped'.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import { dbCreateInsight, dbListLearningCandidates, dbMarkLearningProcessed } from "../insights/index.js";
import { runLearningCycle } from "./index.js";
import type { LearningClassifier } from "./types.js";

const emptyClassifier: LearningClassifier = async () => [];

function reconcile(
  candidateIds: Set<string>,
  result: { applied: { insightId: string }[]; deferred: { insightId: string }[]; skipped: string[] },
): void {
  const processed = new Set<string>();
  for (const d of result.applied) processed.add(d.insightId);
  for (const d of result.deferred) processed.add(d.insightId);
  for (const id of result.skipped) {
    dbMarkLearningProcessed(id, "skipped");
    processed.add(id);
  }
  for (const id of candidateIds) {
    if (!processed.has(id)) dbMarkLearningProcessed(id, "skipped");
  }
}

describe("learning cycle candidate reconciliation", () => {
  let stateDir: string | null = null;

  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-learning-cycle-skip-");
  });

  afterEach(async () => {
    await cleanupIsolatedOttoState(stateDir);
    stateDir = null;
  });

  test("empty classifier response marks all read candidates skipped", async () => {
    for (let i = 0; i < 3; i++) {
      dbCreateInsight({
        kind: "improvement",
        summary: `correction ${i}`,
        author: { kind: "human", name: "user" },
        origin: { kind: "session" },
        learningCandidate: true,
      });
    }

    const candidates = dbListLearningCandidates({ limit: 25 }).map((c) => ({
      id: c.id,
      summary: c.summary,
      ...(c.detail ? { detail: c.detail } : {}),
    }));
    expect(candidates.length).toBe(3);

    const candidateIds = new Set(candidates.map((c) => c.id));
    const result = await runLearningCycle({
      cwd: stateDir!,
      candidates,
      classifier: emptyClassifier,
    });

    expect(result.applied.length).toBe(0);
    expect(result.deferred.length).toBe(0);

    reconcile(candidateIds, result);

    // No candidate should remain in the 'candidate' state.
    expect(dbListLearningCandidates({ limit: 25 }).length).toBe(0);
  });
});
