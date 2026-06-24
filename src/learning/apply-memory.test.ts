import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyMemoryDecision } from "./apply-memory.js";
import type { LearningDecision } from "./types.js";

describe("apply-memory", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "otto-mem-"));
  });

  it("writes a knowledge markdown file under knowledge/", async () => {
    await applyMemoryDecision(cwd, {
      insightId: "i1",
      route: "knowledge",
      title: "Deploy flow",
      body: "Use make deploy",
      reason: "repeated",
    });
    const file = join(cwd, "knowledge", "deploy-flow.md");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("Use make deploy");
  });

  it("appends to existing file instead of duplicating", async () => {
    await applyMemoryDecision(cwd, {
      insightId: "i1",
      route: "knowledge",
      title: "Deploy flow",
      body: "First note",
      reason: "x",
    });
    await applyMemoryDecision(cwd, {
      insightId: "i2",
      route: "knowledge",
      title: "Deploy flow",
      body: "Second note",
      reason: "y",
    });
    const content = readFileSync(join(cwd, "knowledge", "deploy-flow.md"), "utf8");
    expect(content).toContain("First note");
    expect(content).toContain("Second note");
  });

  it("falls back to insightId when the title slug is empty", async () => {
    const decision: LearningDecision = {
      insightId: "abc123",
      route: "memory",
      title: "🎉",
      body: "emoji only title",
      reason: "",
    };
    const file = await applyMemoryDecision(cwd, decision);
    expect(existsSync(file)).toBe(true);
    expect(file).toContain("abc123");
    expect(file.endsWith("/.md")).toBe(false);
  });
});
