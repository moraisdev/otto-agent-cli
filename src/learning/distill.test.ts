import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLearningCycle, listPending } from "./index.js";
import {
  noopClassifier,
  buildClassificationPrompt,
  parseClassifierResponse,
  createProviderClassifier,
} from "./distill.js";
import type { LearningClassifier, LearningDecision } from "./types.js";

describe("runLearningCycle", () => {
  it("applies memory/knowledge and defers skill/command", async () => {
    const candidates = [
      { id: "a", summary: "prefers PT-BR" },
      { id: "b", summary: "repeated clickup move steps" },
      { id: "c", summary: "noise" },
    ];
    const classifier: LearningClassifier = async () => [
      { insightId: "a", route: "memory", title: "Lang", body: "Responder em PT-BR", reason: "pref" },
      { insightId: "b", route: "skill", title: "Move card", body: "...", reason: "repeat" },
      { insightId: "c", route: "no-op", title: "", body: "", reason: "noise" },
    ];
    const result = await runLearningCycle({
      cwd: "/tmp/x-does-not-matter",
      candidates,
      classifier,
      onApplied: async () => {},
    });
    expect(result.applied.map((d) => d.insightId)).toEqual(["a"]);
    expect(result.deferred.map((d) => d.insightId)).toEqual(["b"]);
    expect(result.skipped).toEqual(["c"]);
    expect(result.errors).toEqual([]);
  });

  it("noopClassifier returns no decisions", async () => {
    const result = await runLearningCycle({
      cwd: "/tmp/x-does-not-matter",
      candidates: [{ id: "a", summary: "anything" }],
      classifier: noopClassifier,
    });
    expect(result.applied).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("stages deferred skill decisions and invokes onDeferred", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "otto-distill-defer-"));
    const classifier: LearningClassifier = async () => [
      {
        insightId: "b",
        route: "skill",
        title: "Move Card",
        body: "## trigger\n## workflow\n## validation\n## non-goals",
        reason: "repeat",
      },
    ];
    const seen: { id: string; staged: string }[] = [];
    const result = await runLearningCycle({
      cwd,
      candidates: [],
      classifier,
      onDeferred: async (d, stagedId) => {
        seen.push({ id: d.insightId, staged: stagedId });
      },
    });
    expect(result.deferred.map((d) => d.insightId)).toEqual(["b"]);
    expect(result.errors).toEqual([]);
    const pending = listPending(cwd);
    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe("move-card");
    expect(pending[0].kind).toBe("skill");
    expect(pending[0].insightId).toBe("b");
    expect(pending[0].files["SKILL.md"]).toContain("trigger");
    expect(seen).toEqual([{ id: "b", staged: pending[0].id }]);
  });

  it("isolates errors per decision and continues the batch", async () => {
    const decisions: LearningDecision[] = [
      { insightId: "first", route: "memory", title: "First", body: "first body", reason: "" },
      { insightId: "second", route: "memory", title: "Second", body: "second body", reason: "" },
    ];
    const appliedCallbacks: string[] = [];
    const result = await runLearningCycle({
      cwd: mkdtempSync(join(tmpdir(), "otto-distill-err-")),
      candidates: [],
      classifier: async () => decisions,
      onApplied: async (d) => {
        if (d.insightId === "first") {
          throw new Error("boom");
        }
        appliedCallbacks.push(d.insightId);
      },
    });

    expect(appliedCallbacks).toEqual(["second"]);
    expect(result.applied.map((d) => d.insightId)).toEqual(["second"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].insightId).toBe("first");
    expect(result.errors[0].error).toContain("boom");
  });
});

describe("buildClassificationPrompt", () => {
  it("includes candidate ids/summaries/detail and routing rules", () => {
    const prompt = buildClassificationPrompt([
      { id: "a", summary: "prefers PT-BR", detail: "always replies in portuguese" },
      { id: "b", summary: "noise" },
    ]);
    expect(prompt).toContain("a");
    expect(prompt).toContain("prefers PT-BR");
    expect(prompt).toContain("always replies in portuguese");
    expect(prompt).toContain("b");
    for (const route of ["no-op", "memory", "knowledge", "skill", "command"]) {
      expect(prompt).toContain(route);
    }
    expect(prompt).toContain("JSON");
  });
});

describe("parseClassifierResponse", () => {
  it("parses a valid JSON array of decisions", () => {
    const text = JSON.stringify([
      { insightId: "a", route: "memory", title: "Lang", body: "PT-BR", reason: "pref" },
      { insightId: "b", route: "no-op", title: "", body: "", reason: "noise" },
    ]);
    const out = parseClassifierResponse(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ insightId: "a", route: "memory", title: "Lang", body: "PT-BR", reason: "pref" });
    expect(out[1].route).toBe("no-op");
  });

  it("tolerates ```json fences```", () => {
    const text =
      "```json\n" + JSON.stringify([{ insightId: "a", route: "skill", title: "X", body: "Y", reason: "Z" }]) + "\n```";
    const out = parseClassifierResponse(text);
    expect(out).toHaveLength(1);
    expect(out[0].route).toBe("skill");
  });

  it("discards items with invalid route", () => {
    const text = JSON.stringify([
      { insightId: "a", route: "bogus", title: "X", body: "Y", reason: "Z" },
      { insightId: "b", route: "memory", title: "Ok", body: "B", reason: "R" },
    ]);
    const out = parseClassifierResponse(text);
    expect(out.map((d) => d.insightId)).toEqual(["b"]);
  });

  it("defaults missing string fields and drops items without insightId", () => {
    const text = JSON.stringify([
      { route: "memory", title: "no id" },
      { insightId: "b", route: "knowledge" },
    ]);
    const out = parseClassifierResponse(text);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ insightId: "b", route: "knowledge", title: "", body: "", reason: "" });
  });

  it("returns [] on garbage text", () => {
    expect(parseClassifierResponse("not json at all")).toEqual([]);
    expect(parseClassifierResponse("")).toEqual([]);
  });
});

describe("createProviderClassifier", () => {
  it("classifies candidates via injected runPrompt", async () => {
    const runPrompt = async (_prompt: string) =>
      JSON.stringify([
        { insightId: "a", route: "memory", title: "Lang", body: "PT-BR", reason: "pref" },
        { insightId: "b", route: "skill", title: "Move", body: "...", reason: "repeat" },
      ]);
    const classifier = createProviderClassifier({ runPrompt });
    const out = await classifier([
      { id: "a", summary: "prefers PT-BR" },
      { id: "b", summary: "repeated steps" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].insightId).toBe("a");
    expect(out[1].route).toBe("skill");
  });

  it("degrades to [] when runPrompt throws", async () => {
    const classifier = createProviderClassifier({
      runPrompt: async () => {
        throw new Error("provider down");
      },
    });
    const out = await classifier([{ id: "a", summary: "x" }]);
    expect(out).toEqual([]);
  });
});
