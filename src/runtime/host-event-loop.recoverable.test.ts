import { describe, expect, it } from "bun:test";
import { isProviderBusyFailure, isRecoverableInterruptionFailure } from "./host-event-loop.js";

describe("isProviderBusyFailure", () => {
  it("detects the pi 'already processing' rejection", () => {
    expect(
      isProviderBusyFailure({ error: "Agent is already processing. Specify streamingBehavior to override." }),
    ).toBe(true);
  });

  it("detects the marker from rawEvent payloads", () => {
    expect(isProviderBusyFailure({ rawEvent: { error: "agent is ALREADY PROCESSING" } })).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isProviderBusyFailure({ error: "ENOENT: file not found" })).toBe(false);
  });
});

describe("isRecoverableInterruptionFailure", () => {
  it("treats a provider-busy rejection as recoverable even without a prior interrupt", () => {
    expect(
      isRecoverableInterruptionFailure({
        error: "Agent is already processing. Specify streamingBehavior to override.",
      }),
    ).toBe(true);
  });

  it("still treats abort markers as recoverable", () => {
    expect(isRecoverableInterruptionFailure({ error: "The request was aborted" })).toBe(true);
  });

  it("does not treat an arbitrary failure as recoverable", () => {
    expect(isRecoverableInterruptionFailure({ error: "Internal server error 500" })).toBe(false);
  });

  it("respects an explicit recoverable=false flag", () => {
    expect(
      isRecoverableInterruptionFailure({
        error: "Agent is already processing. Specify streamingBehavior.",
        recoverable: false,
      }),
    ).toBe(false);
  });
});
