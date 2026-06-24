import { describe, expect, it } from "bun:test";
import { inferOttoCommandSkillGate } from "./skill-gates.js";

describe("otto command skill gate", () => {
  it("exempts read-only `otto sessions read` so the fusion peer reads the lead's work ungated", () => {
    // M0: the Codex companion runs `otto sessions read` to see Claude's real work.
    // It is a pure read (history inspection), like the already-exempt sessions.visibility,
    // so it must not trip the soft skill gate.
    const gate = inferOttoCommandSkillGate("otto sessions read agent:main:main --workspace", {
      executables: ["otto"],
    });
    expect(gate).toBeUndefined();
  });

  it("still gates mutating session commands like `otto sessions inform`", () => {
    // inform writes a cross-session message — it stays behind the soft gate on purpose.
    const gate = inferOttoCommandSkillGate('otto sessions inform agent:main:main "hi"', {
      executables: ["otto"],
    });
    expect(gate?.skill).toBe("otto-system-sessions");
  });
});
