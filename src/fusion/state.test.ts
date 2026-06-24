import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanupIsolatedOttoState, createIsolatedOttoState } from "../test/otto-state.js";
import {
  computeEffectiveState,
  clearProviderExhausted,
  dbGetFusionState,
  getEffectiveFusionState,
  isFusionDisabled,
  markProviderExhausted,
  setFusionDisabled,
  type FusionStateRow,
} from "./state.js";

describe("computeEffectiveState (pure)", () => {
  const base: FusionStateRow = { agentId: "main", claudeExhaustedUntil: 0, codexExhaustedUntil: 0, updatedAt: 0 };

  it("editor is the principal when nothing is exhausted (claude default)", () => {
    expect(computeEffectiveState(base, "claude", 1000)).toEqual({
      editor: "claude",
      claudeExhausted: false,
      codexExhausted: false,
    });
  });

  it("fails over to codex when claude (principal) is exhausted", () => {
    const s = { ...base, claudeExhaustedUntil: 5000 };
    expect(computeEffectiveState(s, "claude", 1000)).toEqual({
      editor: "codex",
      claudeExhausted: true,
      codexExhausted: false,
    });
  });

  it("keeps claude editor when codex (peer) is exhausted (claude solo)", () => {
    const s = { ...base, codexExhaustedUntil: 5000 };
    expect(computeEffectiveState(s, "claude", 1000)).toEqual({
      editor: "claude",
      claudeExhausted: false,
      codexExhausted: true,
    });
  });

  it("keeps the principal editor when both exhausted (no better option)", () => {
    const s = { ...base, claudeExhaustedUntil: 5000, codexExhaustedUntil: 5000 };
    expect(computeEffectiveState(s, "claude", 1000)).toEqual({
      editor: "claude",
      claudeExhausted: true,
      codexExhausted: true,
    });
  });

  it("symmetric: codex principal edits, and fails over to claude when codex is exhausted", () => {
    expect(computeEffectiveState(base, "codex", 1000).editor).toBe("codex");
    const s = { ...base, codexExhaustedUntil: 5000 };
    expect(computeEffectiveState(s, "codex", 1000).editor).toBe("claude");
  });

  it("symmetric: codex principal stays editor when its peer (claude) is exhausted", () => {
    const s = { ...base, claudeExhaustedUntil: 5000 };
    expect(computeEffectiveState(s, "codex", 1000).editor).toBe("codex");
  });

  it("treats expired TTLs as available", () => {
    const s = { ...base, claudeExhaustedUntil: 500 };
    expect(computeEffectiveState(s, "claude", 1000).claudeExhausted).toBe(false);
  });
});

describe("fusion state persistence", () => {
  let stateDir: string;
  beforeEach(async () => {
    stateDir = await createIsolatedOttoState("otto-fusion-state-");
  });
  afterEach(async () => {
    await cleanupIsolatedOttoState(stateDir);
  });

  it("returns a zeroed default for an unknown agent", () => {
    expect(dbGetFusionState("main")).toEqual({
      agentId: "main",
      claudeExhaustedUntil: 0,
      codexExhaustedUntil: 0,
      updatedAt: 0,
    });
  });

  it("marks and persists provider exhaustion with a TTL", () => {
    markProviderExhausted("main", "claude", 10_000, 1_000);
    const state = dbGetFusionState("main");
    expect(state.claudeExhaustedUntil).toBe(11_000);
    expect(state.codexExhaustedUntil).toBe(0);
    expect(getEffectiveFusionState("main", "claude", 1_500).editor).toBe("codex");
  });

  it("clears an exhausted provider", () => {
    markProviderExhausted("main", "claude", 10_000, 1_000);
    clearProviderExhausted("main", "claude", 2_000);
    expect(dbGetFusionState("main").claudeExhaustedUntil).toBe(0);
    expect(getEffectiveFusionState("main", "claude", 2_500).editor).toBe("claude");
  });

  it("toggles fusion on/off per agent (default on), independent of exhaustion", () => {
    expect(isFusionDisabled("main")).toBe(false);
    setFusionDisabled("main", true);
    expect(isFusionDisabled("main")).toBe(true);
    // toggling does not clobber exhaustion tracking
    markProviderExhausted("main", "claude", 10_000, 1_000);
    expect(isFusionDisabled("main")).toBe(true);
    expect(dbGetFusionState("main").claudeExhaustedUntil).toBe(11_000);
    setFusionDisabled("main", false);
    expect(isFusionDisabled("main")).toBe(false);
  });

  it("tracks the two providers independently", () => {
    markProviderExhausted("main", "claude", 10_000, 1_000);
    markProviderExhausted("main", "codex", 20_000, 1_000);
    const s = dbGetFusionState("main");
    expect(s.claudeExhaustedUntil).toBe(11_000);
    expect(s.codexExhaustedUntil).toBe(21_000);
  });
});
