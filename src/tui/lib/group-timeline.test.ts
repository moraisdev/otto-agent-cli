import { describe, expect, it } from "bun:test";
import { groupTimeline } from "./group-timeline.js";
import type { TimelineEntry } from "../hooks/useNats.js";

const user = (id: string, content: string): TimelineEntry => ({
  id,
  type: "chat",
  role: "user",
  content,
  timestamp: 0,
});

const assistant = (
  id: string,
  content: string,
  opts?: { source?: "lead" | "codex"; streaming?: boolean },
): TimelineEntry => ({
  id,
  type: "chat",
  role: "assistant",
  content,
  timestamp: 0,
  source: opts?.source,
  streaming: opts?.streaming,
});

const tool = (
  id: string,
  toolName: string,
  opts?: { source?: "lead" | "codex"; status?: "running" | "done" },
): TimelineEntry => ({
  id,
  type: "tool",
  toolId: id,
  toolName,
  status: opts?.status ?? "done",
  timestamp: 0,
  source: opts?.source,
});

describe("groupTimeline (participant tree)", () => {
  it("returns nothing for an empty timeline", () => {
    expect(groupTimeline([])).toEqual([]);
  });

  it("a plain Q&A (no tools) renders as user + answer, with NO participant group", () => {
    const nodes = groupTimeline([user("u1", "oi"), assistant("a1", "olá")]);
    expect(nodes.map((n) => n.kind)).toEqual(["user", "answer"]);
    expect(nodes.find((n) => n.kind === "answer")).toMatchObject({ content: "olá" });
  });

  it("renders system/status notes inline, never as a phantom Claude participant tree", () => {
    const nodes = groupTimeline([
      assistant("system-1", "Conectando WhatsApp…"),
      assistant("system-2", "WhatsApp: erro ao conectar."),
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(["answer", "answer"]);
    expect(nodes.some((n) => n.kind === "turn")).toBe(false);
  });

  it("groups the turn by participant: Claude (lead tools) + Codex, answer stays inline", () => {
    const nodes = groupTimeline([
      user("u1", "refatora"),
      tool("t1", "Bash"),
      assistant("c1", "revisei, 2 obs", { source: "codex" }),
      tool("t2", "Edit"),
      assistant("a1", "pronto"),
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(["user", "turn", "answer"]);
    const turn = nodes.find((n) => n.kind === "turn");
    if (turn?.kind !== "turn") throw new Error("expected turn");
    expect(turn.participants.map((p) => p.name)).toEqual(["Claude", "Codex"]);
    const claude = turn.participants.find((p) => p.source === "lead");
    const codex = turn.participants.find((p) => p.source === "codex");
    expect(claude?.toolCount).toBe(2); // Bash + Edit
    expect(codex?.toolCount).toBe(0); // review message, no tools
    expect(claude?.tokenEstimate).toBeGreaterThan(0); // includes the answer text
    expect(nodes.find((n) => n.kind === "answer")).toMatchObject({ content: "pronto" });
  });

  it("a Codex review that arrives after the answer still shows as the Codex participant", () => {
    const nodes = groupTimeline([
      user("u1", "vai"),
      tool("t1", "Bash"),
      assistant("a1", "pronto"),
      assistant("c1", "achei um risco", { source: "codex" }),
    ]);
    expect(nodes.map((n) => n.kind)).toEqual(["user", "turn", "answer"]);
    const turn = nodes[1];
    if (turn?.kind !== "turn") throw new Error("expected turn");
    expect(turn.participants.some((p) => p.source === "codex")).toBe(true);
  });

  it("marks the last turn working when work is in flight and there is no answer yet", () => {
    const nodes = groupTimeline([user("u1", "vai"), tool("t1", "Bash", { status: "running" })], { working: true });
    const turn = nodes.find((n) => n.kind === "turn");
    expect(turn?.kind === "turn" && turn.working).toBe(true);
  });

  it("a completed turn is not working", () => {
    const nodes = groupTimeline([user("u1", "vai"), tool("t1", "Bash"), assistant("a1", "feito")], { working: false });
    const turn = nodes.find((n) => n.kind === "turn");
    expect(turn?.kind === "turn" && turn.working).toBe(false);
  });

  it("does NOT surface an inline answer while the turn is working — only the activity tree", () => {
    // The user wants ONLY the final answer; in-flight "thinking" must not flash inline.
    const nodes = groupTimeline(
      [user("u1", "vai"), tool("t1", "Bash"), assistant("a1", "escreve...", { streaming: true })],
      { working: true },
    );
    expect(nodes.map((n) => n.kind)).toEqual(["user", "turn"]);
    expect(nodes.some((n) => n.kind === "answer")).toBe(false);
  });

  it("surfaces the final answer inline once the turn completes", () => {
    const nodes = groupTimeline([user("u1", "vai"), tool("t1", "Bash"), assistant("a1", "feito")], { working: false });
    expect(nodes.map((n) => n.kind)).toEqual(["user", "turn", "answer"]);
    expect(nodes.find((n) => n.kind === "answer")).toMatchObject({ content: "feito" });
  });
});
