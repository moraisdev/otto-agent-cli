import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { hasRelation } from "../permissions/relations.js";
import { dbCreateAgent, dbGetAgent } from "../router/router-db.js";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import { companionAgentId, ensurePeerCompanion } from "./companion.js";

let stateDir: string | null = null;

describe("ensurePeerCompanion", () => {
  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-fusion-companion-test-");
  });

  afterEach(async () => {
    await cleanupIsolatedOttoState(stateDir);
    stateDir = null;
  });

  it("derives a stable, provider-neutral companion id from the lead id", () => {
    expect(companionAgentId("main")).toBe("peer-companion-main");
  });

  it("creates a codex-provider peer on gpt-5.5 when Claude leads, bound to the lead cwd", () => {
    const r = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "codex", "claude");
    const agent = dbGetAgent(r.agentId);
    expect(agent?.provider).toBe("codex");
    expect(agent?.model).toBe("gpt-5.5");
    expect(agent?.cwd).toBe("/tmp/otto-fusion-test");
  });

  it("creates a claude-provider peer on opus when Codex leads (symmetric)", () => {
    const r = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "claude", "codex");
    const agent = dbGetAgent(r.agentId);
    expect(agent?.provider).toBe("claude");
    expect(agent?.model).toBe("opus");
  });

  it("re-points the companion to the new peer when the principal flips", () => {
    const r = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "codex", "claude");
    expect(dbGetAgent(r.agentId)?.provider).toBe("codex");
    ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "claude", "codex");
    const agent = dbGetAgent(r.agentId);
    expect(agent?.provider).toBe("claude");
    expect(agent?.model).toBe("opus");
  });

  it("persists the consultant brief as systemPromptAppend on create", () => {
    const r = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "codex", "claude");
    const brief = dbGetAgent(r.agentId)?.systemPromptAppend ?? "";
    // Hard-anchor on the brief's framing — the peer's identity is "read-only senior pair".
    expect(brief).toContain("READ-ONLY senior pair");
    // The lead label (Claude when Codex is the peer) must be rendered into the brief.
    expect(brief).toContain("the lead (Claude)");
  });

  it("updates the brief when the principal flips so the peer reflects the new lead", () => {
    const r = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "codex", "claude");
    const before = dbGetAgent(r.agentId)?.systemPromptAppend ?? "";
    expect(before).toContain("the lead (Claude)");
    ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "claude", "codex");
    const after = dbGetAgent(r.agentId)?.systemPromptAppend ?? "";
    expect(after).toContain("the lead (Codex)");
    expect(after).not.toBe(before);
  });

  it("grants Bash + read-only executables (not placebo Claude tools, not write)", () => {
    const r = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "codex", "claude");
    expect(hasRelation("agent", r.agentId, "use", "tool", "Bash")).toBe(true);
    // the real gate for Codex: executable allowlist
    expect(hasRelation("agent", r.agentId, "execute", "executable", "rg")).toBe(true);
    expect(hasRelation("agent", r.agentId, "execute", "executable", "git")).toBe(true);
    expect(hasRelation("agent", r.agentId, "execute", "executable", "sed")).toBe(true);
    // placebo Claude-SDK tools are no longer granted; write is never granted
    expect(hasRelation("agent", r.agentId, "use", "tool", "Read")).toBe(false);
    expect(hasRelation("agent", r.agentId, "use", "tool", "Write")).toBe(false);
  });

  it("a Claude peer also gets the read-only SDK tools (Read/Grep/Glob), never Write/Edit", () => {
    const r = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "claude", "codex");
    expect(hasRelation("agent", r.agentId, "use", "tool", "Read")).toBe(true);
    expect(hasRelation("agent", r.agentId, "use", "tool", "Grep")).toBe(true);
    expect(hasRelation("agent", r.agentId, "use", "tool", "Glob")).toBe(true);
    expect(hasRelation("agent", r.agentId, "use", "tool", "Bash")).toBe(true);
    expect(hasRelation("agent", r.agentId, "use", "tool", "Write")).toBe(false);
    expect(hasRelation("agent", r.agentId, "use", "tool", "Edit")).toBe(false);
  });

  it("grants access to the lead session so it can read + inform the lead", () => {
    const r = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "codex", "claude");
    expect(hasRelation("agent", r.agentId, "access", "session", "agent:main:main")).toBe(true);
  });

  it("is idempotent (reuses the same companion)", () => {
    const a = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "codex", "claude");
    const b = ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "codex", "claude");
    expect(a.agentId).toBe(b.agentId);
  });

  it("removes a legacy codex-companion-<lead> agent left over from before symmetry", () => {
    dbCreateAgent({ id: "codex-companion-main", cwd: "/tmp/otto-fusion-test", provider: "codex", model: "gpt-5.5" });
    expect(dbGetAgent("codex-companion-main")).toBeTruthy();
    ensurePeerCompanion({ id: "main", cwd: "/tmp/otto-fusion-test" }, "codex", "claude");
    expect(dbGetAgent("codex-companion-main")).toBeNull();
  });
});
