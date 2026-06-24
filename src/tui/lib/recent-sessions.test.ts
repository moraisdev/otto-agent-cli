import { describe, expect, it } from "bun:test";
import { formatRelativeTime, isUserFacingSession, sessionLabel } from "./recent-sessions.js";

describe("isUserFacingSession", () => {
  it("keeps real conversations", () => {
    expect(isUserFacingSession("main")).toBe(true);
    expect(isUserFacingSession("proj-otto-ab12")).toBe(true);
    expect(isUserFacingSession("agent:main:whatsapp:group:123")).toBe(true);
  });
  it("hides internal / automation sessions", () => {
    expect(isUserFacingSession("agent:peer-companion-main:main")).toBe(false);
    expect(isUserFacingSession("agent:codex-companion-main:main")).toBe(false); // legacy prefix
    expect(isUserFacingSession("obs:abc:fusion-reviewer")).toBe(false);
    expect(isUserFacingSession("agent:main:cron:job1")).toBe(false);
    expect(isUserFacingSession("agent:main:trigger:t1")).toBe(false);
    expect(isUserFacingSession("")).toBe(false);
    expect(isUserFacingSession(undefined)).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  it("scales s/m/h/d", () => {
    const now = 1_000_000_000;
    expect(formatRelativeTime(now - 12_000, now)).toBe("12s");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d");
    expect(formatRelativeTime(now + 5000, now)).toBe("0s"); // clamps future
  });
});

describe("sessionLabel", () => {
  it("friendly labels for common shapes", () => {
    expect(sessionLabel({ name: "main", sessionKey: "agent:main:main", agentId: "main" })).toBe("main");
    expect(sessionLabel({ name: "agent:main:main", sessionKey: "agent:main:main", agentId: "main" })).toBe("main");
    expect(sessionLabel({ name: "proj-otto-ab12", sessionKey: "proj-otto-ab12", agentId: "main" })).toBe(
      "proj-otto-ab12",
    );
    expect(sessionLabel({ name: "agent:main:whatsapp:group:123", sessionKey: "k", agentId: "main" })).toContain(
      "grupo",
    );
  });
});
