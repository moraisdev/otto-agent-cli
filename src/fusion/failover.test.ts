import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import { recordTurnFailureForFusion, recordTurnSuccessForFusion, setFusionEmitterForTests } from "./failover.js";
import { dbGetFusionState, markProviderExhausted } from "./state.js";

describe("fusion failover bridge", () => {
  let stateDir: string;
  const emitted: Array<{ subject: string; data: Record<string, unknown> }> = [];

  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-fusion-failover-");
    emitted.length = 0;
    setFusionEmitterForTests(async (subject, data) => {
      emitted.push({ subject, data });
    });
  });
  afterEach(async () => {
    setFusionEmitterForTests(null);
    await cleanupIsolatedOttoState(stateDir);
  });

  it("marks the provider exhausted when the failure is a quota limit", () => {
    const handled = recordTurnFailureForFusion({
      agentId: "main",
      provider: "claude",
      error: "Error 429: rate limit reached",
      now: 1_000,
    });
    expect(handled).toBe(true);
    expect(dbGetFusionState("main").claudeExhaustedUntil).toBeGreaterThan(1_000);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.subject).toBe("otto.fusion.limit.claude");
  });

  it("uses a Retry-After hint for the TTL when present", () => {
    recordTurnFailureForFusion({
      agentId: "main",
      provider: "codex",
      error: "rate limited, retry-after: 30",
      now: 1_000,
    });
    expect(dbGetFusionState("main").codexExhaustedUntil).toBe(31_000); // 1000 + 30s
  });

  it("ignores non-limit failures (no state change, no emit)", () => {
    const handled = recordTurnFailureForFusion({
      agentId: "main",
      provider: "claude",
      error: "TypeError: undefined is not a function",
    });
    expect(handled).toBe(false);
    expect(dbGetFusionState("main").claudeExhaustedUntil).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it("ignores providers that are not claude/codex", () => {
    const handled = recordTurnFailureForFusion({ agentId: "main", provider: "pi", error: "429 rate limit" });
    expect(handled).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it("clears exhaustion on a successful turn", () => {
    markProviderExhausted("main", "claude", 60_000, 1_000);
    expect(dbGetFusionState("main").claudeExhaustedUntil).toBeGreaterThan(0);
    recordTurnSuccessForFusion({ agentId: "main", provider: "claude", now: 2_000 });
    expect(dbGetFusionState("main").claudeExhaustedUntil).toBe(0);
  });

  it("maps a peer-companion failure to the LEAD's fusion row (so principal-solo can fire)", () => {
    recordTurnFailureForFusion({
      agentId: "peer-companion-main",
      provider: "codex",
      error: "you've hit your usage limit",
      now: 1_000,
    });
    // recorded under the lead "main", not "peer-companion-main"
    expect(dbGetFusionState("main").codexExhaustedUntil).toBeGreaterThan(1_000);
    expect(dbGetFusionState("peer-companion-main").codexExhaustedUntil).toBe(0);
  });

  it("clears under the lead key when a companion review succeeds", () => {
    markProviderExhausted("main", "codex", 60_000, 1_000);
    recordTurnSuccessForFusion({ agentId: "peer-companion-main", provider: "codex", now: 2_000 });
    expect(dbGetFusionState("main").codexExhaustedUntil).toBe(0);
  });

  it("classifies only focused error fields, not arbitrary rawEvent payload content", () => {
    // a limit-looking token buried in an unrelated field must NOT trigger failover
    const spurious = recordTurnFailureForFusion({
      agentId: "main",
      provider: "claude",
      error: "command failed with exit code 1",
      rawEvent: { output: "compiled 429 modules; billing report generated" },
    });
    expect(spurious).toBe(false);
    expect(dbGetFusionState("main").claudeExhaustedUntil).toBe(0);

    // but a real limit in error.type IS detected
    const real = recordTurnFailureForFusion({
      agentId: "main",
      provider: "claude",
      error: "turn failed",
      rawEvent: { error: { type: "rate_limit_error" } },
      now: 1_000,
    });
    expect(real).toBe(true);
    expect(dbGetFusionState("main").claudeExhaustedUntil).toBeGreaterThan(1_000);
  });
});
