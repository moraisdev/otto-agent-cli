import { describe, expect, it } from "bun:test";
import { shouldFuseSession } from "./policy.js";

describe("shouldFuseSession", () => {
  it("fuses interactive sessions regardless of which provider leads (symmetric)", () => {
    expect(shouldFuseSession({ sessionName: "agent:main:main", agentId: "main" })).toBe(true);
    expect(shouldFuseSession({ sessionName: "agent:main:dm:5511999", agentId: "main" })).toBe(true);
    expect(shouldFuseSession({ sessionName: "proj-otto-ab12", agentId: "main" })).toBe(true);
    expect(shouldFuseSession({ sessionName: "agent:main:whatsapp:group:123", agentId: "main" })).toBe(true);
    // A Codex-led agent now fuses too (Codex edits, Claude reviews).
    expect(shouldFuseSession({ sessionName: "agent:gpt:main", agentId: "gpt" })).toBe(true);
  });

  it("never fuses the peer companion's own session", () => {
    expect(shouldFuseSession({ sessionName: "agent:peer-companion-main:main", agentId: "peer-companion-main" })).toBe(
      false,
    );
  });

  it("does not fuse observer sessions", () => {
    expect(shouldFuseSession({ sessionName: "obs:main:abc", agentId: "main" })).toBe(false);
  });

  it("does not fuse isolated automation sessions (cron / trigger)", () => {
    expect(shouldFuseSession({ sessionName: "agent:main:cron:abc123", agentId: "main" })).toBe(false);
    expect(shouldFuseSession({ sessionName: "agent:main:trigger:d4", agentId: "main" })).toBe(false);
  });
});
