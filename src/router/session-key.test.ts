import { describe, expect, it } from "bun:test";
import { resolveOwningAgentId } from "./session-key.js";

describe("resolveOwningAgentId", () => {
  const alwaysConfigured = () => true;

  it("prefers an explicit prompt agent hint above everything", () => {
    const id = resolveOwningAgentId("agent:peer-companion-main:main", {
      explicitAgentId: "explicit",
      sessionAgentId: "stored",
      isConfigured: alwaysConfigured,
      defaultAgentId: "main",
    });
    expect(id).toBe("explicit");
  });

  it("prefers a persisted session row's agent over the key", () => {
    const id = resolveOwningAgentId("agent:peer-companion-main:main", {
      sessionAgentId: "stored",
      isConfigured: alwaysConfigured,
      defaultAgentId: "main",
    });
    expect(id).toBe("stored");
  });

  it("derives the owner from the session key when there is no row yet (the fusion companion bug)", () => {
    // No explicit hint, no persisted row -> the key embeds the true owner.
    // Before the fix this fell through to defaultAgent ("main"), which made the
    // peer companion run as a clone of main.
    const id = resolveOwningAgentId("agent:peer-companion-main:main", {
      isConfigured: (a) => a === "peer-companion-main",
      defaultAgentId: "main",
    });
    expect(id).toBe("peer-companion-main");
  });

  it("ignores a key-derived agent that is not configured", () => {
    const id = resolveOwningAgentId("agent:ghost:main", {
      isConfigured: () => false,
      defaultAgentId: "main",
    });
    expect(id).toBe("main");
  });

  it("falls back to the default agent for non-agent keys (project sessions)", () => {
    const id = resolveOwningAgentId("proj-otto-c6442594", {
      isConfigured: alwaysConfigured,
      defaultAgentId: "main",
    });
    expect(id).toBe("main");
  });

  it("falls back to the default agent when nothing else resolves", () => {
    const id = resolveOwningAgentId("proj-x", { isConfigured: () => false, defaultAgentId: "main" });
    expect(id).toBe("main");
  });
});
