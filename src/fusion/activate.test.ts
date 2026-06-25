import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dbGetAgent } from "../router/router-db.js";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import { ensureFusionForTurn, leadAgentIdForSession } from "./activate.js";
import { markProviderExhausted, setFusionDisabled } from "./state.js";

describe("leadAgentIdForSession", () => {
  it("extracts the agent id from an agent-scoped session key", () => {
    expect(leadAgentIdForSession("agent:main:main", "fallback")).toBe("main");
    expect(leadAgentIdForSession("agent:vendas:dm:5511", "fallback")).toBe("vendas");
  });
  it("falls back to the default agent for non-agent sessions", () => {
    expect(leadAgentIdForSession("proj-otto-ab12", "main")).toBe("main");
    expect(leadAgentIdForSession("", "main")).toBe("main");
  });
});

describe("ensureFusionForTurn", () => {
  let stateDir: string;
  const lead = { id: "main", cwd: "/tmp/otto-fusion-x", provider: "claude" };

  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-fusion-activate-");
  });
  afterEach(async () => {
    await cleanupIsolatedOttoState(stateDir);
  });

  it("returns not-fused for ineligible sessions (the peer companion itself)", async () => {
    const plan = await ensureFusionForTurn({
      leadAgent: { id: "peer-companion-main", cwd: "/tmp/x", provider: "codex" },
      leadSessionName: "agent:peer-companion-main:main",
    });
    expect(plan.fused).toBe(false);
  });

  it("returns not-fused when fusion is toggled off for the agent", async () => {
    setFusionDisabled("main", true);
    const plan = await ensureFusionForTurn({ leadAgent: lead, leadSessionName: "agent:main:main" });
    expect(plan.fused).toBe(false);
    setFusionDisabled("main", false);
    const back = await ensureFusionForTurn({ leadAgent: lead, leadSessionName: "agent:main:main" });
    expect(back.fused).toBe(true);
  });

  it("normal mode: claude edits, codex peer, no provider override", async () => {
    const plan = await ensureFusionForTurn({
      leadAgent: lead,
      leadSessionName: "agent:main:main",
    });
    expect(plan.fused).toBe(true);
    expect(plan.mode).toBe("normal");
    expect(plan.editor).toBe("claude");
    expect(plan.runtimeProviderId).toBeUndefined();
    expect(plan.playbookPrefix).toContain("collaboration fusion-main");
    // Peer companion agent was provisioned (Codex peer when Claude leads).
    expect(dbGetAgent("peer-companion-main")?.provider).toBe("codex");
  });

  it("failover mode: claude exhausted ⇒ codex becomes editor via provider override", async () => {
    markProviderExhausted("main", "claude", 60_000);
    const plan = await ensureFusionForTurn({
      leadAgent: lead,
      leadSessionName: "agent:main:main",
    });
    expect(plan.fused).toBe(true);
    expect(plan.mode).toBe("failover");
    expect(plan.editor).toBe("codex");
    expect(plan.runtimeProviderId).toBe("codex");
    expect(plan.runtimeModel).toBe("gpt-5.5");
    expect(plan.playbookPrefix).toContain("editor");
  });

  it("solo mode: codex exhausted ⇒ claude works alone, no provider override", async () => {
    markProviderExhausted("main", "codex", 60_000);
    const plan = await ensureFusionForTurn({
      leadAgent: lead,
      leadSessionName: "agent:main:main",
    });
    expect(plan.fused).toBe(true);
    expect(plan.mode).toBe("solo");
    expect(plan.editor).toBe("claude");
    expect(plan.runtimeProviderId).toBeUndefined();
    expect(plan.playbookPrefix).toContain("solo");
  });

  it("both exhausted ⇒ both-at-quota notice", async () => {
    markProviderExhausted("main", "claude", 60_000);
    markProviderExhausted("main", "codex", 60_000);
    const plan = await ensureFusionForTurn({
      leadAgent: lead,
      leadSessionName: "agent:main:main",
    });
    expect(plan.fused).toBe(true);
    expect(plan.mode).toBe("solo");
    expect(plan.playbookPrefix?.toLowerCase()).toContain("both");
  });

  // --- Symmetric: Codex as the principal -------------------------------------
  const codexLead = { id: "main", cwd: "/tmp/otto-fusion-x", provider: "codex" };

  it("symmetric normal: codex leads, claude peer, no provider override", async () => {
    const plan = await ensureFusionForTurn({
      leadAgent: codexLead,
      leadSessionName: "agent:main:main",
    });
    expect(plan.fused).toBe(true);
    expect(plan.mode).toBe("normal");
    expect(plan.editor).toBe("codex");
    expect(plan.runtimeProviderId).toBeUndefined();
    // Peer companion runs Claude (opus) when Codex leads.
    expect(dbGetAgent("peer-companion-main")?.provider).toBe("claude");
    expect(dbGetAgent("peer-companion-main")?.model).toBe("opus");
  });

  it("symmetric failover: codex (principal) exhausted ⇒ claude becomes editor via override", async () => {
    markProviderExhausted("main", "codex", 60_000);
    const plan = await ensureFusionForTurn({ leadAgent: codexLead, leadSessionName: "agent:main:main" });
    expect(plan.mode).toBe("failover");
    expect(plan.editor).toBe("claude");
    expect(plan.runtimeProviderId).toBe("claude");
    expect(plan.runtimeModel).toBe("opus");
  });

  it("symmetric solo: codex leads + claude peer exhausted ⇒ codex works alone", async () => {
    markProviderExhausted("main", "claude", 60_000);
    const plan = await ensureFusionForTurn({ leadAgent: codexLead, leadSessionName: "agent:main:main" });
    expect(plan.mode).toBe("solo");
    expect(plan.editor).toBe("codex");
    expect(plan.runtimeProviderId).toBeUndefined();
  });
});
