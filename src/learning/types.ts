export const LEARNING_ROUTES = ["no-op", "memory", "knowledge", "skill", "command"] as const;
export type LearningRoute = (typeof LEARNING_ROUTES)[number];

export interface LearningDecision {
  insightId: string;
  route: LearningRoute;
  title: string;
  body: string;
  reason: string;
}

export type LearningClassifier = (
  candidates: { id: string; summary: string; detail?: string }[],
) => Promise<LearningDecision[]>;

export interface LearningCycleError {
  insightId: string;
  error: string;
}

export interface LearningCycleResult {
  applied: LearningDecision[];
  deferred: LearningDecision[];
  skipped: string[];
  errors: LearningCycleError[];
}
