import { describe, expect, it } from "bun:test";
import { getToolSafety } from "./tool-safety.js";

describe("getToolSafety", () => {
  it("read-only tools are safe (interruptible)", () => {
    expect(getToolSafety("Read")).toBe("safe");
    expect(getToolSafety("Grep")).toBe("safe");
    expect(getToolSafety("Glob")).toBe("safe");
  });

  it("a normal Bash command is unsafe", () => {
    expect(getToolSafety("Bash", { command: "rm -rf build" })).toBe("unsafe");
    expect(getToolSafety("Write", { command: "x" })).toBe("unsafe");
  });

  it("Bash sleep is safe", () => {
    expect(getToolSafety("Bash", { command: "sleep 5" })).toBe("safe");
  });

  it("a blocking session consult (otto sessions send -w) is safe so the lead can be interrupted", () => {
    // The fusion peer consult: from the lead's side it only WAITS for a reply,
    // so Ctrl+C must break it instead of being deferred until the wait ends.
    expect(getToolSafety("Bash", { command: 'otto sessions send agent:peer-companion-main:main "check x" -w' })).toBe(
      "safe",
    );
    expect(
      getToolSafety("Bash", {
        command: "./bin/otto sessions send agent:peer-companion-main:main 'q' --wait --timeout 45",
      }),
    ).toBe("safe");
  });

  it("a non-wait sessions send (fire-and-forget) is still unsafe", () => {
    expect(getToolSafety("Bash", { command: 'otto sessions send agent:main:main "ping"' })).toBe("unsafe");
  });
});
