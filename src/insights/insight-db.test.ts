import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  closeInsightsDb,
  dbAddInsightComment,
  dbCreateInsight,
  dbGetInsight,
  dbListInsights,
  dbListLearningCandidates,
  dbMarkLearningProcessed,
  dbSearchInsights,
  dbUpsertInsightLink,
} from "./index.js";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";

let stateDir: string | null = null;

beforeEach(async () => {
  stateDir = await createIsolatedOttoState("otto-insights-");
  closeInsightsDb();
});

afterEach(async () => {
  closeInsightsDb();
  await cleanupIsolatedOttoState(stateDir);
  stateDir = null;
});

describe("insight-db", () => {
  it("persists insights with first-class links, comments and searchable lineage", () => {
    const insight = dbCreateInsight({
      summary: "Agent prompts should record why a route override exists.",
      detail: "Without the rationale, later cleanups remove the override and break the task flow.",
      kind: "pattern",
      confidence: "high",
      importance: "high",
      author: {
        kind: "agent",
        name: "task-8a0dc2ed-work",
        agentId: "dev",
        sessionName: "task-8a0dc2ed-work",
        sessionKey: "agent:dev:main",
        contextId: "ctx_123",
      },
      origin: {
        kind: "runtime-context",
        contextId: "ctx_123",
        agentId: "dev",
        sessionName: "task-8a0dc2ed-work",
      },
      links: [
        {
          targetType: "task",
          targetId: "task-8a0dc2ed",
        },
        {
          targetType: "artifact",
          targetId: "/tmp/TASK.md",
        },
      ],
    });

    expect(insight.links).toHaveLength(2);
    expect(insight.author.agentId).toBe("dev");
    expect(insight.origin.kind).toBe("runtime-context");

    const linked = dbUpsertInsightLink({
      insightId: insight.id,
      targetType: "session",
      targetId: "task-8a0dc2ed-work",
      label: "work session",
      createdBy: insight.author,
    });

    expect(linked.targetType).toBe("session");

    const comment = dbAddInsightComment({
      insightId: insight.id,
      body: "Confirmed again while wiring the new CLI.",
      author: insight.author,
    });

    expect(comment.author.name).toBe("task-8a0dc2ed-work");

    const hydrated = dbGetInsight(insight.id);
    expect(hydrated).not.toBeNull();
    expect(hydrated?.links).toHaveLength(3);
    expect(hydrated?.comments).toHaveLength(1);

    const byTask = dbListInsights({
      linkType: "task",
      linkId: "task-8a0dc2ed",
    });
    expect(byTask.map((item) => item.id)).toContain(insight.id);

    const byAgent = dbListInsights({
      authorAgentId: "dev",
    });
    expect(byAgent).toHaveLength(1);

    const searchResults = dbSearchInsights("confirmed again", {});
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]?.id).toBe(insight.id);
  });

  it("persists and reads learning candidate fields", () => {
    const created = dbCreateInsight({
      summary: "User corrected route handling",
      author: { kind: "human", name: "Pedro" },
      origin: { kind: "session", sessionName: "main-group-x" },
      learningCandidate: true,
      learningPriority: "high",
    });
    const fetched = dbGetInsight(created.id);
    expect(fetched?.learningCandidate).toBe(true);
    expect(fetched?.learningStatus).toBe("candidate");
    expect(fetched?.learningPriority).toBe("high");
  });

  it("lists unprocessed learning candidates ordered by priority", () => {
    dbCreateInsight({
      summary: "low one",
      author: { kind: "human", name: "P" },
      origin: { kind: "manual" },
      learningCandidate: true,
      learningPriority: "low",
    });
    const high = dbCreateInsight({
      summary: "high one",
      author: { kind: "human", name: "P" },
      origin: { kind: "manual" },
      learningCandidate: true,
      learningPriority: "high",
    });
    const candidates = dbListLearningCandidates({ limit: 10 });
    expect(candidates[0]?.id).toBe(high.id);
    dbMarkLearningProcessed(high.id, "processed");
    const after = dbListLearningCandidates({ limit: 10 });
    expect(after.find((c) => c.id === high.id)).toBeUndefined();
  });

  it("scopes candidates by author agentId", () => {
    dbCreateInsight({
      summary: "agent A insight",
      author: { kind: "agent", name: "x", agentId: "A" },
      origin: { kind: "manual" },
      learningCandidate: true,
    });
    dbCreateInsight({
      summary: "agent B insight",
      author: { kind: "agent", name: "x", agentId: "B" },
      origin: { kind: "manual" },
      learningCandidate: true,
    });

    const forA = dbListLearningCandidates({ agentId: "A" });
    expect(forA).toHaveLength(1);
    expect(forA[0].summary).toBe("agent A insight");
  });

  it("scopes candidates by origin agentId for human-authored corrections", () => {
    dbCreateInsight({
      summary: "correction for A",
      author: { kind: "human", name: "user" },
      origin: { kind: "session", sessionName: "s", agentId: "A" },
      learningCandidate: true,
    });
    dbCreateInsight({
      summary: "correction for B",
      author: { kind: "human", name: "user" },
      origin: { kind: "session", sessionName: "s", agentId: "B" },
      learningCandidate: true,
    });

    const forA = dbListLearningCandidates({ agentId: "A" });
    expect(forA).toHaveLength(1);
    expect(forA[0].summary).toBe("correction for A");
  });

  it("returns all candidates globally when no agentId given", () => {
    dbCreateInsight({
      summary: "from A",
      author: { kind: "agent", name: "x", agentId: "A" },
      origin: { kind: "manual" },
      learningCandidate: true,
    });
    dbCreateInsight({
      summary: "from B (origin)",
      author: { kind: "human", name: "user" },
      origin: { kind: "session", sessionName: "s", agentId: "B" },
      learningCandidate: true,
    });

    expect(dbListLearningCandidates()).toHaveLength(2);
  });
});
