import { describe, it, expect, beforeEach, mock } from "bun:test";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const linkCalls: unknown[] = [];
const commentCalls: unknown[] = [];

mock.module("../../insights/index.js", () => ({
  dbUpsertInsightLink: (input: unknown) => {
    linkCalls.push(input);
    return input;
  },
  dbAddInsightComment: (input: unknown) => {
    commentCalls.push(input);
    return input;
  },
}));

const { runLearningApprove, runLearningReject } = await import("./learning.js");
const { stagePending } = await import("../../learning/staging.js");

describe("runLearningApprove", () => {
  let cwd: string;
  let activeSkillsDir: string;

  beforeEach(() => {
    linkCalls.length = 0;
    commentCalls.length = 0;
    cwd = mkdtempSync(join(tmpdir(), "otto-learn-cwd-"));
    activeSkillsDir = mkdtempSync(join(tmpdir(), "otto-learn-active-"));
  });

  it("moves a staged skill to the active dir and removes it from .pending", () => {
    const content = "# Move Card\n## trigger\n## workflow\n## validation\n## non-goals\n";
    const id = stagePending(cwd, {
      kind: "skill",
      name: "move-card",
      insightId: "i1",
      summary: "Move card",
      files: { "SKILL.md": content },
    });

    const result = runLearningApprove(cwd, id, activeSkillsDir, "main");

    expect(result.ok).toBe(true);
    const activeFile = join(activeSkillsDir, "move-card", "SKILL.md");
    expect(existsSync(activeFile)).toBe(true);
    expect(readFileSync(activeFile, "utf8")).toContain("Move Card");
    expect(existsSync(join(cwd, ".pending", id))).toBe(false);
    expect(linkCalls).toHaveLength(1);
    expect(linkCalls[0]).toMatchObject({
      insightId: "i1",
      targetType: "agent",
      targetId: "main",
      label: "skill-approved",
    });
  });

  it("rejects an invalid skill without moving it", () => {
    const id = stagePending(cwd, {
      kind: "skill",
      name: "bad",
      insightId: "i2",
      summary: "Bad",
      files: { "SKILL.md": "# Bad\njust this" },
    });

    const result = runLearningApprove(cwd, id, activeSkillsDir, "main");

    expect(result.ok).toBe(false);
    expect(existsSync(join(activeSkillsDir, "bad", "SKILL.md"))).toBe(false);
    expect(existsSync(join(cwd, ".pending", id))).toBe(true);
  });
});

describe("runLearningReject", () => {
  let cwd: string;

  beforeEach(() => {
    linkCalls.length = 0;
    commentCalls.length = 0;
    cwd = mkdtempSync(join(tmpdir(), "otto-learn-rej-"));
  });

  it("discards the pending item and records the reason as a comment", () => {
    const id = stagePending(cwd, {
      kind: "skill",
      name: "nope",
      insightId: "i3",
      summary: "Nope",
      files: { "SKILL.md": "# Nope\n## trigger\n## workflow\n## validation\n## non-goals" },
    });

    runLearningReject(cwd, id, "not useful");

    expect(existsSync(join(cwd, ".pending", id))).toBe(false);
    expect(commentCalls).toHaveLength(1);
    expect(commentCalls[0]).toMatchObject({
      insightId: "i3",
      body: "rejected: not useful",
    });
  });
});
